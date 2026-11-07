import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne } from '../../db/pool.ts';
import { ApiError, ok } from '../../lib/http.ts';
import { parsePagination, strOrUndef } from '../../lib/query.ts';
import { fmtDate, fmtDateTime, now } from '../../lib/time.ts';
import { authenticate, currentUser, dataScopeFilter, requirePerm } from '../../middleware/auth.ts';
import type { AuthUser } from '../../types.ts';

/**
 * 智能风险监测模块（/api/risk）
 * 概览 / 监测规则 / 风险事件（列表、详情、处置、忽略）/ 溯源链路 / 趋势 / 实时监控
 */
export const riskRouter = Router();

riskRouter.use(authenticate);

const LEVELS: string[] = ['低', '中', '高', '紧急'];
const STATUSES: string[] = ['待处置', '处置中', '已处置', '已忽略'];
const EVENT_TYPES: string[] = ['越权访问', '批量导出', '异常登录', '数据篡改', '敏感外传'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/;

type DateTimeLike = Date | string | null | undefined;
const dt = (v: DateTimeLike): string | null => (v ? fmtDateTime(new Date(v)) : null);

/* ============================ 行类型与映射 ============================ */

interface RiskEventRow {
  id: number;
  event_no: string;
  rule_id: number | null;
  event_type: string;
  level: string;
  asset_id: number | null;
  username: string;
  dept_id: number | null;
  ip: string | null;
  device: string | null;
  location: string | null;
  detail: string;
  status: string;
  occurred_at: Date | string;
  handled_by: string | null;
  handled_at: Date | string | null;
  handle_note: string | null;
  created_at: Date | string;
  asset_name?: string | null;
  asset_code?: string | null;
  asset_level?: string | null;
  rule_name?: string | null;
  rule_code?: string | null;
  dept_name?: string | null;
}

function mapEvent(row: RiskEventRow): Record<string, unknown> {
  return {
    ...row,
    occurred_at: dt(row.occurred_at),
    handled_at: dt(row.handled_at),
    created_at: dt(row.created_at),
  };
}

interface RiskRuleRow {
  id: number;
  rule_code: string;
  rule_name: string;
  event_type: string;
  expression: string;
  level: string;
  enabled: number | boolean;
  hit_count: number | string;
  updated_at: Date | string;
}

function mapRule(row: RiskRuleRow): Record<string, unknown> {
  return {
    ...row,
    enabled: Number(row.enabled) === 1,
    hit_count: Number(row.hit_count),
    updated_at: dt(row.updated_at),
  };
}

interface AssetRow {
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
  last_access_at: Date | string | null;
  category_name?: string | null;
  dept_name?: string | null;
}

function mapAsset(row: AssetRow): Record<string, unknown> {
  return {
    ...row,
    size_gb: Number(row.size_gb ?? 0),
    row_count: Number(row.row_count ?? 0),
    sensitivity_score: Number(row.sensitivity_score ?? 0),
    quality_score: Number(row.quality_score ?? 0),
    last_access_at: dt(row.last_access_at),
  };
}

/* ============================ 公共 SQL 片段 ============================ */

const EVENT_SELECT = `e.id, e.event_no, e.rule_id, e.event_type, e.level, e.asset_id, e.username,
       e.dept_id, e.ip, e.device, e.location, e.detail, e.status, e.occurred_at,
       e.handled_by, e.handled_at, e.handle_note, e.created_at,
       a.asset_name, a.asset_code, a.data_level AS asset_level,
       r.rule_name, r.rule_code, d.dept_name`;

const EVENT_FROM = `FROM risk_event e
       LEFT JOIN data_asset a ON a.id = e.asset_id
       LEFT JOIN risk_rule r ON r.id = e.rule_id
       LEFT JOIN sys_dept d ON d.id = e.dept_id`;

const ASSET_SELECT = `a.id, a.asset_code, a.asset_name, a.category_id, a.dept_id, a.source_system,
       a.data_type, a.data_level, a.file_format, a.size_gb, a.row_count, a.owner, a.status,
       a.lifecycle_stage, a.sensitivity_score, a.quality_score, a.description, a.last_access_at,
       c.category_name, d.dept_name
  FROM data_asset a
  LEFT JOIN asset_category c ON c.id = a.category_id
  LEFT JOIN sys_dept d ON d.id = a.dept_id`;

/* ============================ 工具函数 ============================ */

function parseId(raw: unknown, label = 'ID'): number {
  const text = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
  const n = Number(text);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${label}不合法`);
  return n;
}

function pickEnum(value: unknown, allowed: string[], label: string): string | undefined {
  const v = strOrUndef(value);
  if (v === undefined) return undefined;
  if (!allowed.includes(v)) throw new ApiError(400, `${label}取值不合法，应为：${allowed.join('/')}`);
  return v;
}

/** 日期筛选：YYYY-MM-DD 自动补全为当天 00:00:00 / 23:59:59 */
function dateBound(value: unknown, isEnd: boolean): string | undefined {
  const s = strOrUndef(value);
  if (!s) return undefined;
  if (!DATE_RE.test(s)) throw new ApiError(400, '时间筛选取值格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss');
  return s.length === 10 ? `${s} ${isEnd ? '23:59:59' : '00:00:00'}` : s;
}

function boolQuery(value: unknown): number | undefined {
  const s = strOrUndef(value);
  if (s === undefined) return undefined;
  const v = s.toLowerCase();
  if (['1', 'true', 'yes', '启用'].includes(v)) return 1;
  if (['0', 'false', 'no', '停用'].includes(v)) return 0;
  throw new ApiError(400, 'enabled 取值不合法，应为 1/0 或 true/false');
}

/** 事件维度数据范围：ALL 全量 / DEPT 本部门 / SELF 仅本人 */
function scopeOf(user: AuthUser): { sql: string; params: unknown[] } {
  return dataScopeFilter(user, 'e', 'dept_id', 'username');
}

/** 组装带数据范围的 WHERE：conds 至少包含 "1 = 1" */
function buildWhere(user: AuthUser, conds: string[], params: unknown[]): { where: string; params: unknown[] } {
  const clauses = [...conds];
  const values = [...params];
  const scope = scopeOf(user);
  if (scope.sql) {
    clauses.push(scope.sql.replace(/^AND\s+/, ''));
    values.push(...scope.params);
  }
  return { where: clauses.join(' AND '), params: values };
}

async function loadEventById(user: AuthUser, id: number): Promise<RiskEventRow | null> {
  const scope = scopeOf(user);
  return queryOne<RiskEventRow>(
    `SELECT ${EVENT_SELECT} ${EVENT_FROM} WHERE e.id = ? ${scope.sql}`,
    [id, ...scope.params],
  );
}

async function loadAsset(assetId: number | null): Promise<Record<string, unknown> | null> {
  if (!assetId) return null;
  const row = await queryOne<AssetRow>(`SELECT ${ASSET_SELECT} WHERE a.id = ?`, [assetId]);
  return row ? mapAsset(row) : null;
}

/** 处置 / 忽略后写站内通知：优先通知事件操作人，账号不存在则作为全员公告 */
async function notifyRiskEvent(params: {
  eventId: number;
  eventNo: string;
  eventUser: string;
  level: string;
  title: string;
  content: string;
}): Promise<void> {
  const target = await queryOne<{ id: number }>('SELECT id FROM sys_user WHERE username = ?', [params.eventUser]);
  const level = params.level === '紧急' ? '紧急' : params.level === '高' ? '警告' : '信息';
  await execute(
    `INSERT INTO notification (user_id, title, content, level, biz_type, biz_id, created_at)
     VALUES (?, ?, ?, ?, 'risk', ?, ?)`,
    [target?.id ?? null, params.title.slice(0, 128), params.content.slice(0, 512), level, params.eventId, now()],
  );
}

/* ============================ 概览 ============================ */

riskRouter.get('/overview', requirePerm('risk'), async (req, res) => {
  const user = currentUser(req);
  const scope = scopeOf(user);
  const scopeSql = scope.sql;
  const scopeParams = scope.params;

  const [pending, handling, urgent, todayRow, totalRow, handledRow, levelRows, typeRows, hourlyRows, ruleTopRows] = await Promise.all([
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM risk_event e WHERE e.status = '待处置' ${scopeSql}`, scopeParams),
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM risk_event e WHERE e.status = '处置中' ${scopeSql}`, scopeParams),
    queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM risk_event e WHERE e.level = '紧急' AND e.status IN ('待处置','处置中') ${scopeSql}`,
      scopeParams,
    ),
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM risk_event e WHERE DATE(e.occurred_at) = CURDATE() ${scopeSql}`, scopeParams),
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM risk_event e WHERE 1 = 1 ${scopeSql}`, scopeParams),
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM risk_event e WHERE e.status = '已处置' ${scopeSql}`, scopeParams),
    query<{ level: string; c: number }>(
      `SELECT e.level, COUNT(*) AS c FROM risk_event e WHERE 1 = 1 ${scopeSql} GROUP BY e.level`,
      scopeParams,
    ),
    query<{ name: string; value: number }>(
      `SELECT e.event_type AS name, COUNT(*) AS value FROM risk_event e
        WHERE 1 = 1 ${scopeSql} GROUP BY e.event_type ORDER BY value DESC`,
      scopeParams,
    ),
    query<{ h: string; low: number; mid: number; high: number; urgent: number; total: number }>(
      `SELECT DATE_FORMAT(e.occurred_at, '%Y-%m-%d %H') AS h,
              SUM(e.level = '低') AS low, SUM(e.level = '中') AS mid,
              SUM(e.level = '高') AS high, SUM(e.level = '紧急') AS urgent,
              COUNT(*) AS total
         FROM risk_event e
        WHERE e.occurred_at >= DATE_SUB(NOW(), INTERVAL 23 HOUR) ${scopeSql}
        GROUP BY h ORDER BY h`,
      scopeParams,
    ),
    query<{ id: number; rule_code: string; rule_name: string; event_type: string; level: string; enabled: number; hit_count: number; hits: number }>(
      `SELECT r.id, r.rule_code, r.rule_name, r.event_type, r.level, r.enabled, r.hit_count, COUNT(e.id) AS hits
         FROM risk_rule r
         LEFT JOIN risk_event e ON e.rule_id = r.id ${scopeSql ? `AND ${scopeSql.replace(/^AND\s+/, '')}` : ''}
        GROUP BY r.id, r.rule_code, r.rule_name, r.event_type, r.level, r.enabled, r.hit_count
        ORDER BY hits DESC, r.hit_count DESC
        LIMIT 5`,
      scopeParams,
    ),
  ]);

  const hourlyMap = new Map(hourlyRows.map((r) => [String(r.h), r]));
  const base = new Date();
  base.setMinutes(0, 0, 0);
  const hourlyTrend: Array<Record<string, unknown>> = [];
  for (let i = 23; i >= 0; i -= 1) {
    const d = new Date(base.getTime() - i * 60 * 60 * 1000);
    const key = fmtDateTime(d).slice(0, 13);
    const hit = hourlyMap.get(key);
    hourlyTrend.push({
      time: fmtDateTime(d).slice(5, 16),
      total: Number(hit?.total ?? 0),
      low: Number(hit?.low ?? 0),
      mid: Number(hit?.mid ?? 0),
      high: Number(hit?.high ?? 0),
      urgent: Number(hit?.urgent ?? 0),
    });
  }

  const totalEvents = Number(totalRow?.c ?? 0);
  const handledEvents = Number(handledRow?.c ?? 0);
  ok(res, {
    cards: {
      pending: Number(pending?.c ?? 0),
      handling: Number(handling?.c ?? 0),
      urgent: Number(urgent?.c ?? 0),
      todayEvents: Number(todayRow?.c ?? 0),
      totalEvents,
      handledEvents,
      handledRate: totalEvents > 0 ? Math.round((handledEvents / totalEvents) * 1000) / 10 : 0,
    },
    levelDist: LEVELS.map((level) => ({
      name: level,
      value: Number(levelRows.find((r) => r.level === level)?.c ?? 0),
    })),
    ruleTop5: ruleTopRows.map((r) => ({
      id: r.id,
      rule_code: r.rule_code,
      rule_name: r.rule_name,
      event_type: r.event_type,
      level: r.level,
      enabled: Number(r.enabled) === 1,
      hit_count: Number(r.hit_count),
      hits: Number(r.hits),
    })),
    hourlyTrend,
    typeDist: typeRows.map((r) => ({ name: r.name, value: Number(r.value) })),
    generatedAt: now(),
  });
});

/* ============================ 监测规则 ============================ */

riskRouter.get('/rules', requirePerm('risk'), async (req, res) => {
  const conds: string[] = ['1 = 1'];
  const params: unknown[] = [];
  const keyword = strOrUndef(req.query.keyword);
  if (keyword) {
    const like = `%${keyword}%`;
    conds.push('(r.rule_code LIKE ? OR r.rule_name LIKE ? OR r.event_type LIKE ? OR r.expression LIKE ?)');
    params.push(like, like, like, like);
  }
  const eventType = pickEnum(req.query.eventType, EVENT_TYPES, '事件类型');
  if (eventType) {
    conds.push('r.event_type = ?');
    params.push(eventType);
  }
  const enabled = boolQuery(req.query.enabled);
  if (enabled !== undefined) {
    conds.push('r.enabled = ?');
    params.push(enabled);
  }

  const rows = await query<RiskRuleRow>(
    `SELECT r.id, r.rule_code, r.rule_name, r.event_type, r.expression, r.level, r.enabled, r.hit_count, r.updated_at
       FROM risk_rule r WHERE ${conds.join(' AND ')} ORDER BY r.id`,
    params,
  );
  ok(res, rows.map(mapRule), { total: rows.length });
});

riskRouter.put('/rules/:id/toggle', requirePerm('risk', 'write'), async (req, res) => {
  const id = parseId(req.params.id, '规则 ID');
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body ?? {});
  const existing = await queryOne<RiskRuleRow>(
    `SELECT r.id, r.rule_code, r.rule_name, r.event_type, r.expression, r.level, r.enabled, r.hit_count, r.updated_at
       FROM risk_rule r WHERE r.id = ?`,
    [id],
  );
  if (!existing) throw new ApiError(404, '监测规则不存在');
  await execute('UPDATE risk_rule SET enabled = ?, updated_at = NOW() WHERE id = ?', [enabled ? 1 : 0, id]);
  const row = await queryOne<RiskRuleRow>(
    `SELECT r.id, r.rule_code, r.rule_name, r.event_type, r.expression, r.level, r.enabled, r.hit_count, r.updated_at
       FROM risk_rule r WHERE r.id = ?`,
    [id],
  );
  req.auditAction = enabled ? '启用风险监测规则' : '停用风险监测规则';
  req.auditResource = '风险监测';
  req.auditDetail = `监测规则 ${existing.rule_code} ${existing.rule_name} 已${enabled ? '启用' : '停用'}`;
  ok(res, row ? mapRule(row) : { id, enabled });
});

/* ============================ 风险事件 ============================ */

riskRouter.get('/events', requirePerm('risk'), async (req, res) => {
  const user = currentUser(req);
  const p = parsePagination(req.query as Record<string, unknown>);
  const conds: string[] = ['1 = 1'];
  const params: unknown[] = [];

  const level = pickEnum(req.query.level, LEVELS, '风险级别');
  if (level) {
    conds.push('e.level = ?');
    params.push(level);
  }
  const status = pickEnum(req.query.status, STATUSES, '处置状态');
  if (status) {
    conds.push('e.status = ?');
    params.push(status);
  }
  const eventType = pickEnum(req.query.eventType, EVENT_TYPES, '事件类型');
  if (eventType) {
    conds.push('e.event_type = ?');
    params.push(eventType);
  }
  const keyword = strOrUndef(req.query.keyword);
  if (keyword) {
    const like = `%${keyword}%`;
    conds.push('(e.event_no LIKE ? OR e.detail LIKE ? OR e.username LIKE ? OR e.ip LIKE ? OR a.asset_name LIKE ? OR r.rule_name LIKE ?)');
    params.push(like, like, like, like, like, like);
  }
  const start = dateBound(req.query.start, false);
  if (start) {
    conds.push('e.occurred_at >= ?');
    params.push(start);
  }
  const end = dateBound(req.query.end, true);
  if (end) {
    conds.push('e.occurred_at <= ?');
    params.push(end);
  }
  const built = buildWhere(user, conds, params);

  const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c ${EVENT_FROM} WHERE ${built.where}`, built.params);
  const rows = await query<RiskEventRow>(
    `SELECT ${EVENT_SELECT} ${EVENT_FROM} WHERE ${built.where}
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT ${p.pageSize} OFFSET ${p.offset}`,
    built.params,
  );
  const total = Number(totalRow?.c ?? 0);
  ok(res, rows.map(mapEvent), { total, page: p.page, pageSize: p.pageSize });
});

riskRouter.get('/events/:id', requirePerm('risk'), async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id, '事件 ID');
  const row = await loadEventById(user, id);
  if (!row) throw new ApiError(404, '风险事件不存在或不在数据权限范围内');

  const scope = scopeOf(user);
  const related = await query<RiskEventRow>(
    `SELECT ${EVENT_SELECT} ${EVENT_FROM}
      WHERE e.id <> ? AND (e.ip = ? OR e.username = ?) ${scope.sql}
      ORDER BY e.occurred_at DESC LIMIT 5`,
    [id, row.ip, row.username, ...scope.params],
  );
  const asset = await loadAsset(row.asset_id);
  ok(res, { ...mapEvent(row), related: related.map(mapEvent), asset });
});

riskRouter.post('/events/:id/handle', requirePerm('risk', 'write'), async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id, '事件 ID');
  const payload = z.object({
    status: z.enum(['处置中', '已处置'], { errorMap: () => ({ message: '处置状态只能为 处置中 或 已处置' }) }),
    note: z.string().trim().max(255, '处置意见不能超过 255 字').optional(),
  }).parse(req.body ?? {});

  const scope = scopeOf(user);
  const current = await queryOne<{ id: number; event_no: string; status: string; level: string; username: string }>(
    `SELECT e.id, e.event_no, e.status, e.level, e.username FROM risk_event e WHERE e.id = ? ${scope.sql}`,
    [id, ...scope.params],
  );
  if (!current) throw new ApiError(404, '风险事件不存在或不在数据权限范围内');
  if (current.status === '已处置' || current.status === '已忽略') {
    throw new ApiError(400, `事件 ${current.event_no} 当前状态为「${current.status}」，无法重复处置`);
  }

  await execute(
    'UPDATE risk_event SET status = ?, handled_by = ?, handled_at = ?, handle_note = ? WHERE id = ?',
    [payload.status, user.username, now(), payload.note ?? null, id],
  );

  await notifyRiskEvent({
    eventId: id,
    eventNo: current.event_no,
    eventUser: current.username,
    level: current.level,
    title: `风险事件 ${current.event_no} 已${payload.status === '已处置' ? '处置' : '受理'}`,
    content: `事件「${current.event_no}」由 ${user.realName}（${user.username}）更新为「${payload.status}」，处置意见：${payload.note || '无'}`,
  });

  const updated = await loadEventById(user, id);
  req.auditAction = payload.status === '已处置' ? '处置风险事件' : '受理风险事件';
  req.auditResource = '风险事件';
  req.auditDetail = `${current.event_no} 状态由「${current.status}」更新为「${payload.status}」，处置人 ${user.username}`;
  ok(res, updated ? mapEvent(updated) : { id, status: payload.status });
});

riskRouter.post('/events/:id/ignore', requirePerm('risk', 'write'), async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id, '事件 ID');
  const payload = z.object({
    note: z.string().trim().max(255, '忽略说明不能超过 255 字').optional(),
  }).parse(req.body ?? {});

  const scope = scopeOf(user);
  const current = await queryOne<{ id: number; event_no: string; status: string; level: string; username: string }>(
    `SELECT e.id, e.event_no, e.status, e.level, e.username FROM risk_event e WHERE e.id = ? ${scope.sql}`,
    [id, ...scope.params],
  );
  if (!current) throw new ApiError(404, '风险事件不存在或不在数据权限范围内');
  if (current.status === '已处置' || current.status === '已忽略') {
    throw new ApiError(400, `事件 ${current.event_no} 当前状态为「${current.status}」，无法再次忽略`);
  }

  await execute(
    'UPDATE risk_event SET status = ?, handled_by = ?, handled_at = ?, handle_note = ? WHERE id = ?',
    ['已忽略', user.username, now(), payload.note ?? null, id],
  );

  await notifyRiskEvent({
    eventId: id,
    eventNo: current.event_no,
    eventUser: current.username,
    level: current.level,
    title: `风险事件 ${current.event_no} 已忽略`,
    content: `事件「${current.event_no}」由 ${user.realName}（${user.username}）标记为已忽略，忽略说明：${payload.note || '无'}`,
  });

  const updated = await loadEventById(user, id);
  req.auditAction = '忽略风险事件';
  req.auditResource = '风险事件';
  req.auditDetail = `${current.event_no} 由「${current.status}」更新为「已忽略」，操作人 ${user.username}`;
  ok(res, updated ? mapEvent(updated) : { id, status: '已忽略' });
});

/* ============================ 溯源链路 ============================ */

riskRouter.get('/trace', requirePerm('risk'), async (req, res) => {
  const user = currentUser(req);
  const eventId = parseId(String(req.query.eventId ?? ''), '事件 ID');
  const row = await loadEventById(user, eventId);
  if (!row) throw new ApiError(404, '风险事件不存在或不在数据权限范围内');

  const scope = scopeOf(user);

  const account = await queryOne<{
    id: number; username: string; real_name: string; status: number; dept_id: number | null; dept_name: string | null;
    job_title: string | null; email: string | null; phone: string | null;
    last_login_at: Date | string | null; last_login_ip: string | null;
  }>(
    `SELECT u.id, u.username, u.real_name, u.status, u.dept_id, d.dept_name, u.job_title,
            u.email, u.phone, u.last_login_at, u.last_login_ip
       FROM sys_user u LEFT JOIN sys_dept d ON d.id = u.dept_id
      WHERE u.username = ?`,
    [row.username],
  );
  const roles = account
    ? await query<{ role_code: string; role_name: string }>(
      `SELECT r.role_code, r.role_name FROM sys_role r
         JOIN sys_user_role ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.id`,
      [account.id],
    )
    : [];

  const asset = await loadAsset(row.asset_id);

  const auditLogs = await query<{
    id: number; log_type: string; username: string; action: string; resource: string | null;
    method: string | null; path: string | null; ip: string | null; status_code: number;
    result: string; detail: string | null; created_at: Date | string;
  }>(
    `SELECT id, log_type, username, action, resource, method, path, ip, status_code, result, detail, created_at
       FROM audit_log
      WHERE username = ? OR ip = ?
      ORDER BY created_at DESC LIMIT 10`,
    [row.username, row.ip],
  );

  // 同 IP 其他事件：严格同 IP 优先，同时补充同 /24 网段事件（演示数据 IP 唯一时链路仍有可看内容）
  let sameIp: Array<Record<string, unknown>> = [];
  if (row.ip) {
    const prefix = `${row.ip.split('.').slice(0, 3).join('.')}.%`;
    const rows = await query<RiskEventRow & { match_type: string }>(
      `SELECT ${EVENT_SELECT}, IF(e.ip = ?, '同IP', '同网段') AS match_type ${EVENT_FROM}
        WHERE e.id <> ? AND (e.ip = ? OR e.ip LIKE ?) ${scope.sql}
        ORDER BY (e.ip = ?) DESC, e.occurred_at DESC LIMIT 10`,
      [row.ip, eventId, row.ip, prefix, ...scope.params, row.ip],
    );
    sameIp = rows.map((r) => ({ ...mapEvent(r), match_type: r.match_type }));
  }

  ok(res, {
    event: mapEvent(row),
    account: account
      ? {
        ...account,
        status: Number(account.status),
        last_login_at: dt(account.last_login_at),
        roles,
      }
      : null,
    asset,
    auditLogs: auditLogs.map((l) => ({ ...l, created_at: dt(l.created_at) })),
    sameIp,
    generatedAt: now(),
  });
});

/* ============================ 趋势 ============================ */

riskRouter.get('/trend', requirePerm('risk'), async (req, res) => {
  const user = currentUser(req);
  const rawDays = Number(strOrUndef(req.query.days) ?? 7);
  const days = Number.isFinite(rawDays) ? Math.min(Math.max(Math.floor(rawDays), 1), 30) : 7;

  const scope = scopeOf(user);
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - (days - 1));

  const rows = await query<{ d: string; low: number; mid: number; high: number; urgent: number; total: number }>(
    `SELECT DATE_FORMAT(e.occurred_at, '%Y-%m-%d') AS d,
            SUM(e.level = '低') AS low, SUM(e.level = '中') AS mid,
            SUM(e.level = '高') AS high, SUM(e.level = '紧急') AS urgent,
            COUNT(*) AS total
       FROM risk_event e
      WHERE e.occurred_at >= ? ${scope.sql}
      GROUP BY d ORDER BY d`,
    [fmtDateTime(startDate), ...scope.params],
  );

  const byDate = new Map(rows.map((r) => [String(r.d), r]));
  const result: Array<Record<string, unknown>> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = fmtDate(d);
    const hit = byDate.get(key);
    result.push({
      date: key,
      low: Number(hit?.low ?? 0),
      mid: Number(hit?.mid ?? 0),
      high: Number(hit?.high ?? 0),
      urgent: Number(hit?.urgent ?? 0),
      total: Number(hit?.total ?? 0),
    });
  }
  ok(res, result, { days });
});

/* ============================ 实时监控 ============================ */

riskRouter.get('/realtime', requirePerm('risk'), async (req, res) => {
  const user = currentUser(req);
  const scope = scopeOf(user);

  const [latest, perMinRows, topIpRows, levelRows] = await Promise.all([
    query<RiskEventRow>(
      `SELECT ${EVENT_SELECT} ${EVENT_FROM}
        WHERE 1 = 1 ${scope.sql}
        ORDER BY e.occurred_at DESC, e.id DESC LIMIT 20`,
      scope.params,
    ),
    query<{ m: string; c: number }>(
      `SELECT DATE_FORMAT(e.occurred_at, '%Y-%m-%d %H:%i') AS m, COUNT(*) AS c
         FROM risk_event e
        WHERE e.occurred_at >= DATE_SUB(NOW(), INTERVAL 59 MINUTE) ${scope.sql}
        GROUP BY m ORDER BY m`,
      scope.params,
    ),
    query<{ ip: string; hits: number; urgent: number; users: number; last_at: Date | string }>(
      `SELECT e.ip AS ip, COUNT(*) AS hits, SUM(e.level = '紧急') AS urgent,
              COUNT(DISTINCT e.username) AS users, MAX(e.occurred_at) AS last_at
         FROM risk_event e
        WHERE e.ip IS NOT NULL AND e.occurred_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) ${scope.sql}
        GROUP BY e.ip
        ORDER BY hits DESC, urgent DESC, MAX(e.occurred_at) DESC
        LIMIT 5`,
      scope.params,
    ),
    query<{ level: string; c: number }>(
      `SELECT e.level, COUNT(*) AS c FROM risk_event e WHERE 1 = 1 ${scope.sql} GROUP BY e.level`,
      scope.params,
    ),
  ]);

  const minuteMap = new Map(perMinRows.map((r) => [String(r.m), Number(r.c)]));
  const minuteBase = new Date();
  minuteBase.setSeconds(0, 0);
  const perMinute: Array<{ minute: string; count: number }> = [];
  for (let i = 59; i >= 0; i -= 1) {
    const d = new Date(minuteBase.getTime() - i * 60 * 1000);
    const key = fmtDateTime(d).slice(0, 16);
    perMinute.push({ minute: key, count: minuteMap.get(key) ?? 0 });
  }

  ok(res, {
    latest: latest.map(mapEvent),
    perMinute,
    topIps: topIpRows.map((r) => ({
      ip: r.ip,
      hits: Number(r.hits),
      urgent: Number(r.urgent),
      users: Number(r.users),
      last_at: dt(r.last_at),
    })),
    levelCounts: LEVELS.map((level) => ({
      level,
      count: Number(levelRows.find((r) => r.level === level)?.c ?? 0),
    })),
    generatedAt: now(),
  });
});
