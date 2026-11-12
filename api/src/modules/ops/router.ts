import { createHash, randomInt } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne } from '../../db/pool.ts';
import { ApiError, ok } from '../../lib/http.ts';
import { numOrUndef, pageMeta, parsePagination, strOrUndef, WhereBuilder } from '../../lib/query.ts';
import { fmtDate, fmtDateTime, now, startOfDayOffset, today } from '../../lib/time.ts';
import { authenticate, currentUser, requirePerm } from '../../middleware/auth.ts';

/** 服务保障运维模块（契约第八章） */
export const opsRouter = Router();

opsRouter.use(authenticate);

const TICKET_STATUSES = ['待受理', '处理中', '待验证', '已关闭'] as const;
const TICKET_CATEGORIES = ['故障处理', '安全事件', '服务咨询', '变更申请'] as const;
const TICKET_PRIORITIES = ['低', '中', '高', '紧急'] as const;
const BACKUP_TYPES = ['全量', '增量'] as const;
const BACKUP_STATUSES = ['成功', '失败', '进行中'] as const;

/** 告警阈值（契约第八章：cpu>85、mem>85、api_avg_ms>500） */
const THRESHOLDS = { cpu_usage: 85, mem_usage: 85, api_avg_ms: 500 };

/** 工单状态机：仅允许单向流转 */
const NEXT_STATUS: Record<string, string> = { 待受理: '处理中', 处理中: '待验证', 待验证: '已关闭' };
const TRACE_ACTION: Record<string, string> = { 处理中: '受理', 待验证: '处理', 已关闭: '关闭' };
const ALERT_LEVEL_RANK: Record<string, number> = { 严重: 0, 警告: 1, 信息: 2 };

const METRIC_COLS = `DATE_FORMAT(metric_time, '%Y-%m-%d %H:%i:%s') AS metric_time,
       cpu_usage, mem_usage, disk_usage, api_qps, api_avg_ms, db_connections, redis_hit_rate, online_users`;

const TICKET_COLS = `id, ticket_no, title, category, priority, status, reporter, assignee, contact, description, resolution, sla_hours,
       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
       DATE_FORMAT(accepted_at, '%Y-%m-%d %H:%i:%s') AS accepted_at,
       DATE_FORMAT(closed_at, '%Y-%m-%d %H:%i:%s') AS closed_at`;

const TRACE_COLS = `id, ticket_id, action, operator, note,
       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at`;

const BACKUP_COLS = `id, backup_no, backup_type, \`scope\`, size_mb, status, storage_path, checksum,
       DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s') AS started_at,
       DATE_FORMAT(finished_at, '%Y-%m-%d %H:%i:%s') AS finished_at, operator`;

const CONFIG_COLS = `config_key, config_value, config_group, description,
       DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at`;

interface MetricRow {
  metric_time: string;
  cpu_usage: string;
  mem_usage: string;
  disk_usage: string;
  api_qps: number;
  api_avg_ms: number;
  db_connections: number;
  redis_hit_rate: string;
  online_users: number;
}

interface TicketRow {
  id: number;
  ticket_no: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  reporter: string;
  assignee: string | null;
  contact: string | null;
  description: string;
  resolution: string | null;
  sla_hours: number;
  created_at: string;
  accepted_at: string | null;
  closed_at: string | null;
}

interface TraceRow {
  id: number;
  ticket_id: number;
  action: string;
  operator: string;
  note: string | null;
  created_at: string;
}

interface BackupRow {
  id: number;
  backup_no: string;
  backup_type: string;
  scope: string;
  size_mb: string;
  status: string;
  storage_path: string;
  checksum: string | null;
  started_at: string;
  finished_at: string | null;
  operator: string;
}

interface ConfigRow {
  config_key: string;
  config_value: string;
  config_group: string;
  description: string | null;
  updated_at: string;
}

interface AlertItem {
  id: string;
  level: '严重' | '警告' | '信息';
  source: 'metric' | 'backup' | 'risk' | 'ticket';
  title: string;
  detail: string;
  metric: string;
  value: string | number;
  threshold: string | number;
  occurredAt: string;
  refId?: number;
}

interface VersionItem {
  version: string;
  releasedAt: string;
  owner: string;
  type: string;
  summary: string;
  changes: string[];
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 将 "YYYY-MM-DD HH:mm:ss" 解析为本地时间（与 fmtDateTime 输出保持一致） */
function parseDateTime(value: string): Date {
  const [datePart, timePart = '00:00:00'] = value.split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [hh, mi, ss] = timePart.split(':').map(Number);
  return new Date(y, (mo ?? 1) - 1, d ?? 1, hh ?? 0, mi ?? 0, ss ?? 0);
}

function parseId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'ID 参数无效');
  return id;
}

function mapMetric(m: MetricRow): Record<string, string | number> {
  return {
    metric_time: m.metric_time,
    cpu_usage: Number(m.cpu_usage),
    mem_usage: Number(m.mem_usage),
    disk_usage: Number(m.disk_usage),
    api_qps: Number(m.api_qps),
    api_avg_ms: Number(m.api_avg_ms),
    db_connections: Number(m.db_connections),
    redis_hit_rate: Number(m.redis_hit_rate),
    online_users: Number(m.online_users),
  };
}

/** SLA 附加信息：截止时间、是否逾期、剩余/逾期小时数 */
function ticketExtra(t: Pick<TicketRow, 'created_at' | 'sla_hours' | 'status'>): {
  sla_deadline: string;
  overdue: boolean;
  overdue_hours: number;
  remaining_hours: number;
} {
  const deadlineMs = parseDateTime(t.created_at).getTime() + Number(t.sla_hours) * 3600_000;
  const diffMs = deadlineMs - Date.now();
  const overdue = t.status !== '已关闭' && diffMs < 0;
  return {
    sla_deadline: fmtDateTime(new Date(deadlineMs)),
    overdue,
    overdue_hours: overdue ? Math.max(1, Math.round(-diffMs / 3600_000)) : 0,
    remaining_hours: round1(diffMs / 3600_000),
  };
}

function mapTicket(t: TicketRow): TicketRow & ReturnType<typeof ticketExtra> {
  return { ...t, ...ticketExtra(t) };
}

async function loadTraces(ticketId: number): Promise<TraceRow[]> {
  return query<TraceRow>(
    `SELECT ${TRACE_COLS} FROM ticket_trace WHERE ticket_id = ? ORDER BY created_at ASC, id ASC`,
    [ticketId],
  );
}

/** 写站内通知（全员公告，） */
async function notify(title: string, content: string, level: '信息' | '警告' | '紧急', bizType: string, bizId: number): Promise<void> {
  await execute(
    `INSERT INTO notification (user_id, title, content, level, read_flag, biz_type, biz_id, created_at)
     VALUES (NULL, ?, ?, ?, 0, ?, ?, ?)`,
    [title.slice(0, 128), content.slice(0, 512), level, bizType, bizId, now()],
  );
}

/** 近 7 日可用率：以 cpu<90 且 mem<90 且 api_avg_ms<800 的健康采样占比估算 */
async function loadAvailability(): Promise<{
  rate: number;
  days: number;
  window: string;
  totalSamples: number;
  healthySamples: number;
  daily: Array<{ date: string; rate: number; samples: number }>;
}> {
  const rows = await query<{ d: string; total: number; healthy: string | number | null }>(
    `SELECT DATE_FORMAT(metric_time, '%Y-%m-%d') AS d,
            COUNT(*) AS total,
            SUM(cpu_usage < 90 AND mem_usage < 90 AND api_avg_ms < 800) AS healthy
       FROM ops_metric WHERE metric_time >= ?
      GROUP BY DATE_FORMAT(metric_time, '%Y-%m-%d') ORDER BY d`,
    [startOfDayOffset(6)],
  );
  const daily: Array<{ date: string; rate: number; samples: number }> = [];
  let totalSamples = 0;
  let healthySamples = 0;
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const key = fmtDate(d);
    const hit = rows.find((r) => r.d === key);
    const samples = Number(hit?.total ?? 0);
    const healthy = Number(hit?.healthy ?? 0);
    totalSamples += samples;
    healthySamples += healthy;
    daily.push({ date: key, rate: samples > 0 ? round2((healthy / samples) * 100) : 100, samples });
  }
  return {
    rate: totalSamples > 0 ? round2((healthySamples / totalSamples) * 100) : 0,
    days: 7,
    window: `${daily[0]?.date ?? ''} ~ ${daily[daily.length - 1]?.date ?? ''}`,
    totalSamples,
    healthySamples,
    daily,
  };
}

/** 实时告警：指标阈值 + 备份失败 + 紧急风险事件 + 逾期工单 */
async function computeAlerts(): Promise<AlertItem[]> {
  const alerts: AlertItem[] = [];

  const latest = await queryOne<MetricRow>(`SELECT ${METRIC_COLS} FROM ops_metric ORDER BY metric_time DESC LIMIT 1`);
  if (latest) {
    const occurredAt = latest.metric_time;
    const cpu = Number(latest.cpu_usage);
    if (cpu > THRESHOLDS.cpu_usage) {
      alerts.push({
        id: 'metric-cpu', level: '警告', source: 'metric', title: 'CPU 使用率超过阈值',
        detail: `最新采样 CPU 使用率 ${cpu}%，超过告警阈值 ${THRESHOLDS.cpu_usage}%，请关注计算节点负载与高消耗任务。`,
        metric: 'cpu_usage', value: cpu, threshold: THRESHOLDS.cpu_usage, occurredAt,
      });
    }
    const mem = Number(latest.mem_usage);
    if (mem > THRESHOLDS.mem_usage) {
      alerts.push({
        id: 'metric-mem', level: '警告', source: 'metric', title: '内存使用率超过阈值',
        detail: `最新采样内存使用率 ${mem}%，超过告警阈值 ${THRESHOLDS.mem_usage}%，请检查是否存在内存泄漏或缓存堆积。`,
        metric: 'mem_usage', value: mem, threshold: THRESHOLDS.mem_usage, occurredAt,
      });
    }
    const avgMs = Number(latest.api_avg_ms);
    if (avgMs > THRESHOLDS.api_avg_ms) {
      alerts.push({
        id: 'metric-api', level: '警告', source: 'metric', title: '接口平均响应时间超过阈值',
        detail: `最新采样接口平均响应 ${avgMs} ms，超过告警阈值 ${THRESHOLDS.api_avg_ms} ms，请排查慢查询与下游依赖。`,
        metric: 'api_avg_ms', value: avgMs, threshold: THRESHOLDS.api_avg_ms, occurredAt,
      });
    }
  }

  const failedBackups = await query<BackupRow>(
    `SELECT ${BACKUP_COLS} FROM backup_record WHERE status = '失败' ORDER BY started_at DESC LIMIT 5`,
  );
  for (const b of failedBackups) {
    alerts.push({
      id: `backup-${b.id}`, level: '严重', source: 'backup', title: `数据备份失败：${b.backup_no}`,
      detail: `${b.backup_type}备份（范围：${b.scope}）执行失败，请检查备份存储空间、网络与数据库连接后重新发起备份。`,
      metric: 'backup_status', value: '失败', threshold: '成功',
      occurredAt: b.finished_at ?? b.started_at, refId: b.id,
    });
  }

  const urgentEvents = await query<{
    id: number; event_no: string; event_type: string; level: string; status: string;
    username: string; ip: string | null; detail: string; occurred_at: string;
  }>(
    `SELECT id, event_no, event_type, level, status, username, ip, detail,
            DATE_FORMAT(occurred_at, '%Y-%m-%d %H:%i:%s') AS occurred_at
       FROM risk_event
      WHERE level = '紧急' AND status IN ('待处置', '处置中')
      ORDER BY occurred_at DESC LIMIT 5`,
  );
  for (const e of urgentEvents) {
    alerts.push({
      id: `risk-${e.id}`, level: '严重', source: 'risk', title: `紧急风险事件：${e.event_type}`,
      detail: `事件 ${e.event_no}（${e.status}）由账号 ${e.username}${e.ip ? ` 于 ${e.ip}` : ''} 触发：${String(e.detail).slice(0, 120)}`,
      metric: 'risk_level', value: e.level, threshold: '高',
      occurredAt: e.occurred_at, refId: e.id,
    });
  }

  const overdueTickets = await query<TicketRow>(
    `SELECT ${TICKET_COLS} FROM service_ticket
      WHERE status <> '已关闭' AND DATE_ADD(created_at, INTERVAL sla_hours HOUR) < NOW()
      ORDER BY DATE_ADD(created_at, INTERVAL sla_hours HOUR) ASC LIMIT 8`,
  );
  for (const t of overdueTickets) {
    const extra = ticketExtra(t);
    const deadlineMs = parseDateTime(t.created_at).getTime() + Number(t.sla_hours) * 3600_000;
    const severe = t.priority === '紧急' || t.priority === '高';
    alerts.push({
      id: `ticket-${t.id}`, level: severe ? '严重' : '警告', source: 'ticket',
      title: `工单超过 SLA 未关闭：${t.ticket_no}`,
      detail: `工单「${t.title}」SLA 为 ${t.sla_hours} 小时，当前状态「${t.status}」，已逾期 ${extra.overdue_hours} 小时，请尽快催办。`,
      metric: 'sla_hours', value: extra.overdue_hours, threshold: Number(t.sla_hours),
      occurredAt: fmtDateTime(new Date(deadlineMs)), refId: t.id,
    });
  }

  return alerts.sort((a, b) => {
    const rank = (ALERT_LEVEL_RANK[a.level] ?? 9) - (ALERT_LEVEL_RANK[b.level] ?? 9);
    return rank !== 0 ? rank : b.occurredAt.localeCompare(a.occurredAt);
  });
}

function summarizeAlerts(alerts: AlertItem[]): { total: number; critical: number; warning: number; info: number } {
  return {
    total: alerts.length,
    critical: alerts.filter((a) => a.level === '严重').length,
    warning: alerts.filter((a) => a.level === '警告').length,
    info: alerts.filter((a) => a.level === '信息').length,
  };
}

/** GET /ops/overview 运维总览 */
opsRouter.get('/overview', requirePerm('ops'), async (_req, res) => {
  const latestRow = await queryOne<MetricRow>(`SELECT ${METRIC_COLS} FROM ops_metric ORDER BY metric_time DESC LIMIT 1`);
  const seriesRows = await query<MetricRow>(
    `SELECT ${METRIC_COLS} FROM ops_metric WHERE metric_time >= ? ORDER BY metric_time`,
    [fmtDateTime(new Date(Date.now() - 24 * 3600_000))],
  );
  const availability = await loadAvailability();
  const alerts = await computeAlerts();
  const alertStat = summarizeAlerts(alerts);

  const ticketByStatusRows = await query<{ status: string; c: number | string }>(
    'SELECT status, COUNT(*) AS c FROM service_ticket GROUP BY status',
  );
  const ticketByCategoryRows = await query<{ category: string; c: number | string }>(
    'SELECT category, COUNT(*) AS c FROM service_ticket GROUP BY category',
  );
  const overdueRow = await queryOne<{ c: number | string }>(
    `SELECT COUNT(*) AS c FROM service_ticket
      WHERE status <> '已关闭' AND DATE_ADD(created_at, INTERVAL sla_hours HOUR) < NOW()`,
  );
  const byStatus = TICKET_STATUSES.map((name) => ({
    name,
    value: Number(ticketByStatusRows.find((r) => r.status === name)?.c ?? 0),
  }));
  const byCategory = TICKET_CATEGORIES.map((name) => ({
    name,
    value: Number(ticketByCategoryRows.find((r) => r.category === name)?.c ?? 0),
  }));
  const tickets = {
    total: byStatus.reduce((sum, s) => sum + s.value, 0),
    pending: byStatus.find((s) => s.name === '待受理')?.value ?? 0,
    processing: byStatus.find((s) => s.name === '处理中')?.value ?? 0,
    verifying: byStatus.find((s) => s.name === '待验证')?.value ?? 0,
    closed: byStatus.find((s) => s.name === '已关闭')?.value ?? 0,
    overdue: Number(overdueRow?.c ?? 0),
    byStatus,
    byCategory,
  };

  const backupStatusRows = await query<{ status: string; c: number | string }>(
    'SELECT status, COUNT(*) AS c FROM backup_record GROUP BY status',
  );
  const backupCount = (status: string) => Number(backupStatusRows.find((r) => r.status === status)?.c ?? 0);
  const backupSuccess = backupCount('成功');
  const backupFailed = backupCount('失败');
  const backupRunning = backupCount('进行中');
  const lastBackup = await queryOne<BackupRow>(
    `SELECT ${BACKUP_COLS} FROM backup_record ORDER BY started_at DESC LIMIT 1`,
  );
  const backups = {
    total: backupSuccess + backupFailed + backupRunning,
    success: backupSuccess,
    failed: backupFailed,
    running: backupRunning,
    successRate: backupSuccess + backupFailed > 0 ? round1((backupSuccess / (backupSuccess + backupFailed)) * 100) : 0,
    last: lastBackup,
  };

  const versionRow = await queryOne<{ config_value: string }>(
    "SELECT config_value FROM sys_config WHERE config_key = 'platform.version'",
  );

  ok(res, {
    latest: latestRow ? mapMetric(latestRow) : null,
    series: seriesRows.map(mapMetric),
    availability,
    thresholds: THRESHOLDS,
    alerts: alertStat,
    tickets,
    backups,
    version: versionRow?.config_value ?? null,
    generatedAt: now(),
  });
});

/** GET /ops/metrics?hours=24 时序指标 */
opsRouter.get('/metrics', requirePerm('ops'), async (req, res) => {
  const requested = Math.floor(numOrUndef(req.query.hours) ?? 24);
  const hours = Math.min(Math.max(requested, 1), 168);
  const rows = await query<MetricRow>(
    `SELECT ${METRIC_COLS} FROM ops_metric WHERE metric_time >= ? ORDER BY metric_time`,
    [fmtDateTime(new Date(Date.now() - hours * 3600_000))],
  );
  ok(res, rows.map(mapMetric), { hours, count: rows.length, total: rows.length });
});

/** GET /ops/alerts 实时告警（由指标阈值、备份失败、紧急风险、逾期工单计算） */
opsRouter.get('/alerts', requirePerm('ops'), async (_req, res) => {
  const alerts = await computeAlerts();
  ok(res, alerts, { ...summarizeAlerts(alerts), generatedAt: now() });
});

/** GET /ops/tickets 工单分页列表 */
opsRouter.get('/tickets', requirePerm('ops'), async (req, res) => {
  const p = parsePagination(req.query as Record<string, unknown>);
  const keyword = strOrUndef(req.query.keyword);
  const wb = new WhereBuilder()
    .eq('status', strOrUndef(req.query.status))
    .eq('category', strOrUndef(req.query.category))
    .eq('priority', strOrUndef(req.query.priority));

  let whereSql = wb.where;
  const params: unknown[] = [...wb.params];
  if (keyword) {
    const like = `%${keyword}%`;
    whereSql += whereSql ? ' AND ' : ' WHERE ';
    whereSql += "(ticket_no LIKE ? OR title LIKE ? OR description LIKE ? OR reporter LIKE ? OR IFNULL(assignee, '') LIKE ?)";
    params.push(like, like, like, like, like);
  }

  const totalRow = await queryOne<{ c: number | string }>(`SELECT COUNT(*) AS c FROM service_ticket ${whereSql}`, params);
  const rows = await query<TicketRow>(
    `SELECT ${TICKET_COLS} FROM service_ticket ${whereSql}
      ORDER BY FIELD(status, '待受理', '处理中', '待验证', '已关闭'), created_at DESC
      LIMIT ${p.pageSize} OFFSET ${p.offset}`,
    params,
  );
  const statusRows = await query<{ status: string; c: number | string }>(
    'SELECT status, COUNT(*) AS c FROM service_ticket GROUP BY status',
  );
  ok(res, rows.map(mapTicket), {
    ...pageMeta(Number(totalRow?.c ?? 0), p),
    byStatus: TICKET_STATUSES.map((name) => ({
      name,
      value: Number(statusRows.find((r) => r.status === name)?.c ?? 0),
    })),
  });
});

/** GET /ops/tickets/:id 工单详情 + 流转轨迹 */
opsRouter.get('/tickets/:id', requirePerm('ops'), async (req, res) => {
  const id = parseId(req.params.id);
  const ticket = await queryOne<TicketRow>(`SELECT ${TICKET_COLS} FROM service_ticket WHERE id = ?`, [id]);
  if (!ticket) throw new ApiError(404, '工单不存在');
  const traces = await loadTraces(id);
  ok(res, { ...mapTicket(ticket), traces });
});

const createTicketSchema = z.object({
  title: z.string().trim().min(2, '标题至少 2 个字符').max(128, '标题最多 128 个字符'),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES).default('中'),
  description: z.string().trim().min(5, '问题描述至少 5 个字符').max(1024, '问题描述最多 1024 个字符'),
  contact: z.string().trim().max(32, '联系方式最多 32 个字符').optional(),
  sla_hours: z.coerce.number().int().min(1, 'SLA 至少 1 小时').max(720, 'SLA 最多 720 小时').default(24),
});

/** POST /ops/tickets 建单 */
opsRouter.post('/tickets', requirePerm('ops', 'write'), async (req, res) => {
  const user = currentUser(req);
  const body = createTicketSchema.parse(req.body ?? {});
  const prefix = `TK-${today().replace(/-/g, '')}-`;

  let ticketNo = '';
  let insertId = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const last = await queryOne<{ ticket_no: string }>(
      'SELECT ticket_no FROM service_ticket WHERE ticket_no LIKE ? ORDER BY ticket_no DESC LIMIT 1',
      [`${prefix}%`],
    );
    const parsed = last ? Number.parseInt(last.ticket_no.slice(prefix.length), 10) : 0;
    const seq = Number.isFinite(parsed) && parsed > 0 ? parsed + 1 : 1;
    ticketNo = `${prefix}${String(seq).padStart(3, '0')}`;
    try {
      const result = await execute(
        `INSERT INTO service_ticket
           (ticket_no, title, category, priority, status, reporter, assignee, contact, description, sla_hours, created_at)
         VALUES (?, ?, ?, ?, '待受理', ?, NULL, ?, ?, ?, ?)`,
        [ticketNo, body.title, body.category, body.priority, user.realName,
          body.contact ?? null, body.description, body.sla_hours, now()],
      );
      insertId = result.insertId;
      break;
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY' && attempt < 4) continue;
      throw err;
    }
  }
  if (!insertId) throw new ApiError(500, '工单编号生成失败，请重试');

  await execute(
    `INSERT INTO ticket_trace (ticket_id, action, operator, note, created_at) VALUES (?, '创建', ?, ?, ?)`,
    [insertId, user.realName, `提交工单：${body.description.slice(0, 200)}`, now()],
  );
  await notify(
    '新建运维工单',
    `工单 ${ticketNo}「${body.title}」已创建（优先级：${body.priority}），等待运维工程师受理。`,
    '信息',
    'ticket',
    insertId,
  );

  req.auditAction = `创建运维工单 ${ticketNo}`;
  req.auditDetail = `新建工单「${body.title}」，分类 ${body.category}，优先级 ${body.priority}，SLA ${body.sla_hours} 小时`;

  const row = await queryOne<TicketRow>(`SELECT ${TICKET_COLS} FROM service_ticket WHERE id = ?`, [insertId]);
  if (!row) throw new ApiError(500, '工单创建后读取失败');
  const traces = await loadTraces(insertId);
  ok(res, { ...mapTicket(row), traces });
});

const updateTicketStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
  note: z.string().trim().max(512, '备注最多 512 个字符').optional(),
  assignee: z.string().trim().max(32, '处理人最多 32 个字符').optional(),
});

/** PUT /ops/tickets/:id/status 工单状态流转（校验状态机） */
opsRouter.put('/tickets/:id/status', requirePerm('ops', 'write'), async (req, res) => {
  const id = parseId(req.params.id);
  const body = updateTicketStatusSchema.parse(req.body ?? {});
  const ticket = await queryOne<TicketRow>(`SELECT ${TICKET_COLS} FROM service_ticket WHERE id = ?`, [id]);
  if (!ticket) throw new ApiError(404, '工单不存在');

  const expected = NEXT_STATUS[ticket.status];
  if (!expected) {
    throw new ApiError(400, `工单当前状态为「${ticket.status}」，已关闭的工单不允许再次流转`);
  }
  if (body.status !== expected) {
    throw new ApiError(
      400,
      `工单当前状态为「${ticket.status}」，下一步只能流转到「${expected}」，不允许直接变更为「${body.status}」`,
    );
  }

  const user = currentUser(req);
  const operator = user.realName;
  const assigned = body.status === '处理中'
    ? (body.assignee || ticket.assignee || operator)
    : (body.assignee || ticket.assignee);
  const acceptedAt = body.status === '处理中' ? (ticket.accepted_at ?? now()) : ticket.accepted_at;
  const closedAt = body.status === '已关闭' ? now() : ticket.closed_at;
  const resolution = body.status === '已关闭' ? (body.note || ticket.resolution) : ticket.resolution;
  const note = body.note || `状态由「${ticket.status}」流转为「${body.status}」`;

  await execute(
    'UPDATE service_ticket SET status = ?, assignee = ?, accepted_at = ?, closed_at = ?, resolution = ? WHERE id = ?',
    [body.status, assigned, acceptedAt, closedAt, resolution, id],
  );
  await execute(
    `INSERT INTO ticket_trace (ticket_id, action, operator, note, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, TRACE_ACTION[body.status] ?? '流转', operator, note.slice(0, 512), now()],
  );

  req.auditAction = `运维工单流转 ${ticket.ticket_no}`;
  req.auditDetail = `${ticket.status} → ${body.status}，处理人 ${operator}${body.note ? `，备注：${body.note}` : ''}`;

  const updated = await queryOne<TicketRow>(`SELECT ${TICKET_COLS} FROM service_ticket WHERE id = ?`, [id]);
  if (!updated) throw new ApiError(500, '工单状态更新后读取失败');
  const traces = await loadTraces(id);
  ok(res, { ...mapTicket(updated), traces });
});

/** GET /ops/backups 备份记录分页 */
opsRouter.get('/backups', requirePerm('ops'), async (req, res) => {
  const p = parsePagination(req.query as Record<string, unknown>);
  const wb = new WhereBuilder()
    .eq('backup_type', strOrUndef(req.query.backup_type))
    .eq('status', strOrUndef(req.query.status));
  const totalRow = await queryOne<{ c: number | string }>(`SELECT COUNT(*) AS c FROM backup_record ${wb.where}`, wb.params);
  const rows = await query<BackupRow>(
    `SELECT ${BACKUP_COLS} FROM backup_record ${wb.where}
      ORDER BY started_at DESC LIMIT ${p.pageSize} OFFSET ${p.offset}`,
    wb.params,
  );
  const statusRows = await query<{ status: string; c: number | string }>(
    'SELECT status, COUNT(*) AS c FROM backup_record GROUP BY status',
  );
  const count = (status: string) => Number(statusRows.find((r) => r.status === status)?.c ?? 0);
  const success = count('成功');
  const failed = count('失败');
  const running = count('进行中');
  ok(res, rows, {
    ...pageMeta(Number(totalRow?.c ?? 0), p),
    summary: {
      total: success + failed + running,
      success,
      failed,
      running,
      successRate: success + failed > 0 ? round1((success / (success + failed)) * 100) : 0,
    },
  });
});

const createBackupSchema = z.object({
  backup_type: z.enum(BACKUP_TYPES).default('全量'),
  scope: z.string().trim().max(128, '备份范围最多 128 个字符').optional(),
});

/** POST /ops/backups 立即备份（简化实现：生成成功记录 + SHA-256 校验值） */
opsRouter.post('/backups', requirePerm('ops', 'write'), async (req, res) => {
  const user = currentUser(req);
  const body = createBackupSchema.parse(req.body ?? {});
  const datePart = today().replace(/-/g, '');
  const prefix = `BK-${datePart}-`;
  const last = await queryOne<{ backup_no: string }>(
    'SELECT backup_no FROM backup_record WHERE backup_no LIKE ? ORDER BY backup_no DESC LIMIT 1',
    [`${prefix}%`],
  );
  const parsed = last ? Number.parseInt(last.backup_no.slice(prefix.length), 10) : 0;
  const seq = Number.isFinite(parsed) && parsed > 0 ? parsed + 1 : 1;
  const backupNo = `${prefix}${String(seq).padStart(2, '0')}`;

  const isFull = body.backup_type === '全量';
  const scope = body.scope || (isFull ? '业务库 + 审计库 + 元数据库' : '业务库增量日志');
  const sizeMb = round2((isFull ? 16000 : 600) + randomInt(0, 3000) + Math.random());
  const durationMinutes = isFull ? randomInt(6, 13) : randomInt(2, 8);
  const started = new Date(Date.now() - durationMinutes * 60_000);
  const finished = new Date();
  const storagePath = `/data/backup/${today()}/`;
  const checksum = `sha256:${createHash('sha256')
    .update(`${backupNo}|${sizeMb}|${fmtDateTime(started)}`)
    .digest('hex')
    .slice(0, 32)}`;

  const result = await execute(
    `INSERT INTO backup_record
       (backup_no, backup_type, \`scope\`, size_mb, status, storage_path, checksum, started_at, finished_at, operator)
     VALUES (?, ?, ?, ?, '成功', ?, ?, ?, ?, ?)`,
    [backupNo, body.backup_type, scope, sizeMb, storagePath, checksum,
      fmtDateTime(started), fmtDateTime(finished), user.realName],
  );

  await notify(
    '数据备份完成',
    `备份 ${backupNo}（${body.backup_type}，${sizeMb} MB）已成功完成，存储路径 ${storagePath}，校验值已生成。`,
    '信息',
    'backup',
    result.insertId,
  );

  req.auditAction = `执行数据备份 ${backupNo}`;
  req.auditDetail = `${body.backup_type}备份完成，大小 ${sizeMb} MB，存储 ${storagePath}`;

  const row = await queryOne<BackupRow>(`SELECT ${BACKUP_COLS} FROM backup_record WHERE id = ?`, [result.insertId]);
  if (!row) throw new ApiError(500, '备份记录创建后读取失败');
  ok(res, row);
});

/** GET /ops/configs 平台配置（按分组） */
opsRouter.get('/configs', requirePerm('ops'), async (_req, res) => {
  const rows = await query<ConfigRow>(`SELECT ${CONFIG_COLS} FROM sys_config ORDER BY id`);
  const groups: Array<{ group: string; count: number; items: ConfigRow[] }> = [];
  for (const row of rows) {
    let group = groups.find((g) => g.group === row.config_group);
    if (!group) {
      group = { group: row.config_group, count: 0, items: [] };
      groups.push(group);
    }
    group.items.push(row);
    group.count += 1;
  }
  ok(res, groups, { total: rows.length, groups: groups.length });
});

const updateConfigSchema = z.object({
  value: z.string().trim().min(1, '配置值不能为空').max(512, '配置值最多 512 个字符'),
});

/** PUT /ops/configs/:key 更新配置 */
opsRouter.put('/configs/:key', requirePerm('ops', 'write'), async (req, res) => {
  const key = String(req.params.key ?? '').trim();
  const body = updateConfigSchema.parse(req.body ?? {});
  const existing = await queryOne<ConfigRow>(`SELECT ${CONFIG_COLS} FROM sys_config WHERE config_key = ?`, [key]);
  if (!existing) throw new ApiError(404, `配置项「${key}」不存在`);

  await execute('UPDATE sys_config SET config_value = ?, updated_at = ? WHERE config_key = ?', [body.value, now(), key]);
  req.auditAction = `更新平台配置 ${key}`;
  req.auditDetail = `${key}：${existing.config_value} → ${body.value}`;

  const updated = await queryOne<ConfigRow>(`SELECT ${CONFIG_COLS} FROM sys_config WHERE config_key = ?`, [key]);
  ok(res, updated);
});

/** 静态历史版本清单（） */
const VERSION_HISTORY: VersionItem[] = [
  {
    version: 'V1.0.0-RC',
    releasedAt: '2026-10-28 18:00:00',
    owner: '平台运维组',
    type: '预发布',
    summary: '六大模块联调完成，进入发布候选阶段。',
    changes: [
      '完成资产、合规、风险、权限、审计、运维六大模块接口联调',
      '修复看板缓存穿透问题，Redis 缓存增加降级策略',
      '补充审计日志写操作自动留痕，覆盖全部写接口',
    ],
  },
  {
    version: 'V0.9.5',
    releasedAt: '2026-10-12 20:30:00',
    owner: '安全研发组',
    type: '迭代',
    summary: '安全审计追溯与风险监测能力增强。',
    changes: [
      '新增审计日志 SHA-256 链式完整性校验',
      '风险事件支持同 IP / 同账号关联溯源',
      '合规检查批次支持按规则维度对比',
    ],
  },
  {
    version: 'V0.9.0',
    releasedAt: '2026-09-20 19:00:00',
    owner: '数据治理组',
    type: '迭代',
    summary: '权限体系与数据资产台账能力上线。',
    changes: [
      '实现用户 / 角色 / 菜单 / 接口四级权限模型',
      '数据资产台账支持分类分级与生命周期管理',
      '新增部门数据范围（ALL / DEPT / SELF）过滤',
    ],
  },
  {
    version: 'V0.8.0',
    releasedAt: '2026-09-01 10:00:00',
    owner: '平台基座组',
    type: '基线',
    summary: '平台基座搭建：认证、路由、数据库与容器环境。',
    changes: [
      '搭建 Node.js + Express + MySQL + Redis 服务基座',
      '完成 JWT 登录认证与统一响应包规范',
      '初始化数据库结构与初始种子数据',
    ],
  },
];

/** GET /ops/versions 版本记录（当前版本 + 历史版本 + 变更说明） */
opsRouter.get('/versions', requirePerm('ops'), async (_req, res) => {
  const versionRow = await queryOne<{ config_value: string }>(
    "SELECT config_value FROM sys_config WHERE config_key = 'platform.version'",
  );
  const current: VersionItem & { environment: string; buildNo: string; status: string } = {
    version: versionRow?.config_value ?? 'V1.0.0',
    releasedAt: '2026-11-07 09:00:00',
    owner: '平台运维组',
    type: '正式发布',
    environment: '生产环境',
    buildNo: '20261107.1',
    status: '当前运行',
    summary: '服务保障运维模块上线：运行监控大屏、工单闭环、备份管理与平台配置中心。',
    changes: [
      '新增服务保障运维模块：运行监控、告警、工单、备份、配置、版本六个能力',
      '新增 7×24 小时指标采集与阈值告警实时计算（CPU / 内存 / 接口响应 / 备份 / 风险 / 工单）',
      '新增工单 SLA 管理与「待受理→处理中→待验证→已关闭」状态机留痕',
      '新增平台配置分组维护与版本变更说明',
    ],
  };
  ok(res, { current, history: VERSION_HISTORY, total: VERSION_HISTORY.length, generatedAt: now() });
});
