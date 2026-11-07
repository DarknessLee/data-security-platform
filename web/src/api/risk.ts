import { http } from '@/api/client';

/* ============================ 通用类型 ============================ */

export interface NameValue {
  name: string;
  value: number;
}

export interface RiskEventRow {
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
  occurred_at: string;
  handled_by: string | null;
  handled_at: string | null;
  handle_note: string | null;
  created_at: string;
  asset_name: string | null;
  asset_code: string | null;
  asset_level: string | null;
  rule_name: string | null;
  rule_code: string | null;
  dept_name: string | null;
}

export interface RiskEventDetail extends RiskEventRow {
  related: RiskEventRow[];
  asset: RiskAsset | null;
}

export interface RiskAsset {
  id: number;
  asset_code: string;
  asset_name: string;
  category_id: number;
  dept_id: number;
  source_system: string;
  data_type: string;
  data_level: string;
  file_format: string | null;
  size_gb: number;
  row_count: number;
  owner: string;
  status: string;
  lifecycle_stage: string;
  sensitivity_score: number;
  quality_score: number;
  description: string | null;
  last_access_at: string | null;
  category_name: string | null;
  dept_name: string | null;
}

export interface RiskRule {
  id: number;
  rule_code: string;
  rule_name: string;
  event_type: string;
  expression: string;
  level: string;
  enabled: boolean;
  hit_count: number;
  updated_at: string;
}

export interface RiskOverview {
  cards: {
    pending: number;
    handling: number;
    urgent: number;
    todayEvents: number;
    totalEvents: number;
    handledEvents: number;
    handledRate: number;
  };
  levelDist: NameValue[];
  ruleTop5: Array<{
    id: number;
    rule_code: string;
    rule_name: string;
    event_type: string;
    level: string;
    enabled: boolean;
    hit_count: number;
    hits: number;
  }>;
  hourlyTrend: Array<{ time: string; total: number; low: number; mid: number; high: number; urgent: number }>;
  typeDist: NameValue[];
  generatedAt: string;
}

export interface RiskTrendPoint {
  date: string;
  low: number;
  mid: number;
  high: number;
  urgent: number;
  total: number;
}

export interface RiskTrace {
  event: RiskEventRow;
  account: {
    id: number;
    username: string;
    real_name: string;
    status: number;
    dept_id: number | null;
    dept_name: string | null;
    job_title: string | null;
    email: string | null;
    phone: string | null;
    last_login_at: string | null;
    last_login_ip: string | null;
    roles: Array<{ role_code: string; role_name: string }>;
  } | null;
  asset: RiskAsset | null;
  auditLogs: Array<{
    id: number;
    log_type: string;
    username: string;
    action: string;
    resource: string | null;
    method: string | null;
    path: string | null;
    ip: string | null;
    status_code: number;
    result: string;
    detail: string | null;
    created_at: string;
  }>;
  sameIp: Array<RiskEventRow & { match_type: string }>;
  generatedAt: string;
}

export interface RiskRealtime {
  latest: RiskEventRow[];
  perMinute: Array<{ minute: string; count: number }>;
  topIps: Array<{ ip: string; hits: number; urgent: number; users: number; last_at: string | null }>;
  levelCounts: Array<{ level: string; count: number }>;
  generatedAt: string;
}

export interface EventQuery {
  page?: number;
  pageSize?: number;
  level?: string;
  status?: string;
  eventType?: string;
  keyword?: string;
  start?: string;
  end?: string;
}

export interface RuleQuery {
  keyword?: string;
  eventType?: string;
  enabled?: 0 | 1;
}

/* ============================ 接口封装 ============================ */

/** 风险监测概览：待处置/紧急数、今日事件、规则命中 TOP5、24 小时趋势、事件类型分布 */
export function getOverview() {
  return http.get<RiskOverview>('/risk/overview');
}

/** 监测规则列表 */
export function getRules(params: RuleQuery = {}) {
  return http.get<RiskRule[]>('/risk/rules', { ...params });
}

/** 启停监测规则 */
export function toggleRule(id: number, enabled: boolean) {
  return http.put<RiskRule>(`/risk/rules/${id}/toggle`, { enabled });
}

/** 风险事件分页列表（级别/状态/类型/关键词/时间范围筛选） */
export function getEvents(params: EventQuery = {}) {
  return http.get<RiskEventRow[]>('/risk/events', { ...params });
}

/** 风险事件详情（含同 IP/同账号关联事件与关联资产） */
export function getEventDetail(id: number) {
  return http.get<RiskEventDetail>(`/risk/events/${id}`);
}

/** 处置风险事件：status 处置中/已处置 */
export function handleEvent(id: number, payload: { status: '处置中' | '已处置'; note?: string }) {
  return http.post<RiskEventRow>(`/risk/events/${id}/handle`, payload);
}

/** 忽略风险事件 */
export function ignoreEvent(id: number, payload: { note?: string } = {}) {
  return http.post<RiskEventRow>(`/risk/events/${id}/ignore`, payload);
}

/** 溯源链路：事件 → 账号 → 资产 → 审计日志 → 同 IP 事件 */
export function getTrace(eventId: number) {
  return http.get<RiskTrace>('/risk/trace', { eventId });
}

/** 风险趋势（按日分级统计） */
export function getTrend(days = 7) {
  return http.get<RiskTrendPoint[]>('/risk/trend', { days });
}

/** 实时监控：最新事件 + 每分钟计数 + 重点 IP TOP5 + 级别计数 */
export function getRealtime() {
  return http.get<RiskRealtime>('/risk/realtime');
}
