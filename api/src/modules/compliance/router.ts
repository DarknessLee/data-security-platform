import { createCipheriv, createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne } from '../../db/pool.ts';
import { invalidate } from '../../db/redis.ts';
import { ApiError, ok } from '../../lib/http.ts';
import { numOrUndef, pageMeta, parsePagination, strOrUndef } from '../../lib/query.ts';
import { fmtDate, fmtDateTime, today } from '../../lib/time.ts';
import { authenticate, currentUser, dataScopeFilter, requirePerm } from '../../middleware/auth.ts';

/**
 * 安全合规管理模块（module: compliance）
 * 规则库 / 合规检查 / 整改跟踪 / 脱敏管理 / 共享审批 / 合规报告
 * 契约见 docs/接口契约.md 第四章；表结构见 api/db/schema.sql。
 */
export const complianceRouter = Router();

complianceRouter.use(authenticate);

const READ = requirePerm('compliance');
const WRITE = requirePerm('compliance', 'write');

const BASES = ['数据安全法', '个人信息保护法', '等保2.0', '行业规范'] as const;
const CATEGORIES = ['分类分级', '访问控制', '加密脱敏', '审计留痕', '跨境传输', '合规管理'] as const;
const RISK_LEVELS = ['低', '中', '高', '紧急'] as const;
const CHECK_RESULTS = ['通过', '警告', '不通过'] as const;
const RECTIFY_STATUSES = ['待整改', '整改中', '已闭环', '已逾期'] as const;
const APPROVAL_STATUSES = ['待审批', '已通过', '已驳回', '已撤回'] as const;
const MASKING_ALGORITHMS = ['掩码', '哈希', '加密', '泛化'] as const;
const MASKING_TYPES = ['静态', '动态'] as const;
const RULE_STATUSES = ['启用', '停用'] as const;
const SHARE_WAYS = ['接口', '文件', '数据库直连'] as const;

/** 固定密钥仅用于演示环境“可逆加密”脱敏算法，生产须走 KMS 托管密钥 */
const MASKING_KEY = createHash('sha256').update('datasec-compliance-masking-2026').digest();
const MASKING_IV = createHash('md5').update('datasec-masking-iv-2026').digest();

// ============ 类型 ============

interface RuleRecord {
  id: number;
  rule_code: string;
  rule_title: string;
  basis: string;
  category: string;
  requirement: string;
  risk_level: string;
  check_method: string;
  status: string;
  created_at: Date | string;
  last_result?: string | null;
  last_checked_at?: Date | string | null;
}

interface CheckRecord {
  id: number;
  rule_id: number;
  batch_no: string;
  target: string;
  result: string;
  score: number;
  evidence: string | null;
  duration_ms: number;
  checked_at: Date | string;
  rule_code: string;
  rule_title: string;
  basis: string;
  category: string;
  risk_level: string;
}

interface RectifyRecord {
  id: number;
  rectify_no: string;
  check_id: number;
  title: string;
  owner: string;
  dept_id: number;
  due_date: string | Date;
  status: string;
  progress: number;
  measure: string | null;
  closed_at: Date | string | null;
  created_at: Date | string;
  dept_name?: string | null;
  batch_no?: string | null;
  rule_code?: string | null;
  rule_title?: string | null;
  risk_level?: string | null;
  category?: string | null;
}

interface ApprovalRecord {
  id: number;
  approval_no: string;
  asset_id: number;
  applicant_id: number;
  applicant_name: string;
  receiver: string;
  purpose: string;
  share_way: string;
  risk_level: string;
  status: string;
  approver: string | null;
  approved_at: Date | string | null;
  comment: string | null;
  created_at: Date | string;
  asset_name?: string | null;
  asset_code?: string | null;
  asset_level?: string | null;
  applicant_dept?: string | null;
}

interface MaskingRecord {
  id: number;
  rule_name: string;
  field_pattern: string;
  algorithm: string;
  mask_type: string;
  scene: string;
  status: string;
  sample_before: string;
  sample_after: string;
  updated_at: Date | string;
}

interface BatchStat {
  batch_no: string;
  checked_at: string | null;
  total: number;
  passed: number;
  warning: number;
  failed: number;
  rate: number;
}

// ============ 通用小工具 ============

function dtText(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return fmtDateTime(v);
  return String(v);
}

function dayText(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return fmtDate(v);
  return String(v).slice(0, 10);
}

function intOf(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function rateOf(passed: number, total: number): number {
  if (!total) return 0;
  return Math.round((passed / total) * 1000) / 10;
}

function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return fmtDate(d);
}

function parseId(raw: string | string[] | undefined): number {
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, '无效的记录 ID');
  return id;
}

function enumOf(values: readonly string[]): z.ZodType<string> {
  return z
    .string()
    .trim()
    .refine((v) => values.includes(v), { message: `取值需为：${values.join('/')}` });
}

async function nextRuleCode(): Promise<string> {
  const rows = await query<{ code: string }>("SELECT rule_code AS code FROM compliance_rule WHERE rule_code LIKE 'CR-%'");
  let max = 0;
  for (const row of rows) {
    const m = /^CR-(\d+)$/.exec(row.code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CR-${String(max + 1).padStart(3, '0')}`;
}

async function nextRectifyNo(): Promise<string> {
  const rows = await query<{ no: string }>("SELECT rectify_no AS no FROM compliance_rectify WHERE rectify_no LIKE 'ZG-%'");
  let max = 0;
  for (const row of rows) {
    const m = /^ZG-\d{4}-(\d+)$/.exec(row.no);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `ZG-2026-${String(max + 1).padStart(3, '0')}`;
}

async function nextApprovalNo(): Promise<string> {
  const rows = await query<{ no: string }>("SELECT approval_no AS no FROM share_approval WHERE approval_no LIKE 'SQ-%'");
  let max = 0;
  for (const row of rows) {
    const m = /^SQ-\d{4}-(\d+)$/.exec(row.no);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `SQ-2026-${String(max + 1).padStart(3, '0')}`;
}

async function nextBatchNo(): Promise<string> {
  const rows = await query<{ no: string }>("SELECT DISTINCT batch_no AS no FROM compliance_check WHERE batch_no LIKE 'CHK-%'");
  let max = 0;
  for (const row of rows) {
    const m = /^CHK-(\d{4})-(\d+)$/.exec(row.no);
    if (m) max = Math.max(max, Number(m[2]));
  }
  return `CHK-${new Date().getFullYear()}-${String(max + 1).padStart(3, '0')}`;
}

function formatRule(r: RuleRecord) {
  return {
    id: r.id,
    rule_code: r.rule_code,
    rule_title: r.rule_title,
    basis: r.basis,
    category: r.category,
    requirement: r.requirement,
    risk_level: r.risk_level,
    check_method: r.check_method,
    status: r.status,
    created_at: dtText(r.created_at),
    last_result: r.last_result ?? null,
    last_checked_at: dtText(r.last_checked_at ?? null),
  };
}

function formatCheck(c: CheckRecord) {
  return {
    id: c.id,
    rule_id: c.rule_id,
    batch_no: c.batch_no,
    target: c.target,
    result: c.result,
    score: intOf(c.score),
    evidence: c.evidence,
    duration_ms: intOf(c.duration_ms),
    checked_at: dtText(c.checked_at),
    rule_code: c.rule_code,
    rule_title: c.rule_title,
    basis: c.basis,
    category: c.category,
    risk_level: c.risk_level,
  };
}

function formatRectify(r: RectifyRecord) {
  const due = dayText(r.due_date);
  return {
    id: r.id,
    rectify_no: r.rectify_no,
    check_id: r.check_id,
    title: r.title,
    owner: r.owner,
    dept_id: r.dept_id,
    dept_name: r.dept_name ?? null,
    due_date: due,
    status: r.status,
    progress: intOf(r.progress),
    measure: r.measure,
    closed_at: dtText(r.closed_at),
    created_at: dtText(r.created_at),
    batch_no: r.batch_no ?? null,
    rule_code: r.rule_code ?? null,
    rule_title: r.rule_title ?? null,
    risk_level: r.risk_level ?? null,
    category: r.category ?? null,
    overdue: r.status === '已逾期' || (r.status !== '已闭环' && due !== null && due < today()),
  };
}

function formatApproval(a: ApprovalRecord) {
  return {
    id: a.id,
    approval_no: a.approval_no,
    asset_id: a.asset_id,
    applicant_id: a.applicant_id,
    applicant_name: a.applicant_name,
    applicant_dept: a.applicant_dept ?? null,
    asset_name: a.asset_name ?? null,
    asset_code: a.asset_code ?? null,
    asset_level: a.asset_level ?? null,
    receiver: a.receiver,
    purpose: a.purpose,
    share_way: a.share_way,
    risk_level: a.risk_level,
    status: a.status,
    approver: a.approver,
    approved_at: dtText(a.approved_at),
    comment: a.comment,
    created_at: dtText(a.created_at),
  };
}

function formatMasking(m: MaskingRecord) {
  return {
    id: m.id,
    rule_name: m.rule_name,
    field_pattern: m.field_pattern,
    algorithm: m.algorithm,
    mask_type: m.mask_type,
    scene: m.scene,
    status: m.status,
    sample_before: m.sample_before,
    sample_after: m.sample_after,
    updated_at: dtText(m.updated_at),
  };
}

/** 超期未闭环的整改单一律标记为“已逾期”（GET 时惰性刷新，保证列表与统计一致） */
async function markOverdue(): Promise<number> {
  const result = await execute(
    "UPDATE compliance_rectify SET status = '已逾期' WHERE status IN ('待整改', '整改中') AND due_date < CURDATE()",
  );
  return result.affectedRows;
}

function toBatchStat(row: {
  batch_no: string;
  checked_at: Date | string | null;
  total: number;
  passed: number;
  warning: number;
  failed: number;
}): BatchStat {
  const total = intOf(row.total);
  const passed = intOf(row.passed);
  return {
    batch_no: row.batch_no,
    checked_at: dtText(row.checked_at),
    total,
    passed,
    warning: intOf(row.warning),
    failed: intOf(row.failed),
    rate: rateOf(passed, total),
  };
}

async function loadBatches(): Promise<BatchStat[]> {
  const rows = await query<{
    batch_no: string;
    checked_at: Date | string;
    total: number;
    passed: number;
    warning: number;
    failed: number;
  }>(
    `SELECT batch_no, MAX(checked_at) AS checked_at, COUNT(*) AS total,
            SUM(result = '通过') AS passed, SUM(result = '警告') AS warning, SUM(result = '不通过') AS failed
       FROM compliance_check
      GROUP BY batch_no
      ORDER BY MAX(checked_at) DESC, batch_no DESC`,
  );
  return rows.map(toBatchStat);
}

async function loadBatchStat(batchNo: string): Promise<BatchStat | null> {
  const row = await queryOne<{
    batch_no: string;
    checked_at: Date | string;
    total: number;
    passed: number;
    warning: number;
    failed: number;
  }>(
    `SELECT batch_no, MAX(checked_at) AS checked_at, COUNT(*) AS total,
            SUM(result = '通过') AS passed, SUM(result = '警告') AS warning, SUM(result = '不通过') AS failed
       FROM compliance_check WHERE batch_no = ? GROUP BY batch_no`,
    [batchNo],
  );
  return row && intOf(row.total) > 0 ? toBatchStat(row) : null;
}

/** 给拥有 compliance 写权限的用户写站内通知（用于共享审批流转） */
async function notifyUsers(
  userIds: number[],
  title: string,
  content: string,
  level: '信息' | '警告' | '紧急',
  bizId: number,
): Promise<number> {
  if (!userIds.length) return 0;
  const createdAt = fmtDateTime(new Date());
  const values: unknown[] = [];
  const placeholders = userIds.map(() => {
    return '(?,?,?,?,?,?,?)';
  });
  for (const userId of userIds) {
    values.push(userId, title.slice(0, 128), content.slice(0, 512), level, 'compliance', bizId, createdAt);
  }
  await execute(
    `INSERT INTO notification (user_id, title, content, level, biz_type, biz_id, created_at)
     VALUES ${placeholders.join(',')}`,
    values,
  );
  return userIds.length;
}

async function loadComplianceWriters(excludeUserId: number): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `SELECT DISTINCT u.id
       FROM sys_user u
       JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id AND r.status = 1
       JOIN sys_role_menu rm ON rm.role_id = r.id AND rm.perm_write = 1
       JOIN sys_menu m ON m.id = rm.menu_id AND m.permission_code = 'compliance'
      WHERE u.status = 1 AND u.id <> ?`,
    [excludeUserId],
  );
  return rows.map((r) => intOf(r.id));
}

// ============ 脱敏算法（真实执行） ============

function maskByStars(sample: string): string {
  if (sample.includes('@')) {
    const at = sample.indexOf('@');
    const local = sample.slice(0, at);
    const domain = sample.slice(at);
    return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 1))}${domain}`;
  }
  if (/^\d+$/.test(sample)) {
    if (sample.length >= 15) {
      return sample.slice(0, 6) + '*'.repeat(Math.max(sample.length - 10, 1)) + sample.slice(-4);
    }
    if (sample.length === 11) return `${sample.slice(0, 3)}****${sample.slice(-4)}`;
    if (sample.length > 4) return sample.slice(0, 2) + '*'.repeat(sample.length - 4) + sample.slice(-2);
    return '*'.repeat(sample.length);
  }
  if (/^[\u4e00-\u9fa5·]+$/.test(sample)) {
    return sample.slice(0, 1) + '*'.repeat(Math.max(sample.length - 1, 2));
  }
  const keep = Math.max(1, Math.round(sample.length * 0.3));
  const tail = Math.max(1, Math.round(sample.length * 0.15));
  return sample.slice(0, keep) + '*'.repeat(Math.max(sample.length - keep - tail, 1)) + sample.slice(-tail);
}

/** 泛化：保留行政层级 / 数值分档 / 日期到月 */
function generalizeValue(sample: string): string {
  const region = /^(.*[省市区县])/.exec(sample);
  if (region) return region[1];
  const dateLike = /^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/.exec(sample);
  if (dateLike) return dateLike[3] ? `${dateLike[1]}-${dateLike[2]}` : dateLike[1];
  if (/^\d+(\.\d+)?$/.test(sample)) {
    const n = Number(sample);
    if (n >= 1000) return String(Math.floor(n / 100) * 100);
    if (n >= 100) return String(Math.floor(n / 10) * 10);
    return String(Math.floor(n));
  }
  const cut = Math.max(2, Math.ceil(sample.length / 2));
  return `${sample.slice(0, cut)}…`;
}

function applyMasking(algorithm: string, sample: string): string {
  switch (algorithm) {
    case '掩码':
      return maskByStars(sample);
    case '哈希':
      return createHash('sha256').update(`datasec:${sample}`).digest('hex');
    case '加密': {
      const cipher = createCipheriv('aes-256-cbc', MASKING_KEY, MASKING_IV);
      return cipher.update(sample, 'utf8', 'base64') + cipher.final('base64');
    }
    case '泛化':
      return generalizeValue(sample);
    default:
      return maskByStars(sample);
  }
}

// ============ 概览 ============

complianceRouter.get('/overview', READ, async (_req, res) => {
  await markOverdue();

  const ruleTotal = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM compliance_rule');
  const ruleEnabled = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM compliance_rule WHERE status = '启用'");
  const checkTotal = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM compliance_check');
  const rectify = await queryOne<{ total: number; closed: number; overdue: number; open: number }>(
    `SELECT COUNT(*) AS total,
            SUM(status = '已闭环') AS closed,
            SUM(status = '已逾期') AS overdue,
            SUM(status <> '已闭环') AS open
       FROM compliance_rectify`,
  );
  const pendingApproval = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM share_approval WHERE status = '待审批'");
  const masking = await queryOne<{ total: number; enabled: number }>(
    "SELECT COUNT(*) AS total, SUM(status = '启用') AS enabled FROM masking_rule",
  );

  const batches = await loadBatches();
  const latest = batches[0] ?? null;

  const categoryRows = await query<{ name: string; value: number }>(
    'SELECT category AS name, COUNT(*) AS value FROM compliance_rule GROUP BY category',
  );
  const categoryDist = CATEGORIES.map((name) => ({
    name,
    value: intOf(categoryRows.find((r) => r.name === name)?.value),
  }));

  const levelRows = await query<{ name: string; value: number }>(
    'SELECT risk_level AS name, COUNT(*) AS value FROM compliance_rule GROUP BY risk_level',
  );
  const levelDist = RISK_LEVELS.map((name) => ({
    name,
    value: intOf(levelRows.find((r) => r.name === name)?.value),
  }));

  const rectifyRows = await query<{ name: string; value: number }>(
    'SELECT status AS name, COUNT(*) AS value FROM compliance_rectify GROUP BY status',
  );
  const rectifyDist = RECTIFY_STATUSES.map((name) => ({
    name,
    value: intOf(rectifyRows.find((r) => r.name === name)?.value),
  }));

  const rectifyTotal = intOf(rectify?.total);
  const rectifyClosed = intOf(rectify?.closed);

  ok(res, {
    cards: {
      ruleTotal: intOf(ruleTotal?.c),
      ruleEnabled: intOf(ruleEnabled?.c),
      checkTotal: intOf(checkTotal?.c),
      latestBatchNo: latest?.batch_no ?? null,
      latestRate: latest?.rate ?? 0,
      rectifyTotal,
      rectifyOpen: intOf(rectify?.open),
      rectifyClosed,
      rectifyOverdue: intOf(rectify?.overdue),
      closeRate: rateOf(rectifyClosed, rectifyTotal),
      pendingApprovals: intOf(pendingApproval?.c),
      maskingTotal: intOf(masking?.total),
      maskingEnabled: intOf(masking?.enabled),
    },
    categoryDist,
    levelDist,
    rectifyDist,
    batches: batches.slice(0, 6).reverse(),
    generatedAt: fmtDateTime(new Date()),
  });
});

// ============ 规则库 ============

function ruleWhere(req: { query: Record<string, unknown> }): { sql: string; params: unknown[] } {
  const keyword = strOrUndef(req.query.keyword);
  const basis = strOrUndef(req.query.basis);
  const category = strOrUndef(req.query.category);
  const status = strOrUndef(req.query.status);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (keyword) {
    clauses.push('(r.rule_code LIKE ? OR r.rule_title LIKE ? OR r.requirement LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (basis) {
    clauses.push('r.basis = ?');
    params.push(basis);
  }
  if (category) {
    clauses.push('r.category = ?');
    params.push(category);
  }
  if (status) {
    clauses.push('r.status = ?');
    params.push(status);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

const RULE_SELECT = `SELECT r.*,
       (SELECT c.result FROM compliance_check c WHERE c.rule_id = r.id ORDER BY c.checked_at DESC, c.id DESC LIMIT 1) AS last_result,
       (SELECT c.checked_at FROM compliance_check c WHERE c.rule_id = r.id ORDER BY c.checked_at DESC, c.id DESC LIMIT 1) AS last_checked_at
  FROM compliance_rule r`;

complianceRouter.get('/rules', READ, async (req, res) => {
  const p = parsePagination(req.query);
  const w = ruleWhere(req);
  const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM compliance_rule r ${w.sql}`, w.params);
  const rows = await query<RuleRecord>(
    `${RULE_SELECT} ${w.sql} ORDER BY r.rule_code LIMIT ? OFFSET ?`,
    [...w.params, p.pageSize, p.offset],
  );
  ok(res, rows.map(formatRule), {
    ...pageMeta(intOf(totalRow?.c), p),
    filters: { bases: BASES, categories: CATEGORIES, riskLevels: RISK_LEVELS, statuses: RULE_STATUSES },
  });
});

const ruleCreateSchema = z.object({
  rule_code: z.string().trim().max(32).optional(),
  rule_title: z.string().trim().min(2, '规则标题至少 2 个字符').max(128),
  basis: enumOf(BASES),
  category: enumOf(CATEGORIES),
  requirement: z.string().trim().min(4, '合规要求至少 4 个字符').max(512),
  risk_level: enumOf(RISK_LEVELS).optional(),
  check_method: enumOf(['自动', '人工']).optional(),
  status: enumOf(RULE_STATUSES).optional(),
});

complianceRouter.post('/rules', WRITE, async (req, res) => {
  const data = ruleCreateSchema.parse(req.body);
  const ruleCode = data.rule_code && data.rule_code !== '' ? data.rule_code : await nextRuleCode();
  const dup = await queryOne<{ id: number }>('SELECT id FROM compliance_rule WHERE rule_code = ?', [ruleCode]);
  if (dup) throw new ApiError(409, `规则编号 ${ruleCode} 已存在`);

  const createdAt = fmtDateTime(new Date());
  const inserted = await execute(
    `INSERT INTO compliance_rule (rule_code, rule_title, basis, category, requirement, risk_level, check_method, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      ruleCode,
      data.rule_title,
      data.basis,
      data.category,
      data.requirement,
      data.risk_level ?? '中',
      data.check_method ?? '自动',
      data.status ?? '启用',
      createdAt,
    ],
  );
  const row = await queryOne<RuleRecord>(`${RULE_SELECT} WHERE r.id = ?`, [inserted.insertId]);
  if (!row) throw new ApiError(500, '规则创建失败');
  res.status(201);
  ok(res, formatRule(row));
});

const ruleUpdateSchema = ruleCreateSchema.partial();

complianceRouter.put('/rules/:id', WRITE, async (req, res) => {
  const id = parseId(req.params.id);
  const existing = await queryOne<RuleRecord>('SELECT * FROM compliance_rule WHERE id = ?', [id]);
  if (!existing) throw new ApiError(404, '合规规则不存在');
  const data = ruleUpdateSchema.parse(req.body);

  if (data.rule_code && data.rule_code !== existing.rule_code) {
    const dup = await queryOne<{ id: number }>('SELECT id FROM compliance_rule WHERE rule_code = ? AND id <> ?', [
      data.rule_code,
      id,
    ]);
    if (dup) throw new ApiError(409, `规则编号 ${data.rule_code} 已存在`);
  }

  const next = {
    rule_code: data.rule_code ?? existing.rule_code,
    rule_title: data.rule_title ?? existing.rule_title,
    basis: data.basis ?? existing.basis,
    category: data.category ?? existing.category,
    requirement: data.requirement ?? existing.requirement,
    risk_level: data.risk_level ?? existing.risk_level,
    check_method: data.check_method ?? existing.check_method,
    status: data.status ?? existing.status,
  };
  await execute(
    `UPDATE compliance_rule SET rule_code = ?, rule_title = ?, basis = ?, category = ?, requirement = ?,
            risk_level = ?, check_method = ?, status = ? WHERE id = ?`,
    [next.rule_code, next.rule_title, next.basis, next.category, next.requirement, next.risk_level, next.check_method, next.status, id],
  );
  const row = await queryOne<RuleRecord>(`${RULE_SELECT} WHERE r.id = ?`, [id]);
  ok(res, formatRowOrThrow(row));
});

/** narrow 辅助：查询失败时统一 500，避免调用侧到处判空 */
function formatRowOrThrow(row: RuleRecord | null) {
  if (!row) throw new ApiError(500, '数据读取失败');
  return formatRule(row);
}

// ============ 检查结果 ============

complianceRouter.get('/checks', READ, async (req, res) => {
  const p = parsePagination(req.query);
  const batchNo = strOrUndef(req.query.batchNo);
  const result = strOrUndef(req.query.result);
  const ruleId = numOrUndef(req.query.ruleId);

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (batchNo) {
    clauses.push('c.batch_no = ?');
    params.push(batchNo);
  }
  if (result) {
    clauses.push('c.result = ?');
    params.push(result);
  }
  if (ruleId !== undefined) {
    clauses.push('c.rule_id = ?');
    params.push(ruleId);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const totalRow = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM compliance_check c JOIN compliance_rule r ON r.id = c.rule_id ${whereSql}`,
    params,
  );
  const rows = await query<CheckRecord>(
    `SELECT c.id, c.rule_id, c.batch_no, c.target, c.result, c.score, c.evidence, c.duration_ms, c.checked_at,
            r.rule_code, r.rule_title, r.basis, r.category, r.risk_level
       FROM compliance_check c JOIN compliance_rule r ON r.id = c.rule_id
       ${whereSql}
      ORDER BY c.checked_at DESC, c.id DESC
      LIMIT ? OFFSET ?`,
    [...params, p.pageSize, p.offset],
  );
  ok(res, rows.map(formatCheck), { ...pageMeta(intOf(totalRow?.c), p) });
});

const CHECK_TARGETS: Record<string, string[]> = {
  分类分级: ['数据资产台账', '元数据管理平台', '数据资产目录'],
  访问控制: ['统一身份认证平台', 'API 网关', '堡垒机'],
  加密脱敏: ['数据共享交换平台', '数据资产管理平台', '报表导出服务'],
  审计留痕: ['审计日志库', '日志采集平台', '操作审计系统'],
  跨境传输: ['数据出境传输节点', 'API 网关'],
  合规管理: ['安全管理制度库', '备份系统', '合同管理系统'],
};

const FAIL_EVIDENCE: Record<string, string> = {
  分类分级: '存在 3 项资产未标注数据级别，分类分级标识不完整',
  访问控制: '2 个账号权限超出最小必要范围，未按季度复核',
  加密脱敏: '对外共享数据未执行脱敏，导出报告中含完整身份证号',
  审计留痕: '审计日志留存周期为 90 天，低于六个月要求',
  跨境传输: '重要数据出境未完成安全评估申报',
  合规管理: '制度文件缺失或未留档，整改记录不完整',
};

const WARN_EVIDENCE: Record<string, string> = {
  分类分级: '个别新增资产分级标识滞后，建议 7 个工作日内补录',
  访问控制: '部分账号权限申请缺少审批附件，流程待完善',
  加密脱敏: '脱敏策略已配置但覆盖率不足，存在少量明文样例',
  审计留痕: '日志轮转策略尚未复核，留存周期接近阈值',
  跨境传输: '数据出境台账信息不完整，缺少接收方安全评估材料',
  合规管理: '培训与演练记录未按年度归档，建议补充留痕',
};

const PASS_EVIDENCE = [
  '检查项符合合规要求，未发现违规情况',
  '抽样核查未发现异常，控制措施有效运行',
  '策略配置完整，检查范围内全部符合要求',
];

function pickOne<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

complianceRouter.post('/checks/run', WRITE, async (req, res) => {
  const startedAt = Date.now();
  const user = currentUser(req);
  const rules = await query<{ id: number; rule_code: string; rule_title: string; category: string; risk_level: string }>(
    "SELECT id, rule_code, rule_title, category, risk_level FROM compliance_rule WHERE status = '启用' ORDER BY id",
  );
  if (!rules.length) throw new ApiError(400, '当前没有启用的合规规则，无法执行检查');

  // 规则最近的检查结论：上轮不通过/警告的规则本轮更可能再次命中问题（按当前状态抽样）
  const lastRows = await query<{ rule_id: number; result: string }>(
    `SELECT c.rule_id, c.result
       FROM compliance_check c
       JOIN (SELECT rule_id, MAX(id) AS max_id FROM compliance_check GROUP BY rule_id) t ON t.max_id = c.id`,
  );
  const lastMap = new Map<number, string>(lastRows.map((r) => [intOf(r.rule_id), r.result]));
  const weightOf: Record<string, number> = { 紧急: 0.22, 高: 0.14, 中: 0.06, 低: 0 };
  const scored = rules.map((rule) => {
    const prev = lastMap.get(intOf(rule.id));
    const bump = prev === '不通过' ? 0.35 : prev === '警告' ? 0.18 : 0;
    return { rule, score: Math.random() + bump + (weightOf[rule.risk_level] ?? 0) };
  });
  scored.sort((a, b) => b.score - a.score);

  const failCount = Math.max(1, Math.round(rules.length * 0.15));
  const warnCount = Math.max(1, Math.round(rules.length * 0.15));
  const failSet = new Set(scored.slice(0, failCount).map((s) => intOf(s.rule.id)));
  const warnSet = new Set(scored.slice(failCount, failCount + warnCount).map((s) => intOf(s.rule.id)));

  const batchNo = await nextBatchNo();
  const checkedAt = fmtDateTime(new Date());
  const entries = rules.map((rule) => {
    const id = intOf(rule.id);
    const result = failSet.has(id) ? '不通过' : warnSet.has(id) ? '警告' : '通过';
    const category = rule.category;
    const evidence =
      result === '不通过'
        ? FAIL_EVIDENCE[category] ?? '检查发现不符合项，需限期整改'
        : result === '警告'
          ? WARN_EVIDENCE[category] ?? '存在轻微不符合项，建议限期完善'
          : pickOne(PASS_EVIDENCE);
    const score = result === '通过' ? 100 : result === '警告' ? randomInt(70, 89) : randomInt(40, 69);
    const target = pickOne(CHECK_TARGETS[category] ?? ['数据资产台账']);
    return { rule, result, target, score, evidence, durationMs: randomInt(120, 2400) };
  });

  const insertParams: unknown[] = [];
  const placeholders = entries.map(() => '(?,?,?,?,?,?,?,?)');
  for (const entry of entries) {
    insertParams.push(intOf(entry.rule.id), batchNo, entry.target, entry.result, entry.score, entry.evidence, entry.durationMs, checkedAt);
  }
  const inserted = await execute(
    `INSERT INTO compliance_check (rule_id, batch_no, target, result, score, evidence, duration_ms, checked_at)
     VALUES ${placeholders.join(',')}`,
    insertParams,
  );

  const passed = entries.filter((e) => e.result === '通过').length;
  const warning = entries.filter((e) => e.result === '警告').length;
  const failed = entries.filter((e) => e.result === '不通过').length;

  // 不通过项自动生成整改单，形成「检查 → 整改」闭环链路
  let rectifyCreated = 0;
  const deptId = user.deptId ?? 2;
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].result !== '不通过') continue;
    await execute(
      `INSERT INTO compliance_rectify (rectify_no, check_id, title, owner, dept_id, due_date, status, progress, measure, closed_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        await nextRectifyNo(),
        inserted.insertId + i,
        `${entries[i].rule.rule_title}整改`,
        user.realName,
        deptId,
        shiftDays(15),
        '待整改',
        0,
        `针对「${entries[i].rule.rule_title}」组织整改：补齐控制措施、完善配置并复核留痕`,
        null,
        checkedAt,
      ],
    );
    rectifyCreated += 1;
  }

  await invalidate('dashboard:overview:*');

  ok(res, {
    batchNo,
    total: entries.length,
    passed,
    warning,
    failed,
    rate: rateOf(passed, entries.length),
    rectifyCreated,
    durationMs: Date.now() - startedAt,
    checkedAt,
  });
});

complianceRouter.get('/checks/:id', READ, async (req, res) => {
  const id = parseId(req.params.id);
  const row = await queryOne<CheckRecord & { requirement: string; check_method: string; rule_status: string }>(
    `SELECT c.id, c.rule_id, c.batch_no, c.target, c.result, c.score, c.evidence, c.duration_ms, c.checked_at,
            r.rule_code, r.rule_title, r.basis, r.category, r.risk_level, r.requirement, r.check_method,
            r.status AS rule_status
       FROM compliance_check c JOIN compliance_rule r ON r.id = c.rule_id
      WHERE c.id = ?`,
    [id],
  );
  if (!row) throw new ApiError(404, '检查结果不存在');

  const batch = await loadBatchStat(row.batch_no);
  const siblings = await query<{ id: number; rule_code: string; rule_title: string; result: string; score: number }>(
    `SELECT c.id, r.rule_code, r.rule_title, c.result, c.score
       FROM compliance_check c JOIN compliance_rule r ON r.id = c.rule_id
      WHERE c.batch_no = ? ORDER BY c.id`,
    [row.batch_no],
  );

  const formatted = formatCheck(row);
  ok(res, {
    check: formatted,
    rule: {
      id: row.rule_id,
      rule_code: row.rule_code,
      rule_title: row.rule_title,
      basis: row.basis,
      category: row.category,
      requirement: row.requirement,
      risk_level: row.risk_level,
      check_method: row.check_method,
      status: row.rule_status,
    },
    batch,
    sameBatch: siblings.map((s) => ({
      id: intOf(s.id),
      rule_code: s.rule_code,
      rule_title: s.rule_title,
      result: s.result,
      score: intOf(s.score),
    })),
  });
});

complianceRouter.get('/batches', READ, async (_req, res) => {
  ok(res, await loadBatches());
});

// ============ 整改跟踪 ============

const RECTIFY_SELECT = `SELECT rc.id, rc.rectify_no, rc.check_id, rc.title, rc.owner, rc.dept_id, rc.due_date,
       rc.status, rc.progress, rc.measure, rc.closed_at, rc.created_at,
       d.dept_name, c.batch_no, r.rule_code, r.rule_title, r.risk_level, r.category
  FROM compliance_rectify rc
  JOIN sys_dept d ON d.id = rc.dept_id
  JOIN compliance_check c ON c.id = rc.check_id
  JOIN compliance_rule r ON r.id = c.rule_id`;

complianceRouter.get('/rectify', READ, async (req, res) => {
  const user = currentUser(req);
  const p = parsePagination(req.query);
  const status = strOrUndef(req.query.status);
  const keyword = strOrUndef(req.query.keyword);
  await markOverdue();

  const scope = dataScopeFilter(user, 'rc', 'dept_id', 'owner');
  const clauses: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (scope.sql) {
    clauses.push(scope.sql.replace(/^AND\s+/, ''));
    params.push(...scope.params);
  }
  if (status) {
    clauses.push('rc.status = ?');
    params.push(status);
  }
  if (keyword) {
    clauses.push('(rc.rectify_no LIKE ? OR rc.title LIKE ? OR rc.owner LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = `WHERE ${clauses.join(' AND ')}`;

  const totalRow = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM compliance_rectify rc JOIN compliance_check c ON c.id = rc.check_id ${whereSql}`,
    params,
  );
  const rows = await query<RectifyRecord>(
    `${RECTIFY_SELECT} ${whereSql}
      ORDER BY FIELD(rc.status, '已逾期', '待整改', '整改中', '已闭环'), rc.due_date ASC, rc.id DESC
      LIMIT ? OFFSET ?`,
    [...params, p.pageSize, p.offset],
  );

  const statClauses = ['1 = 1'];
  const statParams: unknown[] = [];
  if (scope.sql) {
    statClauses.push(scope.sql.replace(/^AND\s+/, ''));
    statParams.push(...scope.params);
  }
  const statRows = await query<{ status: string; value: number }>(
    `SELECT rc.status AS status, COUNT(*) AS value FROM compliance_rectify rc WHERE ${statClauses.join(' AND ')} GROUP BY rc.status`,
    statParams,
  );
  const stats = RECTIFY_STATUSES.map((name) => ({
    name,
    value: intOf(statRows.find((s) => s.status === name)?.value),
  }));

  ok(res, rows.map(formatRectify), { ...pageMeta(intOf(totalRow?.c), p), stats });
});

const rectifyUpdateSchema = z.object({
  status: enumOf(RECTIFY_STATUSES).optional(),
  progress: z.coerce.number().int().min(0, '进度不能小于 0').max(100, '进度不能大于 100').optional(),
  measure: z.string().trim().max(512).optional(),
});

complianceRouter.put('/rectify/:id', WRITE, async (req, res) => {
  const id = parseId(req.params.id);
  const existing = await queryOne<RectifyRecord>('SELECT * FROM compliance_rectify WHERE id = ?', [id]);
  if (!existing) throw new ApiError(404, '整改单不存在');
  const data = rectifyUpdateSchema.parse(req.body);

  let status = data.status ?? existing.status;
  let progress = data.progress ?? intOf(existing.progress);
  let closedAt = existing.closed_at;

  if (status === '已闭环' || data.progress === 100) {
    status = '已闭环';
    progress = 100;
    closedAt = closedAt ?? fmtDateTime(new Date());
  } else {
    if (progress >= 100) progress = 99;
    closedAt = null;
    // 已逾期单据在更新时保留逾期状态，避免被误改回“整改中”而丢失逾期标记
    if (existing.status === '已逾期' && data.status === undefined) status = '已逾期';
  }

  await execute('UPDATE compliance_rectify SET status = ?, progress = ?, measure = ?, closed_at = ? WHERE id = ?', [
    status,
    progress,
    data.measure ?? existing.measure,
    closedAt,
    id,
  ]);
  await invalidate('dashboard:overview:*');

  const row = await queryOne<RectifyRecord>(`${RECTIFY_SELECT} WHERE rc.id = ?`, [id]);
  if (!row) throw new ApiError(500, '整改单更新后读取失败');
  ok(res, formatRectify(row));
});

// ============ 脱敏管理 ============

complianceRouter.get('/masking', READ, async (req, res) => {
  const algorithm = strOrUndef(req.query.algorithm);
  const maskType = strOrUndef(req.query.mask_type);
  const keyword = strOrUndef(req.query.keyword);

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (algorithm) {
    clauses.push('algorithm = ?');
    params.push(algorithm);
  }
  if (maskType) {
    clauses.push('mask_type = ?');
    params.push(maskType);
  }
  if (keyword) {
    clauses.push('(rule_name LIKE ? OR field_pattern LIKE ? OR scene LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query<MaskingRecord>(`SELECT * FROM masking_rule ${whereSql} ORDER BY id`, params);
  ok(res, rows.map(formatMasking), { total: rows.length });
});

complianceRouter.post('/masking/:id/test', WRITE, async (req, res) => {
  const id = parseId(req.params.id);
  const rule = await queryOne<MaskingRecord>('SELECT * FROM masking_rule WHERE id = ?', [id]);
  if (!rule) throw new ApiError(404, '脱敏规则不存在');
  const data = z.object({ sample: z.string().trim().min(1, '请输入待脱敏样例').max(256) }).parse(req.body);
  const after = applyMasking(rule.algorithm, data.sample);
  ok(res, {
    before: data.sample,
    after,
    algorithm: rule.algorithm,
    maskType: rule.mask_type,
    ruleId: intOf(rule.id),
    ruleName: rule.rule_name,
  });
});

const maskingUpdateSchema = z.object({
  status: enumOf(RULE_STATUSES).optional(),
  algorithm: enumOf(MASKING_ALGORITHMS).optional(),
  mask_type: enumOf(MASKING_TYPES).optional(),
  scene: z.string().trim().max(64).optional(),
  field_pattern: z.string().trim().max(128).optional(),
});

complianceRouter.put('/masking/:id', WRITE, async (req, res) => {
  const id = parseId(req.params.id);
  const existing = await queryOne<MaskingRecord>('SELECT * FROM masking_rule WHERE id = ?', [id]);
  if (!existing) throw new ApiError(404, '脱敏规则不存在');
  const data = maskingUpdateSchema.parse(req.body);
  await execute(
    'UPDATE masking_rule SET status = ?, algorithm = ?, mask_type = ?, scene = ?, field_pattern = ? WHERE id = ?',
    [
      data.status ?? existing.status,
      data.algorithm ?? existing.algorithm,
      data.mask_type ?? existing.mask_type,
      data.scene ?? existing.scene,
      data.field_pattern ?? existing.field_pattern,
      id,
    ],
  );
  const row = await queryOne<MaskingRecord>('SELECT * FROM masking_rule WHERE id = ?', [id]);
  if (!row) throw new ApiError(500, '脱敏规则更新后读取失败');
  ok(res, formatMasking(row));
});

// ============ 共享审批 ============

const APPROVAL_SELECT = `SELECT s.*, a.asset_name, a.asset_code, a.data_level AS asset_level, d.dept_name AS applicant_dept
  FROM share_approval s
  LEFT JOIN data_asset a ON a.id = s.asset_id
  LEFT JOIN sys_user u ON u.id = s.applicant_id
  LEFT JOIN sys_dept d ON d.id = u.dept_id`;

/** 共享申请可选的资产列表（供提交申请下拉使用，按敏感级别排序） */
complianceRouter.get('/approvals/assets', READ, async (_req, res) => {
  const rows = await query<{ id: number; asset_name: string; asset_code: string; data_level: string }>(
    `SELECT id, asset_name, asset_code, data_level FROM data_asset
      ORDER BY FIELD(data_level, '绝密', '机密', '内部', '公开'), id
      LIMIT 200`,
  );
  ok(res, rows.map((r) => ({
    id: intOf(r.id),
    asset_name: r.asset_name,
    asset_code: r.asset_code,
    data_level: r.data_level,
  })));
});

complianceRouter.get('/approvals', READ, async (req, res) => {
  const p = parsePagination(req.query);
  const status = strOrUndef(req.query.status);
  const riskLevel = strOrUndef(req.query.riskLevel);
  const keyword = strOrUndef(req.query.keyword);

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (status) {
    clauses.push('s.status = ?');
    params.push(status);
  }
  if (riskLevel) {
    clauses.push('s.risk_level = ?');
    params.push(riskLevel);
  }
  if (keyword) {
    clauses.push('(s.approval_no LIKE ? OR s.applicant_name LIKE ? OR s.receiver LIKE ? OR s.purpose LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM share_approval s ${whereSql}`, params);
  const rows = await query<ApprovalRecord>(
    `${APPROVAL_SELECT} ${whereSql}
      ORDER BY FIELD(s.status, '待审批', '已通过', '已驳回', '已撤回'), s.created_at DESC, s.id DESC
      LIMIT ? OFFSET ?`,
    [...params, p.pageSize, p.offset],
  );

  const statRows = await query<{ status: string; value: number }>(
    'SELECT status, COUNT(*) AS value FROM share_approval GROUP BY status',
  );
  const stats = APPROVAL_STATUSES.map((name) => ({
    name,
    value: intOf(statRows.find((s) => s.status === name)?.value),
  }));
  const riskRows = await query<{ risk_level: string; value: number }>(
    "SELECT risk_level, COUNT(*) AS value FROM share_approval WHERE status = '待审批' GROUP BY risk_level",
  );
  const pendingByRisk = RISK_LEVELS.map((name) => ({
    name,
    value: intOf(riskRows.find((r) => r.risk_level === name)?.value),
  }));

  ok(res, rows.map(formatApproval), { ...pageMeta(intOf(totalRow?.c), p), stats, pendingByRisk });
});

const approvalCreateSchema = z.object({
  asset_id: z.coerce.number().int().positive('请选择共享的数据资产'),
  receiver: z.string().trim().min(2, '请填写数据接收方').max(64),
  purpose: z.string().trim().min(4, '请填写共享用途（至少 4 个字符）').max(255),
  share_way: enumOf(SHARE_WAYS),
  risk_level: enumOf(RISK_LEVELS).optional(),
});

const ASSET_LEVEL_RISK: Record<string, string> = { 公开: '低', 内部: '中', 机密: '高', 绝密: '紧急' };

complianceRouter.post('/approvals', WRITE, async (req, res) => {
  const user = currentUser(req);
  const data = approvalCreateSchema.parse(req.body);
  const asset = await queryOne<{ id: number; asset_name: string; data_level: string }>(
    'SELECT id, asset_name, data_level FROM data_asset WHERE id = ?',
    [data.asset_id],
  );
  if (!asset) throw new ApiError(404, '共享的数据资产不存在');

  const riskLevel = data.risk_level ?? ASSET_LEVEL_RISK[asset.data_level] ?? '中';
  const approvalNo = await nextApprovalNo();
  const createdAt = fmtDateTime(new Date());
  const inserted = await execute(
    `INSERT INTO share_approval (approval_no, asset_id, applicant_id, applicant_name, receiver, purpose, share_way,
            risk_level, status, approver, approved_at, comment, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      approvalNo,
      data.asset_id,
      user.id,
      user.realName,
      data.receiver,
      data.purpose,
      data.share_way,
      riskLevel,
      '待审批',
      null,
      null,
      null,
      createdAt,
    ],
  );

  const approvers = await loadComplianceWriters(user.id);
  const notified = await notifyUsers(
    approvers,
    `数据共享审批待处理（${approvalNo}）`,
    `${user.realName} 提交「${asset.asset_name}」向 ${data.receiver} 的共享申请（用途：${data.purpose}），风险级别 ${riskLevel}，请及时审批。`,
    riskLevel === '高' || riskLevel === '紧急' ? '警告' : '信息',
    inserted.insertId,
  );
  await invalidate('dashboard:overview:*');

  const row = await queryOne<ApprovalRecord>(`${APPROVAL_SELECT} WHERE s.id = ?`, [inserted.insertId]);
  if (!row) throw new ApiError(500, '共享申请创建失败');
  res.status(201);
  ok(res, { approval: formatApproval(row), notified });
});

const approvalDecisionSchema = z.object({
  approved: z.boolean(),
  comment: z.string().trim().max(255).optional(),
});

complianceRouter.put('/approvals/:id/approve', WRITE, async (req, res) => {
  const id = parseId(req.params.id);
  const user = currentUser(req);
  const existing = await queryOne<ApprovalRecord>('SELECT * FROM share_approval WHERE id = ?', [id]);
  if (!existing) throw new ApiError(404, '共享审批单不存在');
  if (existing.status !== '待审批') throw new ApiError(409, `审批单当前状态为「${existing.status}」，无法重复审批`);
  const data = approvalDecisionSchema.parse(req.body);

  const status = data.approved ? '已通过' : '已驳回';
  const comment = data.comment && data.comment !== ''
    ? data.comment
    : data.approved
      ? '材料齐全，用途合规，同意共享并落实数据脱敏与最小必要原则'
      : '申请材料或用途说明不充分，予以驳回，请补充后重新提交';
  await execute(
    'UPDATE share_approval SET status = ?, approver = ?, approved_at = ?, comment = ? WHERE id = ?',
    [status, user.realName, fmtDateTime(new Date()), comment, id],
  );

  await notifyUsers(
    [intOf(existing.applicant_id)],
    `数据共享申请${status}（${existing.approval_no}）`,
    `您提交的「${existing.receiver}」共享申请（用途：${existing.purpose}）已被 ${user.realName} ${status}。审批意见：${comment}`,
    data.approved ? '信息' : '警告',
    id,
  );
  await invalidate('dashboard:overview:*');

  const row = await queryOne<ApprovalRecord>(`${APPROVAL_SELECT} WHERE s.id = ?`, [id]);
  if (!row) throw new ApiError(500, '审批单更新后读取失败');
  ok(res, formatApproval(row));
});

// ============ 合规报告 ============

complianceRouter.get('/report', READ, async (req, res) => {
  const requested = strOrUndef(req.query.batchNo);
  const batches = await loadBatches();
  const batchNo = requested ?? batches[0]?.batch_no ?? null;
  if (!batchNo) throw new ApiError(404, '暂无合规检查批次，无法生成报告');
  const current = batches.find((b) => b.batch_no === batchNo) ?? (await loadBatchStat(batchNo));
  if (!current) throw new ApiError(404, `检查批次 ${batchNo} 不存在`);

  const groupSql = `SELECT r.__DIM__ AS name, COUNT(*) AS total,
            SUM(c.result = '通过') AS passed, SUM(c.result = '警告') AS warning, SUM(c.result = '不通过') AS failed
       FROM compliance_check c JOIN compliance_rule r ON r.id = c.rule_id
      WHERE c.batch_no = ? GROUP BY r.__DIM__`;

  type GroupRow = { name: string; total: number; passed: number; warning: number; failed: number };
  const summarize = (rows: GroupRow[]) => rows.map((r) => ({
    name: r.name,
    total: intOf(r.total),
    passed: intOf(r.passed),
    warning: intOf(r.warning),
    failed: intOf(r.failed),
    rate: rateOf(intOf(r.passed), intOf(r.total)),
  }));

  const categoryRows = await query<GroupRow>(groupSql.replaceAll('__DIM__', 'category'), [batchNo]);
  const basisRows = await query<GroupRow>(groupSql.replaceAll('__DIM__', 'basis'), [batchNo]);

  const byCategory = summarize(
    [...categoryRows].sort((a, b) => CATEGORIES.indexOf(a.name as (typeof CATEGORIES)[number]) - CATEGORIES.indexOf(b.name as (typeof CATEGORIES)[number])),
  );
  const byBasis = summarize(
    [...basisRows].sort((a, b) => BASES.indexOf(a.name as (typeof BASES)[number]) - BASES.indexOf(b.name as (typeof BASES)[number])),
  );

  const fails = await query<CheckRecord>(
    `SELECT c.id, c.rule_id, c.batch_no, c.target, c.result, c.score, c.evidence, c.duration_ms, c.checked_at,
            r.rule_code, r.rule_title, r.basis, r.category, r.risk_level
       FROM compliance_check c JOIN compliance_rule r ON r.id = c.rule_id
      WHERE c.batch_no = ? AND c.result = '不通过'
      ORDER BY FIELD(r.risk_level, '紧急', '高', '中', '低'), c.id`,
    [batchNo],
  );

  // 整改清单 = 本批次关联的整改单 + 当前仍未闭环的整改单（去重），便于报告页完整呈现闭环情况
  const rectifyRows = await query<RectifyRecord>(
    `${RECTIFY_SELECT}
      WHERE c.batch_no = ? OR rc.status <> '已闭环'
      ORDER BY FIELD(rc.status, '已逾期', '待整改', '整改中', '已闭环'), rc.due_date ASC
      LIMIT 12`,
    [batchNo],
  );

  const ruleTotal = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM compliance_rule');
  const ruleEnabled = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM compliance_rule WHERE status = '启用'");
  const rectify = await queryOne<{ total: number; closed: number; overdue: number; open: number }>(
    `SELECT COUNT(*) AS total, SUM(status = '已闭环') AS closed, SUM(status = '已逾期') AS overdue, SUM(status <> '已闭环') AS open
       FROM compliance_rectify`,
  );
  const pendingApproval = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM share_approval WHERE status = '待审批'");
  const masking = await queryOne<{ total: number; enabled: number }>(
    "SELECT COUNT(*) AS total, SUM(status = '启用') AS enabled FROM masking_rule",
  );

  const rectifyTotal = intOf(rectify?.total);
  const rectifyClosed = intOf(rectify?.closed);

  ok(res, {
    batchNo,
    generatedAt: fmtDateTime(new Date()),
    summary: {
      ...current,
      cards: {
        ruleTotal: intOf(ruleTotal?.c),
        ruleEnabled: intOf(ruleEnabled?.c),
        checkBatches: batches.length,
        rectifyTotal,
        rectifyOpen: intOf(rectify?.open),
        rectifyClosed,
        rectifyOverdue: intOf(rectify?.overdue),
        closeRate: rateOf(rectifyClosed, rectifyTotal),
        pendingApprovals: intOf(pendingApproval?.c),
        maskingTotal: intOf(masking?.total),
        maskingEnabled: intOf(masking?.enabled),
      },
    },
    byCategory,
    byBasis,
    fails: fails.map(formatCheck),
    rectify: rectifyRows.map(formatRectify),
  });
});

// 未匹配到的 /compliance/* 统一 404（避免落到全局 404 时缺少上下文）
complianceRouter.use((_req, _res, next) => {
  next(new ApiError(404, '合规管理接口不存在'));
});

// 说明：本模块所有写操作由 app.ts 中的 auditWriter 自动写入 audit_log。
// 检查结果导出等扩展能力后续按契约增补，不在本次范围。
