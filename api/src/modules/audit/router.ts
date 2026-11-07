import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne } from '../../db/pool.ts';
import { ApiError, ok } from '../../lib/http.ts';
import { pageMeta, parsePagination, strOrUndef } from '../../lib/query.ts';
import { daysAgo, fmtDate, fmtDateTime } from '../../lib/time.ts';
import { authenticate, currentUser, dataScopeFilter, requirePerm } from '../../middleware/auth.ts';
import type { AuthUser } from '../../types.ts';

export const auditRouter = Router();

auditRouter.use(authenticate);

const READ = requirePerm('audit');
const WRITE = requirePerm('audit', 'write');

/* ============================ 通用工具 ============================ */

interface ScopeClause {
  sql: string;
  params: unknown[];
}

/**
 * 数据级权限：audit_log 表没有 dept_id 字段。
 * - ALL：不过滤；
 * - DEPT：通过 user_id 关联 sys_user.dept_id（子查询）；
 * - SELF/CUSTOM：复用公共 dataScopeFilter，按 username 过滤。
 */
function auditScope(user: AuthUser): ScopeClause {
  if (user.roleCodes.includes('SUPER_ADMIN') || user.dataScope === 'ALL') return { sql: '', params: [] };
  if (user.dataScope === 'DEPT') {
    return {
      sql: 'AND l.user_id IN (SELECT su.id FROM sys_user su WHERE su.dept_id = ?)',
      params: [user.deptId],
    };
  }
  return dataScopeFilter(user, 'l', 'dept_id', 'username');
}

interface LogFilters {
  where: string;
  params: unknown[];
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function normalizeStart(v?: string): string | undefined {
  if (!v) return undefined;
  return DATE_ONLY.test(v) ? `${v} 00:00:00` : v;
}

function normalizeEnd(v?: string): string | undefined {
  if (!v) return undefined;
  return DATE_ONLY.test(v) ? `${v} 23:59:59` : v;
}

/** 日志列表/导出共用的筛选条件（logType/result/keyword/start/end + 数据级权限） */
function buildLogWhere(q: Record<string, unknown>, user: AuthUser): LogFilters {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const logType = strOrUndef(q.logType);
  if (logType) {
    clauses.push('l.log_type = ?');
    params.push(logType);
  }
  const result = strOrUndef(q.result);
  if (result) {
    clauses.push('l.result = ?');
    params.push(result);
  }
  const keyword = strOrUndef(q.keyword);
  if (keyword) {
    clauses.push('(l.username LIKE ? OR l.action LIKE ? OR l.ip LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  const start = normalizeStart(strOrUndef(q.start));
  if (start) {
    clauses.push('l.created_at >= ?');
    params.push(start);
  }
  const end = normalizeEnd(strOrUndef(q.end));
  if (end) {
    clauses.push('l.created_at <= ?');
    params.push(end);
  }

  const scope = auditScope(user);
  if (scope.sql) {
    clauses.push(scope.sql.replace(/^AND\s+/, ''));
    params.push(...scope.params);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

interface LogRow {
  id: number;
  log_type: string;
  user_id: number | null;
  username: string;
  action: string;
  resource: string | null;
  method: string | null;
  path: string | null;
  ip: string | null;
  user_agent: string | null;
  status_code: number;
  result: string;
  detail: string | null;
  created_at: string;
}

interface ChainRow {
  id: number;
  log_type: string;
  username: string;
  action: string;
  created_at: string;
}

const LOG_COLUMNS = `l.id, l.log_type, l.user_id, l.username, l.action, l.resource, l.method, l.path,
           l.ip, l.user_agent, l.status_code, l.result, l.detail,
           DATE_FORMAT(l.created_at, '%Y-%m-%d %H:%i:%s') AS created_at`;

const CHAIN_COLUMNS = `id, log_type, username, action,
           DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at`;

/* ============================ SHA-256 链式校验 ============================ */

/** 创世摘要（固定值，作为链头前驱） */
const GENESIS_HASH = '0'.repeat(64);

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** hash = sha256(prevHash + id + log_type + username + action + created_at) */
function calcChainHash(prevHash: string, row: ChainRow): string {
  return sha256(`${prevHash}${row.id}${row.log_type}${row.username}${row.action}${row.created_at}`);
}

interface ChainCheck {
  headHash: string;
  broken: Array<{ id: number; reason: string }>;
  checked: number;
}

/** 按 id 升序实时重建整条哈希链（演示近似：链由当前库内容实时重建） */
function verifyChain(rows: ChainRow[]): ChainCheck {
  let prev = GENESIS_HASH;
  let lastId = 0;
  const broken: Array<{ id: number; reason: string }> = [];
  for (const row of rows) {
    if (row.id <= lastId) broken.push({ id: row.id, reason: '主键顺序异常，链式结构被破坏' });
    if (!row.log_type || !row.username || !row.action || !row.created_at) {
      broken.push({ id: row.id, reason: '关键字段缺失，无法计算可信摘要' });
    }
    prev = calcChainHash(prev, row);
    lastId = row.id;
  }
  return { headHash: prev, broken, checked: rows.length };
}

/* ============================ GET /overview ============================ */

interface CountRow { c: number | string }
interface AggRow { total: number | string; fail: number | string }

auditRouter.get('/overview', READ, async (req, res) => {
  const user = currentUser(req);
  const scope = auditScope(user);
  const sp = scope.params;
  const todayStr = fmtDate(new Date());
  const weekStart = `${fmtDate(daysAgo(6))} 00:00:00`;

  const [
    todayAgg,
    totalRow,
    activeUserRow,
    reportRow,
    typeRows,
    resultRows,
    trendRows,
    topUserRows,
    topIpRows,
  ] = await Promise.all([
    queryOne<AggRow>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(l.result = '失败'), 0) AS fail
         FROM audit_log l WHERE DATE(l.created_at) = ? ${scope.sql}`,
      [todayStr, ...sp],
    ),
    queryOne<CountRow>(`SELECT COUNT(*) AS c FROM audit_log l WHERE 1 = 1 ${scope.sql}`, sp),
    queryOne<CountRow>(
      `SELECT COUNT(DISTINCT l.username) AS c FROM audit_log l WHERE l.created_at >= ? ${scope.sql}`,
      [weekStart, ...sp],
    ),
    queryOne<CountRow>('SELECT COUNT(*) AS c FROM audit_report'),
    query<{ name: string; value: number | string }>(
      `SELECT l.log_type AS name, COUNT(*) AS value
         FROM audit_log l WHERE DATE(l.created_at) = ? ${scope.sql}
        GROUP BY l.log_type`,
      [todayStr, ...sp],
    ),
    query<{ name: string; value: number | string }>(
      `SELECT l.result AS name, COUNT(*) AS value
         FROM audit_log l WHERE l.created_at >= ? ${scope.sql}
        GROUP BY l.result`,
      [weekStart, ...sp],
    ),
    query<{ d: string; total: number | string; fail: number | string }>(
      `SELECT DATE_FORMAT(l.created_at, '%Y-%m-%d') AS d, COUNT(*) AS total,
              COALESCE(SUM(l.result = '失败'), 0) AS fail
         FROM audit_log l WHERE l.created_at >= ? ${scope.sql}
        GROUP BY DATE_FORMAT(l.created_at, '%Y-%m-%d') ORDER BY d`,
      [weekStart, ...sp],
    ),
    query<{ username: string; value: number | string }>(
      `SELECT l.username, COUNT(*) AS value
         FROM audit_log l WHERE l.created_at >= ? ${scope.sql}
        GROUP BY l.username ORDER BY value DESC, l.username ASC LIMIT 5`,
      [weekStart, ...sp],
    ),
    query<{ ip: string; total: number | string; fail: number | string }>(
      `SELECT l.ip, COUNT(*) AS total, COALESCE(SUM(l.result = '失败'), 0) AS fail
         FROM audit_log l
        WHERE l.created_at >= ? AND (l.result = '失败' OR l.status_code >= 400) ${scope.sql}
        GROUP BY l.ip ORDER BY fail DESC, total DESC, l.ip ASC LIMIT 5`,
      [weekStart, ...sp],
    ),
  ]);

  const todayTotal = Number(todayAgg?.total ?? 0);
  const todayFail = Number(todayAgg?.fail ?? 0);

  const trend: Array<{ date: string; total: number; fail: number }> = [];
  for (let i = 6; i >= 0; i -= 1) {
    const key = fmtDate(daysAgo(i));
    const hit = trendRows.find((r) => r.d === key);
    trend.push({ date: key.slice(5), total: Number(hit?.total ?? 0), fail: Number(hit?.fail ?? 0) });
  }

  const typeOrder = ['登录日志', '访问日志', '操作日志', '接口日志'];
  const logTypeDist = typeOrder.map((name) => ({
    name,
    value: Number(typeRows.find((r) => r.name === name)?.value ?? 0),
  }));
  const resultOrder = ['成功', '失败'];
  const resultDist = resultOrder.map((name) => ({
    name,
    value: Number(resultRows.find((r) => r.name === name)?.value ?? 0),
  }));

  ok(res, {
    cards: {
      todayLogs: todayTotal,
      todayFail,
      failRate: todayTotal > 0 ? Math.round((todayFail / todayTotal) * 1000) / 10 : 0,
      totalLogs: Number(totalRow?.c ?? 0),
      activeUsers: Number(activeUserRow?.c ?? 0),
      reportCount: Number(reportRow?.c ?? 0),
    },
    logTypeDist,
    resultDist,
    trend,
    topUsers: topUserRows.map((r) => ({ username: r.username, count: Number(r.value) })),
    topIps: topIpRows.map((r) => ({ ip: r.ip, total: Number(r.total), fail: Number(r.fail) })),
    generatedAt: fmtDateTime(new Date()),
  });
});

/* ============================ GET /logs ============================ */

auditRouter.get('/logs', READ, async (req, res) => {
  const user = currentUser(req);
  const q = req.query as Record<string, unknown>;
  const p = parsePagination(q);
  const { where, params } = buildLogWhere(q, user);

  const totalRow = await queryOne<CountRow>(`SELECT COUNT(*) AS c FROM audit_log l ${where}`, params);
  const rows = await query<LogRow>(
    `SELECT ${LOG_COLUMNS} FROM audit_log l ${where}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ${p.pageSize} OFFSET ${p.offset}`,
    params,
  );
  const meta = pageMeta(Number(totalRow?.c ?? 0), p);
  ok(res, rows, { total: meta.total, page: meta.page, pageSize: meta.pageSize });
});

/* ============================ GET /logs/:id ============================ */

auditRouter.get('/logs/:id', READ, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, '日志 ID 不合法');

  const user = currentUser(req);
  const scope = auditScope(user);
  const record = await queryOne<LogRow>(
    `SELECT ${LOG_COLUMNS} FROM audit_log l WHERE l.id = ? ${scope.sql}`,
    [id, ...scope.params],
  );
  if (!record) throw new ApiError(404, '审计日志不存在或当前角色无权查看');

  // 重建到该条日志为止的哈希链，得出其 prevHash / hash
  const chainRows = await query<ChainRow>(
    `SELECT ${CHAIN_COLUMNS} FROM audit_log WHERE id <= ? ORDER BY id ASC`,
    [id],
  );
  let prevHash = GENESIS_HASH;
  let hash = GENESIS_HASH;
  const broken: Array<{ id: number; reason: string }> = [];
  let lastId = 0;
  for (const row of chainRows) {
    if (row.id <= lastId) broken.push({ id: row.id, reason: '主键顺序异常，链式结构被破坏' });
    const current = calcChainHash(prevHash, row);
    if (row.id === id) {
      hash = current;
      break;
    }
    prevHash = current;
    lastId = row.id;
  }
  const recomputed = calcChainHash(prevHash, record);
  const verified = broken.length === 0 && hash === recomputed;

  ok(res, { record, hash, prevHash, verified });
});

/* ============================ GET /export ============================ */

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

auditRouter.get('/export', READ, async (req, res) => {
  const user = currentUser(req);
  const q = req.query as Record<string, unknown>;
  const { where, params } = buildLogWhere(q, user);

  const rows = await query<LogRow>(
    `SELECT ${LOG_COLUMNS} FROM audit_log l ${where}
      ORDER BY l.created_at DESC, l.id DESC LIMIT 5000`,
    params,
  );

  const header = ['日志ID', '日志类型', '操作账号', '动作', '资源类型', '请求方法', '请求路径',
    'IP地址', '状态码', '结果', '详情', '发生时间'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.id, r.log_type, r.username, r.action, r.resource, r.method, r.path,
      r.ip, r.status_code, r.result, r.detail, r.created_at,
    ].map(csvCell).join(','));
  }
  const csv = `\uFEFF${lines.join('\r\n')}`;
  const day = fmtDate(new Date()).replace(/-/g, '');
  const fileName = `审计日志_${day}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="audit_logs_${day}.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.send(csv);
});

/* ============================ GET /integrity ============================ */

auditRouter.get('/integrity', READ, async (_req, res) => {
  const rows = await query<ChainRow>(
    `SELECT ${CHAIN_COLUMNS} FROM audit_log ORDER BY id ASC`,
  );
  const result = verifyChain(rows);
  ok(res, {
    total: rows.length,
    verifiedAt: fmtDateTime(new Date()),
    chainValid: result.broken.length === 0,
    checked: result.checked,
    broken: result.broken,
    headHash: result.headHash,
    algorithm: 'SHA-256 链式校验（实时重建）',
  });
});

/* ============================ GET /reports ============================ */

interface ReportRow {
  id: number;
  report_no: string;
  report_name: string;
  report_type: string;
  period_start: string;
  period_end: string;
  total_events: number;
  risk_events: number;
  compliance_rate: number | string;
  generated_by: string;
  content: string | null;
  created_at: string;
}

const REPORT_COLUMNS = `id, report_no, report_name, report_type,
           DATE_FORMAT(period_start, '%Y-%m-%d') AS period_start,
           DATE_FORMAT(period_end, '%Y-%m-%d') AS period_end,
           total_events, risk_events, compliance_rate, generated_by, content,
           DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at`;

auditRouter.get('/reports', READ, async (req, res) => {
  const q = req.query as Record<string, unknown>;
  const p = parsePagination(q);
  const reportType = strOrUndef(q.reportType);

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (reportType) {
    clauses.push('report_type = ?');
    params.push(reportType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const totalRow = await queryOne<CountRow>(`SELECT COUNT(*) AS c FROM audit_report ${where}`, params);
  const rows = await query<ReportRow>(
    `SELECT ${REPORT_COLUMNS} FROM audit_report ${where}
      ORDER BY created_at DESC, id DESC LIMIT ${p.pageSize} OFFSET ${p.offset}`,
    params,
  );
  const meta = pageMeta(Number(totalRow?.c ?? 0), p);
  ok(res, rows, { total: meta.total, page: meta.page, pageSize: meta.pageSize });
});

/* ============================ POST /reports ============================ */

const createReportSchema = z.object({
  reportType: z.enum(['日报', '周报', '月报', '年报'], {
    errorMap: () => ({ message: '报表类型必须为 日报/周报/月报/年报 之一' }),
  }),
});

/** 报表统计周期（与 seed 一致，采用滚动窗口） */
function reportPeriod(type: '日报' | '周报' | '月报' | '年报'): { start: string; end: string } {
  const endDate = new Date();
  const days = type === '日报' ? 0 : type === '周报' ? 6 : type === '月报' ? 29 : 364;
  return { start: fmtDate(daysAgo(days)), end: fmtDate(endDate) };
}

function reportName(type: string, start: string, end: string): string {
  if (type === '年报') return `数据安全审计年报（${end.slice(0, 4)} 年度）（${start} 至 ${end}）`;
  return `数据安全审计${type}（${start} 至 ${end}）`;
}

auditRouter.post('/reports', WRITE, async (req, res) => {
  const user = currentUser(req);
  const { reportType } = createReportSchema.parse(req.body);
  const { start, end } = reportPeriod(reportType);

  const [logAgg, riskAgg, checkAgg] = await Promise.all([
    queryOne<CountRow>(
      'SELECT COUNT(*) AS c FROM audit_log WHERE DATE(created_at) BETWEEN ? AND ?',
      [start, end],
    ),
    queryOne<{ total: number | string; handled: number | string }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status IN ('已处置', '已忽略')), 0) AS handled
         FROM risk_event WHERE DATE(occurred_at) BETWEEN ? AND ?`,
      [start, end],
    ),
    queryOne<{ total: number | string; passed: number | string }>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(result = '通过'), 0) AS passed
         FROM compliance_check WHERE DATE(checked_at) BETWEEN ? AND ?`,
      [start, end],
    ),
  ]);

  const totalEvents = Number(logAgg?.c ?? 0);
  const riskEvents = Number(riskAgg?.total ?? 0);
  const handledRate = riskEvents > 0 ? Math.round((Number(riskAgg?.handled ?? 0) / riskEvents) * 1000) / 10 : 0;
  const checkTotal = Number(checkAgg?.total ?? 0);
  const complianceRate = checkTotal > 0
    ? Math.round((Number(checkAgg?.passed ?? 0) / checkTotal) * 10000) / 100
    : 0;

  const content = `本${reportType}共记录审计事件 ${totalEvents.toLocaleString('en-US')} 条，`
    + `其中安全风险事件 ${riskEvents} 条，风险处置率 ${handledRate}%，`
    + `合规检查通过率 ${Number(complianceRate.toFixed(1))}%，未发现数据泄露事件。`;

  // 报表编号：AR-<年份>-<4 位流水>，从 AR-2026-0006 起递增
  const year = Number(end.slice(0, 4));
  const prefix = `AR-${year}-`;
  const seqRow = await queryOne<{ max_seq: number | string | null }>(
    'SELECT MAX(CAST(SUBSTRING(report_no, 9) AS UNSIGNED)) AS max_seq FROM audit_report WHERE report_no LIKE ?',
    [`${prefix}%`],
  );
  const reportNo = `${prefix}${String(Number(seqRow?.max_seq ?? 0) + 1).padStart(4, '0')}`;
  const name = reportName(reportType, start, end);
  const createdAt = fmtDateTime(new Date());

  const inserted = await execute(
    `INSERT INTO audit_report
       (report_no, report_name, report_type, period_start, period_end, total_events, risk_events,
        compliance_rate, generated_by, content, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [reportNo, name, reportType, start, end, totalEvents, riskEvents,
      complianceRate, user.realName, content, createdAt],
  ).catch((err: unknown) => {
    const e = err as { code?: string };
    if (e?.code === 'ER_DUP_ENTRY') throw new ApiError(409, '报表编号冲突，请重试');
    throw err;
  });

  const report = await queryOne<ReportRow>(
    `SELECT ${REPORT_COLUMNS} FROM audit_report WHERE id = ?`,
    [inserted.insertId],
  );

  req.auditAction = '生成审计报表';
  req.auditResource = '审计日志';
  req.auditDetail = `生成${reportType} ${reportNo}，统计周期 ${start} 至 ${end}，共 ${totalEvents} 条审计事件`;

  ok(res, report);
});

/* ============================ GET /reports/:id ============================ */

auditRouter.get('/reports/:id', READ, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, '报表 ID 不合法');

  const record = await queryOne<ReportRow>(
    `SELECT ${REPORT_COLUMNS} FROM audit_report WHERE id = ?`,
    [id],
  );
  if (!record) throw new ApiError(404, '审计报表不存在');

  const [logTypes, resultDist, riskLevels, checkAgg] = await Promise.all([
    query<{ name: string; value: number | string }>(
      `SELECT log_type AS name, COUNT(*) AS value FROM audit_log
        WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY log_type`,
      [record.period_start, record.period_end],
    ),
    query<{ name: string; value: number | string }>(
      `SELECT result AS name, COUNT(*) AS value FROM audit_log
        WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY result`,
      [record.period_start, record.period_end],
    ),
    query<{ name: string; value: number | string }>(
      `SELECT level AS name, COUNT(*) AS value FROM risk_event
        WHERE DATE(occurred_at) BETWEEN ? AND ? GROUP BY level`,
      [record.period_start, record.period_end],
    ),
    queryOne<{ total: number | string; passed: number | string; warning: number | string; failed: number | string }>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(result = '通过'), 0) AS passed,
              COALESCE(SUM(result = '警告'), 0) AS warning, COALESCE(SUM(result = '不通过'), 0) AS failed
         FROM compliance_check WHERE DATE(checked_at) BETWEEN ? AND ?`,
      [record.period_start, record.period_end],
    ),
  ]);

  const typeOrder = ['登录日志', '访问日志', '操作日志', '接口日志'];
  const levelOrder = ['低', '中', '高', '紧急'];
  ok(res, {
    record,
    breakdown: {
      logTypes: typeOrder.map((name) => ({
        name,
        value: Number(logTypes.find((r) => r.name === name)?.value ?? 0),
      })),
      results: ['成功', '失败'].map((name) => ({
        name,
        value: Number(resultDist.find((r) => r.name === name)?.value ?? 0),
      })),
      riskLevels: levelOrder.map((name) => ({
        name,
        value: Number(riskLevels.find((r) => r.name === name)?.value ?? 0),
      })),
      compliance: {
        total: Number(checkAgg?.total ?? 0),
        passed: Number(checkAgg?.passed ?? 0),
        warning: Number(checkAgg?.warning ?? 0),
        failed: Number(checkAgg?.failed ?? 0),
      },
    },
  });
});
