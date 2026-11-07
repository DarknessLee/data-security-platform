import { http } from '@/api/client';

/** 运维指标采样点（ops_metric） */
export interface OpsMetric {
  metric_time: string;
  cpu_usage: number;
  mem_usage: number;
  disk_usage: number;
  api_qps: number;
  api_avg_ms: number;
  db_connections: number;
  redis_hit_rate: number;
  online_users: number;
}

/** 告警项（由指标阈值 / 备份失败 / 紧急风险 / 逾期工单实时计算） */
export interface OpsAlert {
  id: string;
  level: '严重' | '警告' | string;
  source: 'metric' | 'backup' | 'risk' | 'ticket' | string;
  title: string;
  detail: string;
  metric: string;
  value: string | number;
  threshold: string | number;
  occurredAt: string;
  refId: number | null;
}

export interface AvailabilityDay {
  date: string;
  rate: number;
  samples: number;
}

export interface OpsAvailability {
  rate: number;
  days: number;
  window: string;
  totalSamples: number;
  healthySamples: number;
  daily: AvailabilityDay[];
}

export interface TicketStatGroup {
  name: string;
  value: number;
}

export interface OpsTicketStats {
  total: number;
  pending: number;
  processing: number;
  verifying: number;
  closed: number;
  overdue: number;
  byStatus: TicketStatGroup[];
  byCategory: TicketStatGroup[];
}

export interface OpsBackupStats {
  total: number;
  success: number;
  failed: number;
  running: number;
  successRate: number;
  last: BackupRow | null;
}

export interface OpsAlertSummary {
  total: number;
  critical: number;
  warning: number;
  info?: number;
}

export interface OpsOverview {
  latest: OpsMetric | null;
  series: OpsMetric[];
  availability: OpsAvailability;
  thresholds: { cpu_usage: number; mem_usage: number; api_avg_ms: number };
  alerts: OpsAlertSummary;
  tickets: OpsTicketStats;
  backups: OpsBackupStats;
  version: string | null;
  generatedAt: string;
}

export interface TicketTrace {
  id: number;
  ticket_id: number;
  action: string;
  operator: string;
  note: string | null;
  created_at: string;
}

export interface TicketRow {
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
  sla_deadline: string;
  overdue: boolean;
  overdue_hours: number;
  remaining_hours: number;
}

export type TicketDetail = TicketRow & { traces: TicketTrace[] };

export interface TicketQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  category?: string;
  priority?: string;
  keyword?: string;
}

export interface CreateTicketPayload {
  title: string;
  category: string;
  priority: string;
  description: string;
  contact?: string;
  sla_hours?: number;
}

export interface TicketStatusPayload {
  status: string;
  note?: string;
  assignee?: string;
  resolution?: string;
}

export interface BackupRow {
  id: number;
  backup_no: string;
  backup_type: string;
  scope: string;
  size_mb: string | number;
  status: string;
  storage_path: string;
  checksum: string;
  started_at: string;
  finished_at: string | null;
  operator: string;
}

export interface BackupQuery {
  page?: number;
  pageSize?: number;
  backup_type?: string;
  status?: string;
}

export interface BackupSummary {
  total: number;
  success: number;
  failed: number;
  running: number;
  successRate: number;
}

export interface ConfigItem {
  config_key: string;
  config_value: string;
  config_group: string;
  description: string;
  updated_at: string;
}

export interface ConfigGroup {
  group: string;
  count: number;
  items: ConfigItem[];
}

export interface VersionItem {
  version: string;
  releasedAt: string;
  owner: string;
  type: string;
  environment?: string;
  buildNo?: string;
  status?: string;
  summary: string;
  changes: string[];
}

export interface VersionsPayload {
  current: VersionItem;
  history: VersionItem[];
}

export function getOpsOverview() {
  return http.get<OpsOverview>('/ops/overview');
}

export function getOpsMetrics(hours = 24) {
  return http.get<OpsMetric[]>('/ops/metrics', { hours });
}

export function getOpsAlerts() {
  return http.get<OpsAlert[]>('/ops/alerts');
}

export function getTickets(params: TicketQuery) {
  return http.get<TicketRow[]>('/ops/tickets', { ...params });
}

export function getTicket(id: number) {
  return http.get<TicketDetail>(`/ops/tickets/${id}`);
}

export function createTicket(payload: CreateTicketPayload) {
  return http.post<TicketDetail>('/ops/tickets', payload);
}

export function updateTicketStatus(id: number, payload: TicketStatusPayload) {
  return http.put<TicketDetail>(`/ops/tickets/${id}/status`, payload);
}

export function getBackups(params: BackupQuery) {
  return http.get<BackupRow[]>('/ops/backups', { ...params });
}

export function createBackup(payload: { backup_type?: string; scope?: string; operator?: string }) {
  return http.post<BackupRow>('/ops/backups', payload);
}

export function getConfigs() {
  return http.get<ConfigGroup[]>('/ops/configs');
}

export function updateConfig(key: string, value: string) {
  return http.put<ConfigItem>(`/ops/configs/${encodeURIComponent(key)}`, { value });
}

export function getVersions() {
  return http.get<VersionsPayload>('/ops/versions');
}
