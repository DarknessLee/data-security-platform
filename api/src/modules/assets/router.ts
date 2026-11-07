import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne } from '../../db/pool.ts';
import { cached, invalidate } from '../../db/redis.ts';
import { ApiError, ok } from '../../lib/http.ts';
import { numOrUndef, pageMeta, parsePagination, strOrUndef } from '../../lib/query.ts';
import { fmtDateTime, now, today } from '../../lib/time.ts';
import { authenticate, currentUser, dataScopeFilter, requirePerm } from '../../middleware/auth.ts';
import type { AuthUser } from '../../types.ts';

export const assetsRouter = Router();

/** 数据资产治理模块：所有接口先认证，读接口要求 asset:read，写接口要求 asset:write */
assetsRouter.use(authenticate);

const LEVELS = ['公开', '内部', '机密', '绝密'] as const;
const STATUSES = ['正常', '待治理', '风险', '已归档'] as const;
const STAGES = ['采集', '存储', '使用', '共享', '销毁'] as const;
const DATA_TYPES = ['结构化', '半结构化', '非结构化'] as const;

const read = requirePerm('asset');
const write = requirePerm('asset', 'write');

// ============ 公共工具 ============

type Scope = { sql: string; params: unknown[] };

/** 数据级权限：ALL/DEPT 直接复用中间件；SELF 按责任人姓名过滤（owner 存姓名而非账号） */
function assetScope(user: AuthUser): Scope {
  const scope = dataScopeFilter(user, 'a', 'dept_id', 'owner');
  if (scope.sql.includes('a.owner = ?')) return { sql: scope.sql, params: [user.realName || user.username] };
  return scope;
}

function scopeWhere(scope: Scope): string {
  return scope.sql ? `WHERE ${scope.sql.replace(/^AND\s+/, '')}` : '';
}

function dt(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return fmtDateTime(v);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : fmtDateTime(d);
}

function operatorOf(user: AuthUser): string {
  return user.realName || user.username;
}

interface AssetDbRow {
  [key: string]: unknown;
  id: number;
  asset_code: string;
  asset_name: string;
  category_id: number;
  dept_id: number;
  source_system: string;
  data_type: string;
  data_level: string;
  file_format: string | null;
  size_gb: string | number;
  row_count: number | string;
  owner: string;
  status: string;
  lifecycle_stage: string;
  sensitivity_score: number | string;
  quality_score: number | string;
  description: string | null;
  discovered_at: Date | string | null;
  last_access_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  category_name?: string;
  category_code?: string;
  dept_name?: string;
  tag_names?: string | null;
  risk_count?: number | string;
  check_count?: number | string;
  share_count?: number | string;
}

interface LifecycleRow {
  id: number;
  asset_id: number;
  stage: string;
  action: string;
  operator: string;
  detail: string | null;
  occurred_at: Date | string | null;
}

function toAssetDto(row: AssetDbRow): Record<string, unknown> {
  const { tag_names, ...rest } = row;
  return {
    ...rest,
    size_gb: Number(row.size_gb ?? 0),
    row_count: Number(row.row_count ?? 0),
    sensitivity_score: Number(row.sensitivity_score ?? 0),
    quality_score: Number(row.quality_score ?? 0),
    discovered_at: dt(row.discovered_at),
    last_access_at: dt(row.last_access_at),
    created_at: dt(row.created_at),
    updated_at: dt(row.updated_at),
    tags: tag_names ? String(tag_names).split(',').filter(Boolean) : [],
  };
}

function toLifecycleDto(row: LifecycleRow): Record<string, unknown> {
  return { ...row, occurred_at: dt(row.occurred_at) };
}

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, '资产 ID 不合法');
  return id;
}

async function findAssetInScope(user: AuthUser, id: number): Promise<AssetDbRow | null> {
  const scope = assetScope(user);
  return queryOne<AssetDbRow>(`SELECT a.* FROM data_asset a WHERE a.id = ? ${scope.sql}`, [id, ...scope.params]);
}

async function ensureRefs(categoryId: number | undefined, deptId: number | undefined): Promise<void> {
  const [cat, dept] = await Promise.all([
    categoryId === undefined ? Promise.resolve(null) : queryOne<{ id: number }>('SELECT id FROM asset_category WHERE id = ?', [categoryId]),
    deptId === undefined ? Promise.resolve(null) : queryOne<{ id: number }>('SELECT id FROM sys_dept WHERE id = ?', [deptId]),
  ]);
  if (categoryId !== undefined && !cat) throw new ApiError(400, '资产分类不存在');
  if (deptId !== undefined && !dept) throw new ApiError(400, '责任部门不存在');
}

async function addLifecycle(assetId: number, stage: string, action: string, operator: string, detail: string): Promise<void> {
  await execute(
    'INSERT INTO asset_lifecycle (asset_id, stage, action, operator, detail, occurred_at) VALUES (?,?,?,?,?,?)',
    [assetId, stage, action, operator, detail.slice(0, 512), now()],
  );
}

async function tagCountOf(assetId: number): Promise<number> {
  const row = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM asset_tag WHERE asset_id = ?', [assetId]);
  return Number(row?.c ?? 0);
}

function invalidateAssets(): void {
  void invalidate('assets:*');
}

/** 资产编号自增：DA-YYYY-NNNN */
async function nextAssetCode(): Promise<string> {
  const year = new Date().getFullYear();
  const last = await queryOne<{ asset_code: string }>(
    'SELECT asset_code FROM data_asset WHERE asset_code LIKE ? ORDER BY asset_code DESC LIMIT 1',
    [`DA-${year}-%`],
  );
  let seq = 1;
  if (last?.asset_code) {
    const parsed = Number(last.asset_code.split('-')[2]);
    if (Number.isFinite(parsed) && parsed > 0) seq = parsed + 1;
  }
  return `DA-${year}-${String(seq).padStart(4, '0')}`;
}

// ============ 敏感度模型（演示近似：分级基线 + 标签/规模/活跃度/状态修正） ============

const LEVEL_BASE: Record<string, number> = { 公开: 28, 内部: 48, 机密: 72, 绝密: 90 };

interface SensitivityInput {
  data_level: string;
  status: string;
  size_gb: number;
  last_access_at: Date | string | null;
  tagCount: number;
}

function staleDays(lastAccessAt: Date | string | null): number | null {
  if (!lastAccessAt) return null;
  const d = lastAccessAt instanceof Date ? lastAccessAt : new Date(String(lastAccessAt));
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function computeSensitivity(input: SensitivityInput): number {
  let score = LEVEL_BASE[input.data_level] ?? 50;
  score += Math.min(8, input.tagCount * 2);
  const size = Number(input.size_gb ?? 0);
  if (size >= 1000) score += 5;
  else if (size >= 100) score += 3;
  else if (size >= 10) score += 1;
  const idle = staleDays(input.last_access_at);
  if (idle === null || idle > 90) score += 5;
  else if (idle > 30) score += 2;
  if (input.status === '风险') score += 3;
  else if (input.status === '待治理') score += 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

interface Finding {
  type: string;
  level: '高' | '中' | '低';
  message: string;
}

function buildFindings(row: AssetDbRow, score: number, tagCount: number): Finding[] {
  const findings: Finding[] = [];
  if (row.data_level === '机密' || row.data_level === '绝密') {
    findings.push({
      type: '分级管控',
      level: '高',
      message: `资产分级为「${row.data_level}」，需启用字段级脱敏与最小授权访问策略`,
    });
  }
  if (score >= 80) {
    findings.push({ type: '敏感度', level: '高', message: `复算敏感度 ${score} 分，超过高敏感阈值（80 分），建议纳入重点保护清单` });
  } else if (score >= 60) {
    findings.push({ type: '敏感度', level: '中', message: `复算敏感度 ${score} 分，属于中敏感区间，建议复核访问权限` });
  }
  if (tagCount === 0) {
    findings.push({ type: '标签治理', level: '中', message: '资产缺少业务标签，无法自动匹配分类分级策略，请补充标签' });
  }
  const idle = staleDays(row.last_access_at);
  if (idle === null) {
    findings.push({ type: '访问治理', level: '中', message: '资产无最近访问记录，请确认是否仍在业务使用中' });
  } else if (idle > 90) {
    findings.push({ type: '访问治理', level: '中', message: `最近访问距今 ${idle} 天，超过 90 天未访问，建议评估归档或销毁` });
  }
  if (row.status === '风险' || row.status === '待治理') {
    findings.push({
      type: '状态治理',
      level: row.status === '风险' ? '高' : '中',
      message: `资产状态为「${row.status}」，需纳入治理任务并跟踪闭环`,
    });
  }
  if (Number(row.size_gb) >= 1000) {
    findings.push({ type: '容量治理', level: '低', message: '存储规模超过 1TB，建议评估归档策略' });
  }
  return findings;
}

// ============ 筛选与排序 ============

interface AssetQuery {
  keyword?: unknown;
  level?: unknown;
  status?: unknown;
  categoryId?: unknown;
  deptId?: unknown;
  stage?: unknown;
  sort?: unknown;
}

function buildAssetFilter(user: AuthUser, q: AssetQuery): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const keyword = strOrUndef(q.keyword);
  if (keyword) {
    clauses.push('(a.asset_name LIKE ? OR a.asset_code LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const level = strOrUndef(q.level);
  if (level) {
    clauses.push('a.data_level = ?');
    params.push(level);
  }
  const status = strOrUndef(q.status);
  if (status) {
    clauses.push('a.status = ?');
    params.push(status);
  }
  const categoryId = numOrUndef(q.categoryId);
  if (categoryId !== undefined) {
    clauses.push('a.category_id = ?');
    params.push(categoryId);
  }
  const deptId = numOrUndef(q.deptId);
  if (deptId !== undefined) {
    clauses.push('a.dept_id = ?');
    params.push(deptId);
  }
  const stage = strOrUndef(q.stage);
  if (stage) {
    clauses.push('a.lifecycle_stage = ?');
    params.push(stage);
  }

  const scope = assetScope(user);
  if (scope.sql) {
    clauses.push(scope.sql.replace(/^AND\s+/, ''));
    params.push(...scope.params);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

const SORTABLE: Record<string, string> = {
  size_gb: 'a.size_gb',
  sensitivity_score: 'a.sensitivity_score',
  last_access_at: 'a.last_access_at',
};

function buildOrderBy(sort: unknown): string {
  const raw = strOrUndef(sort);
  if (!raw) return 'a.updated_at DESC, a.id DESC';
  const desc = raw.startsWith('-');
  const key = desc ? raw.slice(1) : raw;
  const column = SORTABLE[key];
  if (!column) return 'a.updated_at DESC, a.id DESC';
  return `${column} ${desc ? 'DESC' : 'ASC'}, a.id DESC`;
}

// ============ GET /stats ============

interface TotalRow {
  total: number | string;
  sensitive_count: number | string | null;
  avg_quality: number | string | null;
  avg_sensitivity: number | string | null;
  total_size: number | string | null;
  total_rows: number | string | null;
}

async function loadStats(user: AuthUser): Promise<Record<string, unknown>> {
  const scope = assetScope(user);
  const where = scopeWhere(scope);
  const params = scope.params;

  const [totals, levelRows, statusRows, stageRows, categoryRows, systemRows] = await Promise.all([
    queryOne<TotalRow>(
      `SELECT COUNT(*) AS total,
              SUM(a.data_level IN ('机密','绝密')) AS sensitive_count,
              ROUND(AVG(a.quality_score), 1) AS avg_quality,
              ROUND(AVG(a.sensitivity_score), 1) AS avg_sensitivity,
              ROUND(SUM(a.size_gb), 2) AS total_size,
              SUM(a.row_count) AS total_rows
         FROM data_asset a ${where}`,
      params,
    ),
    query<{ data_level: string; c: number | string }>(
      `SELECT a.data_level, COUNT(*) AS c FROM data_asset a ${where} GROUP BY a.data_level`,
      params,
    ),
    query<{ status: string; c: number | string }>(
      `SELECT a.status, COUNT(*) AS c FROM data_asset a ${where} GROUP BY a.status`,
      params,
    ),
    query<{ lifecycle_stage: string; c: number | string }>(
      `SELECT a.lifecycle_stage, COUNT(*) AS c FROM data_asset a ${where} GROUP BY a.lifecycle_stage`,
      params,
    ),
    query<{ category_id: number; category_name: string; asset_count: number | string; size_gb: number | string | null }>(
      `SELECT cat.id AS category_id, cat.category_name, COUNT(*) AS asset_count, ROUND(SUM(a.size_gb), 2) AS size_gb
         FROM data_asset a JOIN asset_category cat ON cat.id = a.category_id
         ${where}
        GROUP BY cat.id, cat.category_name, cat.sort
        ORDER BY asset_count DESC, cat.sort ASC, cat.id ASC
        LIMIT 6`,
      params,
    ),
    query<{ name: string; value: number | string }>(
      `SELECT a.source_system AS name, COUNT(*) AS value
         FROM data_asset a ${where}
        GROUP BY a.source_system ORDER BY value DESC, name ASC LIMIT 10`,
      params,
    ),
  ]);

  const total = Number(totals?.total ?? 0);
  const sensitive = Number(totals?.sensitive_count ?? 0);

  return {
    total,
    sensitive,
    sensitiveRate: total > 0 ? Math.round((sensitive / total) * 1000) / 10 : 0,
    avgQualityScore: Number(totals?.avg_quality ?? 0),
    avgSensitivityScore: Number(totals?.avg_sensitivity ?? 0),
    totalSizeGb: Number(totals?.total_size ?? 0),
    totalRows: Number(totals?.total_rows ?? 0),
    levelDistribution: LEVELS.map((level) => ({
      name: level,
      value: Number(levelRows.find((r) => r.data_level === level)?.c ?? 0),
    })),
    statusDistribution: STATUSES.map((status) => ({
      name: status,
      value: Number(statusRows.find((r) => r.status === status)?.c ?? 0),
    })),
    stageDistribution: STAGES.map((stage) => ({
      name: stage,
      value: Number(stageRows.find((r) => r.lifecycle_stage === stage)?.c ?? 0),
    })),
    categoryTop: categoryRows.map((r) => ({
      category_id: Number(r.category_id),
      category_name: r.category_name,
      count: Number(r.asset_count),
      size_gb: Number(r.size_gb ?? 0),
    })),
    sourceSystem: systemRows.map((r) => ({ name: r.name, value: Number(r.value) })),
  };
}

assetsRouter.get('/stats', read, async (req, res) => {
  const user = currentUser(req);
  const scope = assetScope(user);
  const data = await cached(`assets:stats:${JSON.stringify(scope)}`, 15, () => loadStats(user));
  ok(res, data);
});

// ============ GET /categories ============

interface CategoryRow {
  id: number;
  category_code: string;
  category_name: string;
  parent_id: number;
  description: string | null;
  sort: number;
}

interface CategoryCountRow {
  category_id: number;
  total: number | string;
  lv_public: number | string | null;
  lv_internal: number | string | null;
  lv_secret: number | string | null;
  lv_top: number | string | null;
}

interface CategoryNode {
  id: number;
  category_code: string;
  category_name: string;
  parent_id: number;
  description: string | null;
  sort: number;
  assetCount: number;
  levelCounts: Record<string, number>;
  children: CategoryNode[];
}

async function loadCategories(user: AuthUser): Promise<Record<string, unknown>> {
  const scope = assetScope(user);
  const where = scopeWhere(scope);
  const params = scope.params;

  const [cats, counts, levelRows] = await Promise.all([
    query<CategoryRow>(
      'SELECT id, category_code, category_name, parent_id, description, sort FROM asset_category ORDER BY sort ASC, id ASC',
    ),
    query<CategoryCountRow>(
      `SELECT a.category_id,
              COUNT(*) AS total,
              SUM(a.data_level = '公开') AS lv_public,
              SUM(a.data_level = '内部') AS lv_internal,
              SUM(a.data_level = '机密') AS lv_secret,
              SUM(a.data_level = '绝密') AS lv_top
         FROM data_asset a ${where}
        GROUP BY a.category_id`,
      params,
    ),
    query<{ data_level: string; c: number | string }>(
      `SELECT a.data_level, COUNT(*) AS c FROM data_asset a ${where} GROUP BY a.data_level`,
      params,
    ),
  ]);

  const countMap = new Map<number, CategoryCountRow>();
  for (const row of counts) countMap.set(Number(row.category_id), row);

  const nodes = new Map<number, CategoryNode>();
  for (const cat of cats) {
    const owned = countMap.get(Number(cat.id));
    nodes.set(cat.id, {
      id: cat.id,
      category_code: cat.category_code,
      category_name: cat.category_name,
      parent_id: Number(cat.parent_id),
      description: cat.description,
      sort: Number(cat.sort),
      assetCount: Number(owned?.total ?? 0),
      levelCounts: {
        公开: Number(owned?.lv_public ?? 0),
        内部: Number(owned?.lv_internal ?? 0),
        机密: Number(owned?.lv_secret ?? 0),
        绝密: Number(owned?.lv_top ?? 0),
      },
      children: [],
    });
  }

  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id && nodes.get(node.parent_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const aggregate = (node: CategoryNode): void => {
    for (const child of node.children) {
      aggregate(child);
      node.assetCount += child.assetCount;
      for (const level of LEVELS) node.levelCounts[level] = (node.levelCounts[level] ?? 0) + (child.levelCounts[level] ?? 0);
    }
  };
  for (const root of roots) aggregate(root);
  roots.sort((a, b) => a.sort - b.sort || a.id - b.id);

  const levelTotals = LEVELS.map((level) => ({
    name: level,
    value: Number(levelRows.find((r) => r.data_level === level)?.c ?? 0),
  }));

  return {
    tree: roots,
    levelTotals,
    categoryCount: cats.length,
    total: levelTotals.reduce((sum, item) => sum + item.value, 0),
  };
}

assetsRouter.get('/categories', read, async (req, res) => {
  const user = currentUser(req);
  const scope = assetScope(user);
  const data = await cached(`assets:categories:${JSON.stringify(scope)}`, 15, () => loadCategories(user));
  ok(res, data);
});

// ============ GET /tags ============

assetsRouter.get('/tags', read, async (req, res) => {
  const user = currentUser(req);
  const scope = assetScope(user);
  const where = scopeWhere(scope);
  const rows = await query<{ tag_name: string; count: number | string }>(
    `SELECT t.tag_name, COUNT(*) AS count
       FROM asset_tag t JOIN data_asset a ON a.id = t.asset_id
       ${where}
      GROUP BY t.tag_name
      ORDER BY count DESC, t.tag_name ASC
      LIMIT 80`,
    scope.params,
  );
  ok(res, rows.map((r) => ({ tag_name: r.tag_name, count: Number(r.count) })));
});

// ============ GET /export ============

const CSV_HEADERS = [
  '资产编号', '资产名称', '所属分类', '责任部门', '来源系统', '数据类型', '数据级别', '状态', '生命周期阶段',
  '存储大小(GB)', '记录数', '数据责任人', '敏感度分', '质量分', '发现时间', '最近访问时间',
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

assetsRouter.get('/export', read, async (req, res) => {
  const user = currentUser(req);
  const { where, params } = buildAssetFilter(user, req.query as AssetQuery);
  const rows = await query<AssetDbRow>(
    `SELECT a.*, cat.category_name, d.dept_name
       FROM data_asset a
       LEFT JOIN asset_category cat ON cat.id = a.category_id
       LEFT JOIN sys_dept d ON d.id = a.dept_id
       ${where}
      ORDER BY a.asset_code ASC
      LIMIT 5000`,
    params,
  );

  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    const dto = toAssetDto(row);
    lines.push([
      dto.asset_code, dto.asset_name, dto.category_name, dto.dept_name, dto.source_system,
      dto.data_type, dto.data_level, dto.status, dto.lifecycle_stage,
      dto.size_gb, dto.row_count, dto.owner, dto.sensitivity_score, dto.quality_score,
      dto.discovered_at, dto.last_access_at,
    ].map(csvCell).join(','));
  }

  const datePart = today().replace(/-/g, '');
  const filename = `数据资产台账_${datePart}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="assets_${datePart}.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.status(200).send(`\uFEFF${lines.join('\r\n')}`);
});

// ============ POST /scan（全局扫描，演示近似） ============

assetsRouter.post('/scan', write, async (req, res) => {
  const user = currentUser(req);
  const scope = assetScope(user);
  const where = scopeWhere(scope);
  const started = Date.now();

  const rows = await query<AssetDbRow & { tag_count: number | string }>(
    `SELECT a.id, a.asset_code, a.asset_name, a.data_level, a.status, a.size_gb, a.last_access_at,
            a.lifecycle_stage, a.sensitivity_score,
            (SELECT COUNT(*) FROM asset_tag t WHERE t.asset_id = a.id) AS tag_count
       FROM data_asset a ${where}
      ORDER BY a.sensitivity_score DESC, a.id ASC`,
    scope.params,
  );

  let changed = 0;
  for (const row of rows) {
    const score = computeSensitivity({
      data_level: row.data_level,
      status: row.status,
      size_gb: Number(row.size_gb),
      last_access_at: row.last_access_at,
      tagCount: Number(row.tag_count),
    });
    if (score !== Number(row.sensitivity_score)) changed += 1;
  }

  const systemRow = await queryOne<{ c: number | string }>(
    `SELECT COUNT(DISTINCT a.source_system) AS c FROM data_asset a ${where}`,
    scope.params,
  );
  const durationMs = Math.max(1, Date.now() - started);
  const taskId = `SCAN-${today().replace(/-/g, '')}-${String(Date.now()).slice(-6)}`;
  const systems = Number(systemRow?.c ?? 0);

  const carrier = rows[0];
  if (carrier) {
    await addLifecycle(
      carrier.id,
      carrier.lifecycle_stage,
      '全局敏感度扫描',
      operatorOf(user),
      `全局扫描任务 ${taskId}：扫描 ${rows.length} 个资产、覆盖 ${systems} 个来源系统，评分建议变更 ${changed} 个，耗时 ${durationMs}ms`,
    );
  }

  req.auditAction = '执行全局资产扫描';
  req.auditDetail = `扫描资产 ${rows.length} 个，覆盖来源系统 ${systems} 个，评分变更 ${changed} 个`;

  ok(res, {
    taskId,
    scanned: rows.length,
    newAssets: 0,
    changed,
    durationMs,
    sourceSystems: systems,
    operator: operatorOf(user),
    scannedAt: now(),
  });
});

// ============ GET /（分页列表） ============

assetsRouter.get('/', read, async (req, res) => {
  const user = currentUser(req);
  const page = parsePagination(req.query as Record<string, unknown>);
  const { where, params } = buildAssetFilter(user, req.query as AssetQuery);
  const orderBy = buildOrderBy(req.query.sort);

  const [totalRow, rows] = await Promise.all([
    queryOne<{ c: number | string }>(`SELECT COUNT(*) AS c FROM data_asset a ${where}`, params),
    query<AssetDbRow>(
      `SELECT a.*, cat.category_name, cat.category_code, d.dept_name,
              (SELECT GROUP_CONCAT(t.tag_name ORDER BY t.id SEPARATOR ',') FROM asset_tag t WHERE t.asset_id = a.id) AS tag_names
         FROM data_asset a
         LEFT JOIN asset_category cat ON cat.id = a.category_id
         LEFT JOIN sys_dept d ON d.id = a.dept_id
         ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
      [...params, page.pageSize, page.offset],
    ),
  ]);

  ok(res, rows.map(toAssetDto), pageMeta(Number(totalRow?.c ?? 0), page));
});

// ============ GET /:id（详情） ============

async function loadAssetDetail(user: AuthUser, id: number): Promise<Record<string, unknown>> {
  const scope = assetScope(user);
  const row = await queryOne<AssetDbRow>(
    `SELECT a.*, cat.category_name, cat.category_code, d.dept_name,
            (SELECT COUNT(*) FROM risk_event re WHERE re.asset_id = a.id) AS risk_count,
            (SELECT COUNT(*) FROM share_approval sa WHERE sa.asset_id = a.id) AS share_count,
            (SELECT COUNT(*) FROM compliance_check cc
              WHERE cc.target = a.source_system OR cc.target LIKE CONCAT('%', a.asset_name, '%')) AS check_count
       FROM data_asset a
       LEFT JOIN asset_category cat ON cat.id = a.category_id
       LEFT JOIN sys_dept d ON d.id = a.dept_id
      WHERE a.id = ? ${scope.sql}`,
    [id, ...scope.params],
  );
  if (!row) throw new ApiError(404, '资产不存在或超出当前数据权限范围');

  const [tags, lifecycle] = await Promise.all([
    query<{ tag_name: string }>('SELECT tag_name FROM asset_tag WHERE asset_id = ? ORDER BY id ASC', [id]),
    query<LifecycleRow>(
      'SELECT id, asset_id, stage, action, operator, detail, occurred_at FROM asset_lifecycle WHERE asset_id = ? ORDER BY occurred_at DESC, id DESC',
      [id],
    ),
  ]);

  return {
    ...toAssetDto(row),
    tags: tags.map((t) => t.tag_name),
    lifecycle: lifecycle.map(toLifecycleDto),
    riskCount: Number(row.risk_count ?? 0),
    checkCount: Number(row.check_count ?? 0),
    shareCount: Number(row.share_count ?? 0),
  };
}

assetsRouter.get('/:id', read, async (req, res) => {
  const user = currentUser(req);
  const data = await loadAssetDetail(user, parseId(req.params.id));
  ok(res, data);
});

// ============ POST /（新建资产） ============

const tagsSchema = z.array(z.string().trim().min(1, '标签不能为空').max(32)).max(20).optional();

const createAssetSchema = z.object({
  asset_name: z.string().trim().min(2, '资产名称至少 2 个字符').max(128),
  category_id: z.coerce.number().int('资产分类不合法').positive('请选择资产分类'),
  dept_id: z.coerce.number().int('责任部门不合法').positive('请选择责任部门'),
  source_system: z.string().trim().min(1, '请填写来源系统').max(64),
  data_type: z.enum(DATA_TYPES),
  data_level: z.enum(LEVELS),
  owner: z.string().trim().min(1, '请填写数据责任人').max(32),
  file_format: z.string().trim().max(32).optional(),
  size_gb: z.coerce.number().min(0, '存储大小不能为负').max(1000000).optional(),
  row_count: z.coerce.number().int().min(0).max(100000000000).optional(),
  status: z.enum(STATUSES).optional(),
  lifecycle_stage: z.enum(STAGES).optional(),
  sensitivity_score: z.coerce.number().int().min(0).max(100).optional(),
  quality_score: z.coerce.number().int().min(0).max(100).optional(),
  description: z.string().trim().max(512).optional(),
  tags: tagsSchema,
});

assetsRouter.post('/', write, async (req, res) => {
  const user = currentUser(req);
  const body = createAssetSchema.parse(req.body);
  await ensureRefs(body.category_id, body.dept_id);
  const assetCode = await nextAssetCode();

  let assetId: number;
  try {
    const result = await execute(
      `INSERT INTO data_asset
         (asset_code, asset_name, category_id, dept_id, source_system, data_type, data_level, file_format,
          size_gb, row_count, owner, status, lifecycle_stage, sensitivity_score, quality_score, description,
          discovered_at, last_access_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      [
        assetCode,
        body.asset_name,
        body.category_id,
        body.dept_id,
        body.source_system,
        body.data_type,
        body.data_level,
        body.file_format ?? null,
        body.size_gb ?? 0,
        body.row_count ?? 0,
        body.owner,
        body.status ?? '正常',
        body.lifecycle_stage ?? '采集',
        body.sensitivity_score ?? computeSensitivity({
          data_level: body.data_level,
          status: body.status ?? '正常',
          size_gb: body.size_gb ?? 0,
          last_access_at: null,
          tagCount: body.tags?.length ?? 0,
        }),
        body.quality_score ?? 90,
        body.description ?? null,
        now(),
      ],
    );
    assetId = result.insertId;
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new ApiError(409, '资产编号生成冲突，请重试');
    throw err;
  }

  if (body.tags?.length) {
    const placeholders = body.tags.map(() => '(?,?)').join(',');
    await execute(
      `INSERT INTO asset_tag (asset_id, tag_name) VALUES ${placeholders}`,
      body.tags.flatMap((tag) => [assetId, tag]),
    );
  }

  await addLifecycle(
    assetId,
    '采集',
    '资产登记入库',
    operatorOf(user),
    `从「${body.source_system}」登记数据资产「${body.asset_name}」，初始分级「${body.data_level}」，责任人 ${body.owner}`,
  );

  req.auditAction = '登记数据资产';
  req.auditDetail = `登记资产 ${assetCode}「${body.asset_name}」，初始分级「${body.data_level}」`;

  invalidateAssets();
  const data = await loadAssetDetail(user, assetId);
  ok(res, data, undefined, 201);
});

// ============ PUT /:id/level（分级调整） ============

const levelSchema = z.object({
  data_level: z.enum(LEVELS),
  reason: z.string().trim().min(2, '请填写分级调整原因').max(200),
});

assetsRouter.put('/:id/level', write, async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const body = levelSchema.parse(req.body);
  const existing = await findAssetInScope(user, id);
  if (!existing) throw new ApiError(404, '资产不存在或超出当前数据权限范围');
  if (existing.data_level === body.data_level) throw new ApiError(400, '新分级与原分级一致，无需调整');

  const tagCount = await tagCountOf(id);
  const score = computeSensitivity({
    data_level: body.data_level,
    status: existing.status,
    size_gb: Number(existing.size_gb),
    last_access_at: existing.last_access_at,
    tagCount,
  });

  await execute(
    'UPDATE data_asset SET data_level = ?, sensitivity_score = ?, updated_at = ? WHERE id = ?',
    [body.data_level, score, now(), id],
  );
  await addLifecycle(
    id,
    existing.lifecycle_stage,
    '数据分级调整',
    operatorOf(user),
    `数据级别由「${existing.data_level}」调整为「${body.data_level}」，原因：${body.reason}；敏感度分 ${Number(existing.sensitivity_score)} → ${score}`,
  );

  req.auditAction = '调整资产分级';
  req.auditDetail = `资产 ${existing.asset_code}「${existing.data_level}」→「${body.data_level}」，原因：${body.reason}`;

  invalidateAssets();
  ok(res, {
    id,
    asset_code: existing.asset_code,
    old_level: existing.data_level,
    data_level: body.data_level,
    sensitivity_score: score,
    reason: body.reason,
    updated_at: now(),
  });
});

// ============ POST /:id/scan（单资产扫描复核） ============

assetsRouter.post('/:id/scan', write, async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const existing = await findAssetInScope(user, id);
  if (!existing) throw new ApiError(404, '资产不存在或超出当前数据权限范围');

  const tagCount = await tagCountOf(id);
  const score = computeSensitivity({
    data_level: existing.data_level,
    status: existing.status,
    size_gb: Number(existing.size_gb),
    last_access_at: existing.last_access_at,
    tagCount,
  });
  const findings = buildFindings(existing, score, tagCount);

  await execute('UPDATE data_asset SET sensitivity_score = ?, updated_at = ? WHERE id = ?', [score, now(), id]);
  await addLifecycle(
    id,
    existing.lifecycle_stage,
    '敏感度扫描复核',
    operatorOf(user),
    `敏感度分由 ${Number(existing.sensitivity_score)} 调整为 ${score}，发现 ${findings.length} 项复核意见`,
  );

  req.auditAction = '执行资产扫描复核';
  req.auditDetail = `资产 ${existing.asset_code} 敏感度分 ${Number(existing.sensitivity_score)} → ${score}，发现 ${findings.length} 项`;

  invalidateAssets();
  ok(res, {
    id,
    asset_code: existing.asset_code,
    old_score: Number(existing.sensitivity_score),
    sensitivity_score: score,
    findings,
    scannedAt: now(),
    operator: operatorOf(user),
  });
});

// ============ PUT /:id（更新资产） ============

const updateAssetSchema = createAssetSchema.partial();

assetsRouter.put('/:id', write, async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const body = updateAssetSchema.parse(req.body);
  const existing = await findAssetInScope(user, id);
  if (!existing) throw new ApiError(404, '资产不存在或超出当前数据权限范围');

  await ensureRefs(body.category_id, body.dept_id);

  const sets: string[] = [];
  const values: unknown[] = [];
  const setField = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`);
    values.push(value);
  };

  if (body.asset_name !== undefined) setField('asset_name', body.asset_name);
  if (body.category_id !== undefined) setField('category_id', body.category_id);
  if (body.dept_id !== undefined) setField('dept_id', body.dept_id);
  if (body.source_system !== undefined) setField('source_system', body.source_system);
  if (body.data_type !== undefined) setField('data_type', body.data_type);
  if (body.data_level !== undefined) setField('data_level', body.data_level);
  if (body.file_format !== undefined) setField('file_format', body.file_format);
  if (body.size_gb !== undefined) setField('size_gb', body.size_gb);
  if (body.row_count !== undefined) setField('row_count', body.row_count);
  if (body.owner !== undefined) setField('owner', body.owner);
  if (body.status !== undefined) setField('status', body.status);
  if (body.lifecycle_stage !== undefined) setField('lifecycle_stage', body.lifecycle_stage);
  if (body.sensitivity_score !== undefined) setField('sensitivity_score', body.sensitivity_score);
  if (body.quality_score !== undefined) setField('quality_score', body.quality_score);
  if (body.description !== undefined) setField('description', body.description);

  const levelChanged = body.data_level !== undefined && body.data_level !== existing.data_level;
  if (levelChanged && body.sensitivity_score === undefined) {
    const tagCount = body.tags !== undefined ? body.tags.length : await tagCountOf(id);
    const score = computeSensitivity({
      data_level: body.data_level as string,
      status: body.status ?? existing.status,
      size_gb: body.size_gb ?? Number(existing.size_gb),
      last_access_at: existing.last_access_at,
      tagCount,
    });
    setField('sensitivity_score', score);
  }

  if (!sets.length && body.tags === undefined) throw new ApiError(400, '未提供可更新的字段');

  if (sets.length) {
    sets.push('updated_at = ?');
    values.push(now());
    await execute(`UPDATE data_asset SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
  }

  if (body.tags !== undefined) {
    await execute('DELETE FROM asset_tag WHERE asset_id = ?', [id]);
    if (body.tags.length) {
      const placeholders = body.tags.map(() => '(?,?)').join(',');
      await execute(
        `INSERT INTO asset_tag (asset_id, tag_name) VALUES ${placeholders}`,
        body.tags.flatMap((tag) => [id, tag]),
      );
    }
  }

  if (levelChanged) {
    await addLifecycle(
      id,
      body.lifecycle_stage ?? existing.lifecycle_stage,
      '数据分级调整',
      operatorOf(user),
      `数据级别由「${existing.data_level}」调整为「${body.data_level}」${body.description ? `；说明：${body.description}` : ''}`,
    );
  }

  req.auditAction = body.data_level !== undefined || body.status !== undefined ? '更新资产分级/状态' : '更新数据资产';
  req.auditDetail = `更新资产 ${existing.asset_code}「${existing.asset_name}」`;
  invalidateAssets();
  ok(res, await loadAssetDetail(user, id));
});

// ============ GET /:id/lifecycle ============

assetsRouter.get('/:id/lifecycle', read, async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const existing = await findAssetInScope(user, id);
  if (!existing) throw new ApiError(404, '资产不存在或超出当前数据权限范围');

  const rows = await query<LifecycleRow>(
    'SELECT id, asset_id, stage, action, operator, detail, occurred_at FROM asset_lifecycle WHERE asset_id = ? ORDER BY occurred_at DESC, id DESC',
    [id],
  );
  ok(res, rows.map(toLifecycleDto));
});
