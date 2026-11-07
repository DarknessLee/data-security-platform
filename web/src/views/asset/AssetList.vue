<template>
  <section class="page asset-list">
    <PageHeader title="资产台账" subtitle="数据资产分类分级台账 · 全生命周期纳管与敏感度治理">
      <el-button :loading="loading" icon="Refresh" @click="loadAll">刷新</el-button>
      <el-button v-if="auth.canWrite('asset')" :loading="scanningAll" icon="Aim" @click="runGlobalScan">全局扫描</el-button>
      <el-button v-if="auth.canWrite('asset')" type="primary" icon="Plus" data-testid="asset-create" @click="openCreate">登记资产</el-button>
      <el-button :loading="exporting" icon="Download" @click="exportCsv">导出台账</el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="资产总量" :value="stats?.total ?? 0" unit="项" icon="Coin" :hint="`覆盖 ${stats?.sourceSystem.length ?? 0} 个来源系统`" />
      <StatCard label="敏感数据资产" :value="stats?.sensitive ?? 0" unit="项" tone="danger" icon="Lock" :hint="`机密/绝密占比 ${fmtPercent(stats?.sensitiveRate ?? 0)}`" />
      <StatCard label="平均质量分" :value="stats?.avgQualityScore ?? 0" unit="分" tone="success" icon="CircleCheck" hint="质量分均值（满分 100）" />
      <StatCard label="平均敏感度" :value="stats?.avgSensitivityScore ?? 0" unit="分" tone="warning" icon="Warning" hint="分级基线 + 规模/标签/活跃度修正" />
      <StatCard label="存储规模" :value="fmtSizeGb(stats?.totalSizeGb)" tone="info" icon="Files" :hint="`记录总量 ${fmtWan(stats?.totalRows)} 条`" />
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" :model="query" @submit.prevent>
        <el-form-item label="关键词">
          <el-input v-model="query.keyword" clearable placeholder="资产名称/编号" style="width: 200px" data-testid="asset-keyword" @keyup.enter="reload" />
        </el-form-item>
        <el-form-item label="数据级别">
          <el-select v-model="query.level" clearable placeholder="全部级别" style="width: 120px">
            <el-option v-for="l in LEVELS" :key="l" :label="l" :value="l" />
          </el-select>
        </el-form-item>
        <el-form-item label="资产状态">
          <el-select v-model="query.status" clearable placeholder="全部状态" style="width: 120px">
            <el-option v-for="s in STATUSES" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="所属分类">
          <el-select v-model="query.categoryId" clearable placeholder="全部分类" style="width: 150px">
            <el-option v-for="c in flatCategories" :key="c.id" :label="c.label" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="责任部门">
          <el-select v-model="query.deptId" clearable placeholder="全部部门" style="width: 140px">
            <el-option v-for="d in depts" :key="d.id" :label="d.dept_name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="生命周期">
          <el-select v-model="query.stage" clearable placeholder="全部阶段" style="width: 120px">
            <el-option v-for="s in STAGES" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序">
          <el-select v-model="query.sort" placeholder="默认排序" style="width: 140px">
            <el-option v-for="s in SORTS" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" icon="Search" @click="reload">查询</el-button>
          <el-button icon="RefreshLeft" @click="resetQuery">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="content-card">
      <template #header>
        <div class="section-title">
          <span>资产列表</span>
          <span class="sub" data-testid="asset-total">
            共 {{ total }} 条 · 数据范围：{{ scopeText }} · 点击行查看详情
          </span>
        </div>
      </template>

      <el-table
        v-loading="loading"
        :data="rows"
        stripe
        row-key="id"
        data-testid="asset-table"
        @row-click="openDetail"
      >
        <el-table-column label="资产编号 / 名称" min-width="230">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.asset_name }}</span>
              <span class="sub mono">{{ row.asset_code }} · {{ row.source_system }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="所属分类 / 部门" min-width="170">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.category_name ?? '-' }}</span>
              <span class="sub">{{ row.dept_name ?? '-' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="数据级别" width="90">
          <template #default="{ row }"><StatusTag :value="row.data_level" /></template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><StatusTag :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="敏感度" width="105" align="center">
          <template #default="{ row }">
            <span class="score" :class="scoreClass(row.sensitivity_score)">{{ row.sensitivity_score }}</span>
            <el-progress
              :percentage="row.sensitivity_score"
              :stroke-width="5"
              :show-text="false"
              :color="scoreColor(row.sensitivity_score)"
              class="score-bar"
            />
          </template>
        </el-table-column>
        <el-table-column label="存储 / 记录数" width="140">
          <template #default="{ row }">
            <div class="cell-main">
              <span>{{ fmtSizeGb(row.size_gb) }}</span>
              <span class="sub">{{ fmtWan(row.row_count) }} 条</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="owner" label="责任人" width="100" />
        <el-table-column label="最近访问" width="165">
          <template #default="{ row }">
            <span class="muted">{{ fmtDateTime(row.last_access_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="openDetail(row)">详情</el-button>
            <template v-if="auth.canWrite('asset')">
              <el-button link type="success" @click.stop="openEdit(row)">编辑</el-button>
              <el-button link type="warning" @click.stop="openLevel(row)">分级调整</el-button>
              <el-button link type="info" :loading="scanningId === row.id" @click.stop="runScan(row)">扫描复核</el-button>
            </template>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState description="暂无符合条件的资产" />
        </template>
      </el-table>

      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="loadRows"
        @size-change="reload"
      />
    </el-card>

    <!-- 资产详情 -->
    <DetailDrawer v-model="detailDrawer" :title="detail ? `资产详情 · ${detail.asset_code}` : '资产详情'" width="760px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <div class="flex flex-wrap">
            <StatusTag :value="detail.data_level" />
            <StatusTag :value="detail.status" />
            <el-tag size="small" effect="plain">{{ detail.data_type }}</el-tag>
            <el-tag size="small" effect="plain">{{ detail.lifecycle_stage }}阶段</el-tag>
            <span class="muted">最近访问 {{ fmtDateTime(detail.last_access_at) }}</span>
          </div>

          <div class="detail-grid mt-12">
            <div class="detail-item"><span class="k">资产编号</span><span class="v mono">{{ detail.asset_code }}</span></div>
            <div class="detail-item"><span class="k">资产名称</span><span class="v">{{ detail.asset_name }}</span></div>
            <div class="detail-item"><span class="k">所属分类</span><span class="v">{{ detail.category_name ?? '-' }}（{{ detail.category_code ?? '-' }}）</span></div>
            <div class="detail-item"><span class="k">责任部门</span><span class="v">{{ detail.dept_name ?? '-' }}</span></div>
            <div class="detail-item"><span class="k">来源系统</span><span class="v">{{ detail.source_system }}</span></div>
            <div class="detail-item"><span class="k">文件格式</span><span class="v">{{ detail.file_format ?? '-' }}</span></div>
            <div class="detail-item"><span class="k">存储大小</span><span class="v">{{ fmtSizeGb(detail.size_gb) }}</span></div>
            <div class="detail-item"><span class="k">记录数</span><span class="v">{{ fmtNumber(detail.row_count) }} 条</span></div>
            <div class="detail-item"><span class="k">数据责任人</span><span class="v">{{ detail.owner }}</span></div>
            <div class="detail-item"><span class="k">敏感度 / 质量分</span><span class="v">{{ detail.sensitivity_score }} 分 / {{ detail.quality_score }} 分</span></div>
            <div class="detail-item"><span class="k">发现时间</span><span class="v">{{ fmtDateTime(detail.discovered_at) }}</span></div>
            <div class="detail-item"><span class="k">最近更新</span><span class="v">{{ fmtDateTime(detail.updated_at) }}</span></div>
            <div class="detail-item"><span class="k">关联风险事件</span><span class="v">{{ detail.riskCount }} 起</span></div>
            <div class="detail-item"><span class="k">合规检查记录</span><span class="v">{{ detail.checkCount }} 条</span></div>
            <div class="detail-item"><span class="k">共享申请</span><span class="v">{{ detail.shareCount }} 条</span></div>
            <div class="detail-item"><span class="k">统计口径</span><span class="v">按来源系统匹配检查任务</span></div>
            <div class="detail-item span-2">
              <span class="k">业务标签</span>
              <span class="v tag-line">
                <el-tag v-for="tag in detail.tags" :key="tag" size="small" type="info" effect="plain">{{ tag }}</el-tag>
                <span v-if="!detail.tags.length" class="muted">暂无标签</span>
              </span>
            </div>
            <div class="detail-item span-2"><span class="k">资产描述</span><span class="v">{{ detail.description ?? '-' }}</span></div>
          </div>

          <el-divider content-position="left">资产生命周期</el-divider>
          <el-timeline v-if="detail.lifecycle.length" class="trace-line">
            <el-timeline-item
              v-for="item in detail.lifecycle"
              :key="item.id"
              :type="stageType(item.stage)"
              :timestamp="fmtDateTime(item.occurred_at)"
              placement="top"
            >
              <div class="lifecycle-head">
                <b>{{ item.action }}</b>
                <el-tag size="small" effect="plain">{{ item.stage }}</el-tag>
                <span class="muted">操作人 {{ item.operator }}</span>
              </div>
              <div class="muted">{{ item.detail ?? '-' }}</div>
            </el-timeline-item>
          </el-timeline>
          <EmptyState v-else description="暂无生命周期记录" />
        </template>
        <EmptyState v-else description="暂无资产详情" />
      </div>

      <template #footer>
        <el-button @click="detailDrawer = false">关闭</el-button>
        <template v-if="detail && auth.canWrite('asset')">
          <el-button @click="openEdit(detail)">编辑资产</el-button>
          <el-button type="warning" @click="openLevel(detail)">分级调整</el-button>
          <el-button type="info" :loading="scanningId === detail.id" @click="runScan(detail)">扫描复核</el-button>
        </template>
      </template>
    </DetailDrawer>

    <!-- 登记 / 编辑资产 -->
    <DetailDrawer v-model="formDrawer" :title="editingId ? '编辑数据资产' : '登记数据资产'" width="680px">
      <el-form :model="form" label-width="96px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="资产名称" required>
              <el-input v-model="form.asset_name" maxlength="128" placeholder="如：人口基础信息库" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="所属分类" required>
              <el-select v-model="form.category_id" placeholder="请选择资产分类" style="width: 100%">
                <el-option v-for="c in flatCategories" :key="c.id" :label="c.label" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="责任部门" required>
              <el-select v-model="form.dept_id" placeholder="请选择责任部门" style="width: 100%">
                <el-option v-for="d in depts" :key="d.id" :label="d.dept_name" :value="d.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="来源系统" required>
              <el-input v-model="form.source_system" maxlength="64" placeholder="如：合同管理系统" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="数据类型" required>
              <el-select v-model="form.data_type" style="width: 100%">
                <el-option v-for="t in DATA_TYPES" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="数据级别" required>
              <el-select v-model="form.data_level" style="width: 100%">
                <el-option v-for="l in LEVELS" :key="l" :label="l" :value="l" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="资产状态">
              <el-select v-model="form.status" style="width: 100%">
                <el-option v-for="s in STATUSES" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="生命周期">
              <el-select v-model="form.lifecycle_stage" style="width: 100%">
                <el-option v-for="s in STAGES" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="数据责任人" required>
              <el-input v-model="form.owner" maxlength="32" placeholder="如：李志强" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="文件格式">
              <el-input v-model="form.file_format" maxlength="32" placeholder="如：MySQL / CSV / Parquet" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="存储大小">
              <el-input-number v-model="form.size_gb" :min="0" :max="1000000" :precision="2" :step="10" style="width: 100%" />
              <span class="muted unit">GB</span>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="记录数">
              <el-input-number v-model="form.row_count" :min="0" :max="100000000000" :step="1000" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="质量分">
              <el-input-number v-model="form.quality_score" :min="0" :max="100" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="业务标签">
              <el-select
                v-model="form.tags"
                multiple
                filterable
                allow-create
                default-first-option
                collapse-tags
                placeholder="选择或输入标签"
                style="width: 100%"
              >
                <el-option v-for="t in tagOptions" :key="t.tag_name" :label="`${t.tag_name}（${t.count}）`" :value="t.tag_name" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="资产描述">
              <el-input v-model="form.description" type="textarea" :rows="3" maxlength="512" show-word-limit placeholder="简要说明资产用途、覆盖范围与敏感字段" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <template #footer>
        <el-button @click="formDrawer = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">{{ editingId ? '保存修改' : '确认登记' }}</el-button>
      </template>
    </DetailDrawer>

    <!-- 分级调整 -->
    <el-dialog v-model="levelDialog" title="数据分级调整" width="520px" :close-on-click-modal="false">
      <div v-if="levelTarget" class="level-target">
        <span class="mono">{{ levelTarget.asset_code }}</span>
        <span>{{ levelTarget.asset_name }}</span>
        <StatusTag :value="levelTarget.data_level" />
      </div>
      <el-form label-width="90px" class="mt-12">
        <el-form-item label="调整后级别">
          <el-select v-model="levelForm.data_level" style="width: 200px">
            <el-option v-for="l in LEVELS" :key="l" :label="l" :value="l" :disabled="l === levelTarget?.data_level" />
          </el-select>
        </el-form-item>
        <el-form-item label="调整原因">
          <el-input v-model="levelForm.reason" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="请填写分级调整依据，例如：业务核查确认包含身份证号等个人敏感信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="levelDialog = false">取消</el-button>
        <el-button type="warning" :loading="levelSaving" @click="submitLevel">确认调整</el-button>
      </template>
    </el-dialog>

    <!-- 单资产扫描结果 -->
    <el-dialog v-model="scanDialog" title="敏感度扫描复核结果" width="640px">
      <template v-if="scanResult">
        <div class="scan-summary">
          <span class="mono">{{ scanResult.asset_code }}</span>
          <span>敏感度分 {{ scanResult.old_score }} → <b :class="scoreClass(scanResult.sensitivity_score)">{{ scanResult.sensitivity_score }}</b></span>
          <span class="muted">{{ fmtDateTime(scanResult.scannedAt) }} · 操作人 {{ scanResult.operator }}</span>
        </div>
        <el-table :data="scanResult.findings" size="small" class="mt-12" max-height="320">
          <el-table-column prop="type" label="复核类型" width="110" />
          <el-table-column label="风险级别" width="90">
            <template #default="{ row }"><StatusTag :value="row.level" /></template>
          </el-table-column>
          <el-table-column prop="message" label="复核意见" min-width="320" show-overflow-tooltip />
          <template #empty><EmptyState description="未发现需要复核的事项" /></template>
        </el-table>
      </template>
      <template #footer>
        <el-button type="primary" @click="scanDialog = false">知道了</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import StatusTag from '@/components/StatusTag.vue';
import DetailDrawer from '@/components/DetailDrawer.vue';
import EmptyState from '@/components/EmptyState.vue';
import {
  createAsset,
  exportAssets,
  getAssetCategories,
  getAssetDetail,
  getAssetStats,
  getAssetTags,
  getAssets,
  getDeptOptions,
  scanAllAssets,
  scanAsset,
  updateAsset,
  updateAssetLevel,
  type AssetCategoryNode,
  type AssetDetail,
  type AssetPayload,
  type AssetRow,
  type AssetScanResult,
  type AssetStats,
  type AssetTagItem,
  type DeptOption,
} from '@/api/asset';
import { useAuthStore } from '@/stores/auth';
import { fmtDateTime, fmtNumber, fmtPercent, fmtSizeGb, fmtWan } from '@/utils/format';

const auth = useAuthStore();

const LEVELS = ['公开', '内部', '机密', '绝密'];
const STATUSES = ['正常', '待治理', '风险', '已归档'];
const DATA_TYPES = ['结构化', '半结构化', '非结构化'];
const STAGES = ['采集', '存储', '使用', '共享', '销毁'];
const SORTS = [
  { label: '默认排序', value: '' },
  { label: '存储大小 ↓', value: '-size_gb' },
  { label: '存储大小 ↑', value: 'size_gb' },
  { label: '敏感度 ↓', value: '-sensitivity_score' },
  { label: '敏感度 ↑', value: 'sensitivity_score' },
  { label: '最近访问 ↓', value: '-last_access_at' },
  { label: '最近访问 ↑', value: 'last_access_at' },
];

const stats = ref<AssetStats | null>(null);
const rows = ref<AssetRow[]>([]);
const total = ref(0);
const loading = ref(false);
const scanningAll = ref(false);
const exporting = ref(false);

const query = reactive({
  page: 1,
  pageSize: 10,
  keyword: '',
  level: '',
  status: '',
  categoryId: undefined as number | undefined,
  deptId: undefined as number | undefined,
  stage: '',
  sort: '',
});

const scopeText = computed(() => {
  const scope = auth.user?.dataScope;
  if (scope === 'ALL') return '全平台';
  if (scope === 'DEPT') return '本部门';
  if (scope === 'SELF') return '仅本人负责';
  return '按角色授权';
});

/* ============================ 分类 / 部门 / 标签选项 ============================ */

const categories = ref<AssetCategoryNode[]>([]);
const flatCategories = computed(() => {
  const list: Array<{ id: number; label: string }> = [];
  const walk = (nodes: AssetCategoryNode[], depth: number): void => {
    for (const node of nodes) {
      list.push({ id: node.id, label: `${'　'.repeat(depth)}${node.category_name}` });
      walk(node.children, depth + 1);
    }
  };
  walk(categories.value, 0);
  return list;
});

const depts = ref<DeptOption[]>([]);
const tagOptions = ref<AssetTagItem[]>([]);
let optionLoaded = false;

async function ensureFormOptions(): Promise<void> {
  if (optionLoaded) return;
  optionLoaded = true;
  try {
    const [deptRes, tagRes] = await Promise.all([getDeptOptions(), getAssetTags()]);
    depts.value = deptRes.data.list;
    tagOptions.value = tagRes.data;
  } catch {
    optionLoaded = false;
  }
}

/* ============================ 数据加载 ============================ */

function scoreClass(score: number): string {
  if (score >= 80) return 'text-danger';
  if (score >= 60) return 'text-warning';
  return 'text-success';
}

function scoreColor(score: number): string {
  if (score >= 80) return '#dc2626';
  if (score >= 60) return '#d97706';
  return '#16a34a';
}

function stageType(stage: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  if (stage === '采集') return 'primary';
  if (stage === '存储') return 'info';
  if (stage === '使用') return 'success';
  if (stage === '共享') return 'warning';
  return 'danger';
}

async function loadStats(): Promise<void> {
  const res = await getAssetStats();
  stats.value = res.data;
}

async function loadCategories(): Promise<void> {
  const res = await getAssetCategories();
  categories.value = res.data.tree;
}

async function loadRows(): Promise<void> {
  const res = await getAssets({
    page: query.page,
    pageSize: query.pageSize,
    keyword: query.keyword.trim() || undefined,
    level: query.level || undefined,
    status: query.status || undefined,
    categoryId: query.categoryId,
    deptId: query.deptId,
    stage: query.stage || undefined,
    sort: query.sort || undefined,
  });
  rows.value = res.data;
  total.value = res.meta?.total ?? res.data.length;
}

async function loadAll(): Promise<void> {
  loading.value = true;
  try {
    await Promise.all([loadStats(), loadCategories(), loadRows()]);
  } finally {
    loading.value = false;
  }
}

function reload(): void {
  query.page = 1;
  loading.value = true;
  loadRows().finally(() => {
    loading.value = false;
  });
}

function resetQuery(): void {
  Object.assign(query, {
    page: 1,
    keyword: '',
    level: '',
    status: '',
    categoryId: undefined,
    deptId: undefined,
    stage: '',
    sort: '',
  });
  reload();
}

/* ============================ 详情 ============================ */

const detailDrawer = ref(false);
const detailLoading = ref(false);
const detail = ref<AssetDetail | null>(null);

async function openDetail(rawRow: unknown): Promise<void> {
  const row = rawRow as AssetRow;
  detailDrawer.value = true;
  detail.value = null;
  detailLoading.value = true;
  try {
    const res = await getAssetDetail(row.id);
    detail.value = res.data;
  } finally {
    detailLoading.value = false;
  }
}

async function refreshDetail(id: number): Promise<void> {
  if (!detail.value || detail.value.id !== id) return;
  const res = await getAssetDetail(id);
  detail.value = res.data;
}

/* ============================ 登记 / 编辑 ============================ */

interface AssetFormState {
  asset_name: string;
  category_id: number | null;
  dept_id: number | null;
  source_system: string;
  data_type: string;
  data_level: string;
  owner: string;
  file_format: string;
  size_gb: number;
  row_count: number;
  status: string;
  lifecycle_stage: string;
  quality_score: number;
  description: string;
  tags: string[];
}

const formDrawer = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);
const form = reactive<AssetFormState>(emptyForm());

function emptyForm(): AssetFormState {
  return {
    asset_name: '',
    category_id: null,
    dept_id: null,
    source_system: '',
    data_type: '结构化',
    data_level: '内部',
    owner: '',
    file_format: '',
    size_gb: 0,
    row_count: 0,
    status: '正常',
    lifecycle_stage: '采集',
    quality_score: 90,
    description: '',
    tags: [],
  };
}

function fillForm(row: AssetRow): void {
  Object.assign(form, {
    asset_name: row.asset_name,
    category_id: row.category_id,
    dept_id: row.dept_id,
    source_system: row.source_system,
    data_type: row.data_type,
    data_level: row.data_level,
    owner: row.owner,
    file_format: row.file_format ?? '',
    size_gb: Number(row.size_gb),
    row_count: Number(row.row_count),
    status: row.status,
    lifecycle_stage: row.lifecycle_stage,
    quality_score: Number(row.quality_score),
    description: row.description ?? '',
    tags: [...(row.tags ?? [])],
  });
}

async function openCreate(): Promise<void> {
  editingId.value = null;
  Object.assign(form, emptyForm());
  formDrawer.value = true;
  await ensureFormOptions();
}

async function openEdit(rawRow: unknown): Promise<void> {
  const row = rawRow as AssetRow;
  editingId.value = row.id;
  fillForm(row);
  formDrawer.value = true;
  await ensureFormOptions();
}

function buildPayload(): AssetPayload | null {
  if (!form.asset_name.trim()) {
    ElMessage.warning('请填写资产名称');
    return null;
  }
  if (!form.category_id) {
    ElMessage.warning('请选择资产分类');
    return null;
  }
  if (!form.dept_id) {
    ElMessage.warning('请选择责任部门');
    return null;
  }
  if (!form.source_system.trim()) {
    ElMessage.warning('请填写来源系统');
    return null;
  }
  if (!form.owner.trim()) {
    ElMessage.warning('请填写数据责任人');
    return null;
  }
  return {
    asset_name: form.asset_name.trim(),
    category_id: form.category_id,
    dept_id: form.dept_id,
    source_system: form.source_system.trim(),
    data_type: form.data_type,
    data_level: form.data_level,
    owner: form.owner.trim(),
    file_format: form.file_format.trim() || undefined,
    size_gb: form.size_gb,
    row_count: form.row_count,
    status: form.status,
    lifecycle_stage: form.lifecycle_stage,
    quality_score: form.quality_score,
    description: form.description.trim() || undefined,
    tags: form.tags,
  };
}

async function submitForm(): Promise<void> {
  const payload = buildPayload();
  if (!payload) return;
  if (editingId.value) {
    try {
      await ElMessageBox.confirm(`确认保存对「${form.asset_name}」的修改？`, '修改确认', {
        confirmButtonText: '确认保存',
        cancelButtonText: '取消',
        type: 'warning',
      });
    } catch {
      return;
    }
  }
  saving.value = true;
  try {
    if (editingId.value) {
      await updateAsset(editingId.value, payload);
      ElMessage.success('资产信息已更新');
      await Promise.all([loadRows(), loadStats()]);
      await refreshDetail(editingId.value);
    } else {
      const res = await createAsset(payload);
      ElMessage.success(`资产「${res.data.asset_name}」登记成功，编号 ${res.data.asset_code}`);
      query.page = 1;
      await Promise.all([loadRows(), loadStats()]);
    }
    formDrawer.value = false;
  } finally {
    saving.value = false;
  }
}

/* ============================ 分级调整 ============================ */

const levelDialog = ref(false);
const levelSaving = ref(false);
const levelTarget = ref<AssetRow | null>(null);
const levelForm = reactive<{ data_level: string; reason: string }>({ data_level: '', reason: '' });

function openLevel(rawRow: unknown): void {
  const row = rawRow as AssetRow;
  levelTarget.value = row;
  levelForm.data_level = LEVELS.find((l) => l !== row.data_level) ?? '内部';
  levelForm.reason = '';
  levelDialog.value = true;
}

async function submitLevel(): Promise<void> {
  const target = levelTarget.value;
  if (!target) return;
  if (!levelForm.data_level) {
    ElMessage.warning('请选择调整后的数据级别');
    return;
  }
  if (levelForm.data_level === target.data_level) {
    ElMessage.warning('调整后的级别与原级别一致');
    return;
  }
  if (levelForm.reason.trim().length < 2) {
    ElMessage.warning('请填写不少于 2 个字符的调整原因');
    return;
  }
  const newLevel = levelForm.data_level;
  const reason = levelForm.reason.trim();
  try {
    await ElMessageBox.confirm(
      `确认将资产「${target.asset_name}」的数据级别由「${target.data_level}」调整为「${newLevel}」？调整后将写入生命周期留痕并复算敏感度。`,
      '分级调整确认',
      { confirmButtonText: '确认调整', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  levelSaving.value = true;
  try {
    const res = await updateAssetLevel(target.id, { data_level: newLevel, reason });
    ElMessage.success(`分级调整成功，敏感度分 ${res.data.sensitivity_score}`);
    levelDialog.value = false;
    await Promise.all([loadRows(), loadStats()]);
    await refreshDetail(target.id);
  } finally {
    levelSaving.value = false;
  }
}

/* ============================ 扫描 ============================ */

const scanningId = ref<number | null>(null);
const scanDialog = ref(false);
const scanResult = ref<AssetScanResult | null>(null);

async function runScan(rawRow: unknown): Promise<void> {
  const row = rawRow as AssetRow;
  scanningId.value = row.id;
  try {
    const res = await scanAsset(row.id);
    scanResult.value = res.data;
    scanDialog.value = true;
    await Promise.all([loadRows(), loadStats()]);
    await refreshDetail(row.id);
  } finally {
    scanningId.value = null;
  }
}

async function runGlobalScan(): Promise<void> {
  scanningAll.value = true;
  try {
    const res = await scanAllAssets();
    const data = res.data;
    await loadAll();
    await ElMessageBox.alert(
      `扫描任务 ${data.taskId} 完成：共扫描 ${data.scanned} 个资产，覆盖 ${data.sourceSystems} 个来源系统，建议调整敏感度评分 ${data.changed} 个，耗时 ${data.durationMs} ms。`,
      '全局扫描完成',
      { confirmButtonText: '知道了', type: 'success' },
    ).catch(() => undefined);
  } finally {
    scanningAll.value = false;
  }
}

/* ============================ 导出 ============================ */

async function exportCsv(): Promise<void> {
  exporting.value = true;
  try {
    await exportAssets({
      keyword: query.keyword.trim() || undefined,
      level: query.level || undefined,
      status: query.status || undefined,
      categoryId: query.categoryId,
      deptId: query.deptId,
      stage: query.stage || undefined,
      sort: query.sort || undefined,
    });
    ElMessage.success('资产台账已导出');
  } catch {
    /* 错误提示由 http 层统一处理 */
  } finally {
    exporting.value = false;
  }
}

/* ============================ 初始化 ============================ */

onMounted(loadAll);
</script>

<style scoped>
.score { font-weight: 700; font-variant-numeric: tabular-nums; }
.score-bar { margin-top: 2px; }
.tag-line { display: flex; flex-wrap: wrap; gap: 6px; }
.lifecycle-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 2px; }
.level-target { display: flex; align-items: center; gap: 10px; background: #f7f9fd; border-radius: 8px; padding: 10px 12px; color: #23324a; }
.scan-summary { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: #f7f9fd; border-radius: 8px; padding: 10px 12px; }
.unit { margin-left: 6px; }
</style>
