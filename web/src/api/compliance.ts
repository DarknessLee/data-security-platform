import { http } from '@/api/client';

/** 通用名称-数值结构（图表 / 统计卡片） */
export interface NameValue {
  name: string;
  value: number;
}

/** 合规规则（GET /compliance/rules） */
export interface ComplianceRule {
  id: number;
  rule_code: string;
  rule_title: string;
  basis: string;
  category: string;
  requirement: string;
  risk_level: string;
  check_method: string;
  status: string;
  created_at: string;
  last_result: string | null;
  last_checked_at: string | null;
}

export interface RuleFilters {
  bases: string[];
  categories: string[];
  riskLevels: string[];
  statuses: string[];
}

export interface RulePayload {
  rule_code?: string;
  rule_title: string;
  basis: string;
  category: string;
  requirement: string;
  risk_level?: string;
  check_method?: string;
  status?: string;
}

/** 检查批次统计（GET /compliance/batches，契约字段为 snake_case） */
export interface BatchStat {
  batch_no: string;
  checked_at: string | null;
  total: number;
  passed: number;
  warning: number;
  failed: number;
  rate: number;
}

/** 检查结果（GET /compliance/checks） */
export interface ComplianceCheck {
  id: number;
  rule_id: number;
  batch_no: string;
  target: string;
  result: string;
  score: number;
  evidence: string;
  duration_ms: number;
  checked_at: string;
  rule_code: string;
  rule_title: string;
  basis: string;
  category: string;
  risk_level: string;
}

export interface CheckRuleInfo {
  id: number;
  rule_code: string;
  rule_title: string;
  basis: string;
  category: string;
  requirement: string;
  risk_level: string;
  check_method: string;
  status: string;
}

export interface CheckSibling {
  id: number;
  rule_code: string;
  rule_title: string;
  result: string;
  score: number;
}

export interface CheckDetail {
  check: ComplianceCheck;
  rule: CheckRuleInfo;
  batch: BatchStat | null;
  sameBatch: CheckSibling[];
}

export interface RunChecksResult {
  batchNo: string;
  total: number;
  passed: number;
  warning: number;
  failed: number;
  rate: number;
  rectifyCreated: number;
  durationMs: number;
  checkedAt: string;
}

/** 整改跟踪（GET /compliance/rectify） */
export interface RectifyRow {
  id: number;
  rectify_no: string;
  check_id: number;
  title: string;
  owner: string;
  dept_id: number;
  dept_name: string | null;
  due_date: string | null;
  status: string;
  progress: number;
  measure: string | null;
  closed_at: string | null;
  created_at: string;
  batch_no: string | null;
  rule_code: string | null;
  rule_title: string | null;
  risk_level: string | null;
  category: string | null;
  overdue: boolean;
}

/** 脱敏规则（GET /compliance/masking） */
export interface MaskingRule {
  id: number;
  rule_name: string;
  field_pattern: string;
  algorithm: string;
  mask_type: string;
  scene: string;
  status: string;
  sample_before: string;
  sample_after: string;
  updated_at: string;
}

export interface MaskingTestResult {
  before: string;
  after: string;
  algorithm: string;
  maskType: string;
  ruleId: number;
  ruleName: string;
}

/** 共享审批（GET /compliance/approvals） */
export interface ApprovalRow {
  id: number;
  approval_no: string;
  asset_id: number;
  applicant_id: number;
  applicant_name: string;
  applicant_dept: string | null;
  asset_name: string | null;
  asset_code: string | null;
  asset_level: string | null;
  receiver: string;
  purpose: string;
  share_way: string;
  risk_level: string;
  status: string;
  approver: string | null;
  approved_at: string | null;
  comment: string | null;
  created_at: string;
}

export interface AssetOption {
  id: number;
  asset_name: string;
  asset_code: string;
  data_level: string;
}

export interface ApprovalPayload {
  asset_id: number;
  receiver: string;
  purpose: string;
  share_way: string;
  risk_level?: string;
}

/** 概览卡片（GET /compliance/overview） */
export interface ComplianceCards {
  ruleTotal: number;
  ruleEnabled: number;
  checkTotal: number;
  latestBatchNo: string | null;
  latestRate: number;
  rectifyTotal: number;
  rectifyOpen: number;
  rectifyClosed: number;
  rectifyOverdue: number;
  closeRate: number;
  pendingApprovals: number;
  maskingTotal: number;
  maskingEnabled: number;
}

export interface ComplianceOverview {
  cards: ComplianceCards;
  categoryDist: NameValue[];
  levelDist: NameValue[];
  rectifyDist: NameValue[];
  batches: BatchStat[];
  generatedAt: string;
}

export interface ReportCards {
  ruleTotal: number;
  ruleEnabled: number;
  checkBatches: number;
  rectifyTotal: number;
  rectifyOpen: number;
  rectifyClosed: number;
  rectifyOverdue: number;
  closeRate: number;
  pendingApprovals: number;
  maskingTotal: number;
  maskingEnabled: number;
}

export interface ReportSummary extends BatchStat {
  cards: ReportCards;
}

export interface ReportGroup {
  name: string;
  total: number;
  passed: number;
  warning: number;
  failed: number;
  rate: number;
}

export interface ComplianceReport {
  batchNo: string;
  generatedAt: string;
  summary: ReportSummary;
  byCategory: ReportGroup[];
  byBasis: ReportGroup[];
  fails: ComplianceCheck[];
  rectify: RectifyRow[];
}

// ============ 接口封装 ============

export function getOverview() {
  return http.get<ComplianceOverview>('/compliance/overview');
}

export function getRules(params: Record<string, unknown>) {
  return http.get<ComplianceRule[]>('/compliance/rules', params);
}

export function createRule(payload: RulePayload) {
  return http.post<ComplianceRule>('/compliance/rules', payload);
}

export function updateRule(id: number, payload: Partial<RulePayload>) {
  return http.put<ComplianceRule>(`/compliance/rules/${id}`, payload);
}

export function getBatches() {
  return http.get<BatchStat[]>('/compliance/batches');
}

export function getChecks(params: Record<string, unknown>) {
  return http.get<ComplianceCheck[]>('/compliance/checks', params);
}

export function getCheckDetail(id: number) {
  return http.get<CheckDetail>(`/compliance/checks/${id}`);
}

export function runChecks() {
  return http.post<RunChecksResult>('/compliance/checks/run');
}

export function getRectifyList(params: Record<string, unknown>) {
  return http.get<RectifyRow[]>('/compliance/rectify', params);
}

export function updateRectify(id: number, payload: { status?: string; progress?: number; measure?: string }) {
  return http.put<RectifyRow>(`/compliance/rectify/${id}`, payload);
}

export function getMaskingRules(params: Record<string, unknown>) {
  return http.get<MaskingRule[]>('/compliance/masking', params);
}

export function testMasking(id: number, sample: string) {
  return http.post<MaskingTestResult>(`/compliance/masking/${id}/test`, { sample });
}

export function updateMasking(
  id: number,
  payload: { status?: string; algorithm?: string; mask_type?: string; scene?: string; field_pattern?: string },
) {
  return http.put<MaskingRule>(`/compliance/masking/${id}`, payload);
}

export function getApprovals(params: Record<string, unknown>) {
  return http.get<ApprovalRow[]>('/compliance/approvals', params);
}

export function getApprovalAssets() {
  return http.get<AssetOption[]>('/compliance/approvals/assets');
}

export function createApproval(payload: ApprovalPayload) {
  return http.post<{ approval: ApprovalRow; notified: number }>('/compliance/approvals', payload);
}

export function approveApproval(id: number, payload: { approved: boolean; comment?: string }) {
  return http.put<ApprovalRow>(`/compliance/approvals/${id}/approve`, payload);
}

export function getReport(batchNo?: string) {
  return http.get<ComplianceReport>('/compliance/report', batchNo ? { batchNo } : undefined);
}
