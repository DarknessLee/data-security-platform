import { http } from '@/api/client';

/* ============================ 通用类型 ============================ */

export interface NameValue {
  name: string;
  value: number;
}

/** 数据资产台账行（列表与详情共用基础字段） */
export interface AssetRow {
  id: number;
  asset_code: string;
  asset_name: string;
  category_id: number;
  category_name: string | null;
  category_code?: string | null;
  dept_id: number;
  dept_name: string | null;
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
  discovered_at: string | null;
  last_access_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  tags: string[];
}

/** 生命周期记录 */
export interface AssetLifecycleItem {
  id: number;
  asset_id: number;
  stage: string;
  action: string;
  operator: string;
  detail: string | null;
  occurred_at: string | null;
}

/** 资产详情：基础字段 + 标签 + 生命周期 + 关联风险/检查计数 */
export interface AssetDetail extends AssetRow {
  lifecycle: AssetLifecycleItem[];
  riskCount: number;
  checkCount: number;
  shareCount: number;
}

/** 资产治理统计 */
export interface AssetStats {
  total: number;
  sensitive: number;
  sensitiveRate: number;
  avgQualityScore: number;
  avgSensitivityScore: number;
  totalSizeGb: number;
  totalRows: number;
  levelDistribution: NameValue[];
  statusDistribution: NameValue[];
  stageDistribution: NameValue[];
  categoryTop: Array<{
    category_id: number;
    category_name: string;
    count: number;
    size_gb: number;
  }>;
  sourceSystem: NameValue[];
}

/** 分类树节点 */
export interface AssetCategoryNode {
  id: number;
  category_code: string;
  category_name: string;
  parent_id: number;
  description: string | null;
  sort: number;
  assetCount: number;
  levelCounts: Record<string, number>;
  children: AssetCategoryNode[];
}

export interface AssetCategoryResult {
  tree: AssetCategoryNode[];
  levelTotals: NameValue[];
  categoryCount: number;
  total: number;
}

export interface AssetTagItem {
  tag_name: string;
  count: number;
}

export interface AssetQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  level?: string;
  status?: string;
  categoryId?: number;
  deptId?: number;
  stage?: string;
  sort?: string;
}

/** 新建/更新资产入参 */
export interface AssetPayload {
  asset_name?: string;
  category_id?: number;
  dept_id?: number;
  source_system?: string;
  data_type?: string;
  data_level?: string;
  owner?: string;
  file_format?: string;
  size_gb?: number;
  row_count?: number;
  status?: string;
  lifecycle_stage?: string;
  sensitivity_score?: number;
  quality_score?: number;
  description?: string;
  tags?: string[];
}

/** 扫描复核发现项 */
export interface ScanFinding {
  type: string;
  level: '高' | '中' | '低';
  message: string;
}

export interface AssetScanResult {
  id: number;
  asset_code: string;
  old_score: number;
  sensitivity_score: number;
  findings: ScanFinding[];
  scannedAt: string;
  operator: string;
}

export interface GlobalScanResult {
  taskId: string;
  scanned: number;
  newAssets: number;
  changed: number;
  durationMs: number;
  sourceSystems: number;
  operator: string;
  scannedAt: string;
}

export interface LevelUpdateResult {
  id: number;
  asset_code: string;
  old_level: string;
  data_level: string;
  sensitivity_score: number;
  reason: string;
  updated_at: string;
}

export interface DeptOption {
  id: number;
  dept_name: string;
}

/* ============================ 接口封装 ============================ */

/** 资产治理总览：总量、敏感资产、分级/状态/阶段分布、分类 TOP、来源系统分布 */
export function getAssetStats() {
  return http.get<AssetStats>('/assets/stats');
}

/** 分类树（含每类资产数与分级数量） */
export function getAssetCategories() {
  return http.get<AssetCategoryResult>('/assets/categories');
}

/** 资产台账分页列表（关键词/级别/状态/分类/部门/阶段筛选，sort 支持 - 前缀倒序） */
export function getAssets(params: AssetQuery = {}) {
  return http.get<AssetRow[]>('/assets', { ...params });
}

/** 资产详情：标签、生命周期、关联风险与合规检查计数 */
export function getAssetDetail(id: number) {
  return http.get<AssetDetail>(`/assets/${id}`);
}

/** 标签云 */
export function getAssetTags() {
  return http.get<AssetTagItem[]>('/assets/tags');
}

/** 资产生命周期记录（按发生时间倒序） */
export function getAssetLifecycle(id: number) {
  return http.get<AssetLifecycleItem[]>(`/assets/${id}/lifecycle`);
}

/** 登记资产（自动生成资产编号并写入采集生命周期） */
export function createAsset(payload: AssetPayload) {
  return http.post<AssetDetail>('/assets', payload);
}

/** 更新资产（数据级别变更时自动追加生命周期记录） */
export function updateAsset(id: number, payload: AssetPayload) {
  return http.put<AssetDetail>(`/assets/${id}`, payload);
}

/** 数据分级调整（含调整原因，写入生命周期留痕） */
export function updateAssetLevel(id: number, payload: { data_level: string; reason: string }) {
  return http.put<LevelUpdateResult>(`/assets/${id}/level`, payload);
}

/** 单资产敏感度扫描复核，返回复核意见 */
export function scanAsset(id: number) {
  return http.post<AssetScanResult>(`/assets/${id}/scan`);
}

/** 全局敏感度扫描（简化实现：统计扫描范围与评分建议变更数） */
export function scanAllAssets() {
  return http.post<GlobalScanResult>('/assets/scan');
}

/** 负责部门下拉（复用 RBAC 部门接口，仅写表单打开时调用） */
export function getDeptOptions() {
  return http.get<{ list: DeptOption[]; total: number }>('/rbac/depts');
}

/** 按当前筛选条件导出 CSV 台账 */
export function exportAssets(params: AssetQuery = {}): Promise<void> {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return http.download('/assets/export', {
    keyword: params.keyword,
    level: params.level,
    status: params.status,
    categoryId: params.categoryId,
    deptId: params.deptId,
    stage: params.stage,
    sort: params.sort,
  }, `数据资产台账_${date}.csv`);
}
