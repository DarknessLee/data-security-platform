import { http } from '@/api/client';

export interface NameValue {
  name: string;
  value: number;
}

export interface AuditOverviewCards {
  todayLogs: number;
  todayFail: number;
  failRate: number;
  totalLogs: number;
  activeUsers: number;
  reportCount: number;
}

export interface AuditTrendPoint {
  date: string;
  total: number;
  fail: number;
}

export interface AuditTopUser {
  username: string;
  count: number;
}

export interface AuditTopIp {
  ip: string | null;
  total: number;
  fail: number;
}

export interface AuditOverview {
  cards: AuditOverviewCards;
  logTypeDist: NameValue[];
  resultDist: NameValue[];
  trend: AuditTrendPoint[];
  topUsers: AuditTopUser[];
  topIps: AuditTopIp[];
  generatedAt: string;
}

export interface AuditLogRow {
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

export interface AuditLogDetail {
  record: AuditLogRow;
  hash: string;
  prevHash: string;
  verified: boolean;
}

export interface IntegrityBroken {
  id: number;
  reason: string;
}

export interface AuditIntegrity {
  total: number;
  verifiedAt: string;
  chainValid: boolean;
  checked: number;
  broken: IntegrityBroken[];
  headHash: string;
  algorithm: string;
}

export type AuditReportType = '日报' | '周报' | '月报' | '年报';

export interface AuditReportRow {
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

export interface AuditReportBreakdown {
  logTypes: NameValue[];
  results: NameValue[];
  riskLevels: NameValue[];
  compliance: {
    total: number;
    passed: number;
    warning: number;
    failed: number;
  };
}

export interface AuditReportDetail {
  record: AuditReportRow;
  breakdown: AuditReportBreakdown;
}

export interface AuditLogQuery {
  page?: number;
  pageSize?: number;
  logType?: string;
  result?: string;
  keyword?: string;
  start?: string;
  end?: string;
}

export interface AuditReportQuery {
  page?: number;
  pageSize?: number;
  reportType?: string;
}

export function getAuditOverview() {
  return http.get<AuditOverview>('/audit/overview');
}

export function getAuditLogs(params: AuditLogQuery) {
  return http.get<AuditLogRow[]>('/audit/logs', { ...params });
}

export function getAuditLogDetail(id: number) {
  return http.get<AuditLogDetail>(`/audit/logs/${id}`);
}

export function getAuditIntegrity() {
  return http.get<AuditIntegrity>('/audit/integrity');
}

export function exportAuditLogs(params: AuditLogQuery, filename: string) {
  return http.download('/audit/export', { ...params }, filename);
}

export function getAuditReports(params: AuditReportQuery) {
  return http.get<AuditReportRow[]>('/audit/reports', { ...params });
}

export function createAuditReport(reportType: AuditReportType) {
  return http.post<AuditReportRow>('/audit/reports', { reportType });
}

export function getAuditReportDetail(id: number) {
  return http.get<AuditReportDetail>(`/audit/reports/${id}`);
}
