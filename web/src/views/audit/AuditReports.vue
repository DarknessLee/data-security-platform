<template>
  <div class="page">
    <PageHeader
      title="审计报表"
      :subtitle="`共 ${total} 份审计报表 · 覆盖日报 / 周报 / 月报 / 年报 · 数据生成时间 ${overview?.generatedAt ?? '-'}`"
    >
      <el-button :icon="Refresh" :loading="loading" @click="loadAll">刷新</el-button>
      <el-button v-if="canWrite" type="primary" :icon="Plus" @click="openCreate">生成报表</el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="审计报表总数" :value="cards.reportCount" unit="份" icon="Document" hint="日报 / 周报 / 月报 / 年报" />
      <StatCard label="审计日志总量" :value="cards.totalLogs" unit="条" tone="success" icon="Files" hint="全量操作留痕" />
      <StatCard label="今日日志量" :value="cards.todayLogs" unit="条" tone="primary" icon="Tickets" :hint="`今日失败 ${cards.todayFail} 条`" />
      <StatCard label="今日失败率" :value="cards.failRate" unit="%" tone="danger" icon="Warning" hint="失败操作占今日日志比例" />
      <StatCard label="活跃账号（近 7 天）" :value="cards.activeUsers" unit="个" tone="info" icon="User" hint="参与审计的账号规模" />
    </div>

    <div class="grid-2">
      <ChartBox title="近 7 天审计日志趋势" :option="trendOption" :height="240" :loading="loading" />
      <ChartBox title="今日日志类型分布" :option="typeOption" :height="240" :loading="loading" />
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="报表类型">
          <el-select v-model="reportType" placeholder="全部类型" clearable style="width: 150px" @change="applyFilter">
            <el-option v-for="t in REPORT_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="applyFilter">查询</el-button>
          <el-button :icon="RefreshLeft" @click="resetFilter">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="content-card">
      <template #header>
        <div class="section-title">
          <span>报表列表</span>
          <span class="sub">按生成时间倒序 · 当前筛选共 {{ total }} 份</span>
        </div>
      </template>
      <el-table v-loading="loading" :data="reports" size="default" @row-click="openDetail">
        <el-table-column prop="report_no" label="报表编号" width="140">
          <template #default="{ row }"><span class="mono report-no">{{ row.report_no }}</span></template>
        </el-table-column>
        <el-table-column label="报表名称" min-width="260">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.report_name }}</span>
              <span class="sub">统计周期 {{ row.period_start }} 至 {{ row.period_end }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="typeTag(row.report_type)">{{ row.report_type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="total_events" label="审计事件" width="100" align="right">
          <template #default="{ row }"><span class="mono">{{ fmtNumber(row.total_events) }}</span></template>
        </el-table-column>
        <el-table-column prop="risk_events" label="风险事件" width="100" align="right">
          <template #default="{ row }"><span class="mono" :class="{ 'text-danger': Number(row.risk_events) > 0 }">{{ fmtNumber(row.risk_events) }}</span></template>
        </el-table-column>
        <el-table-column label="合规通过率" width="150">
          <template #default="{ row }">
            <el-progress
              :percentage="toPercent(row.compliance_rate)"
              :stroke-width="8"
              :color="rateColor(toPercent(row.compliance_rate))"
              :format="(p: number) => `${p.toFixed(1)}%`"
            />
          </template>
        </el-table-column>
        <el-table-column prop="generated_by" label="生成人" width="100" />
        <el-table-column prop="created_at" label="生成时间" width="165" />
        <el-table-column label="操作" width="80" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="openDetail(row)">查看</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState description="暂无审计报表，可点击右上角生成" />
        </template>
      </el-table>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="loadReports"
        @size-change="handleSizeChange"
      />
    </el-card>

    <el-dialog v-model="createVisible" title="生成审计报表" width="520px">
      <el-form label-width="88px">
        <el-form-item label="报表类型">
          <el-radio-group v-model="createType">
            <el-radio v-for="t in REPORT_TYPES" :key="t" :value="t" border>{{ t }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="统计周期">
          <span class="mono">{{ previewPeriod.start }} 至 {{ previewPeriod.end }}</span>
        </el-form-item>
        <el-form-item label="统计数据">
          <span class="muted">自动汇总周期内审计日志与风险事件，计算合规检查通过率</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">确认生成</el-button>
      </template>
    </el-dialog>

    <DetailDrawer v-model="detailVisible" :title="`审计报表详情 ${detail?.record.report_no ?? ''}`" width="680px">
      <div v-if="detailLoading" v-loading="true" class="drawer-loading" />
      <template v-else-if="detail">
        <div class="report-head">
          <div>
            <h3>{{ detail.record.report_name }}</h3>
            <p>{{ detail.record.period_start }} 至 {{ detail.record.period_end }} · {{ detail.record.report_type }}</p>
          </div>
          <el-tag effect="dark" :type="typeTag(detail.record.report_type)">{{ detail.record.report_type }}</el-tag>
        </div>

        <div class="metric-grid mt-12">
          <div class="metric-block">
            <span>审计事件</span>
            <b>{{ fmtNumber(detail.record.total_events) }}</b>
            <em>条</em>
          </div>
          <div class="metric-block danger">
            <span>风险事件</span>
            <b>{{ fmtNumber(detail.record.risk_events) }}</b>
            <em>条</em>
          </div>
          <div class="metric-block success">
            <span>合规通过率</span>
            <b>{{ fmtPercent(detail.record.compliance_rate, 1) }}</b>
            <em>检查通过</em>
          </div>
          <div class="metric-block">
            <span>合规检查</span>
            <b>{{ detail.breakdown.compliance.total }}</b>
            <em>项</em>
          </div>
        </div>

        <div class="section-title mt-16"><span>报表摘要</span><span class="sub">{{ detail.record.generated_by }} · {{ detail.record.created_at }}</span></div>
        <p class="summary-body">{{ detail.record.content ?? '暂无摘要内容' }}</p>

        <div class="section-title mt-16"><span>结构分析</span><span class="sub">周期内分布</span></div>
        <div class="breakdown-list">
          <div v-for="item in typeBars" :key="item.name" class="breakdown-line">
            <span class="b-label">{{ item.name }}</span>
            <el-progress :percentage="item.rate" :stroke-width="8" :show-text="false" color="#3b82f6" class="b-bar" />
            <span class="b-value mono">{{ item.value }}</span>
          </div>
        </div>

        <div class="detail-grid mt-16">
          <div class="detail-item"><span class="k">报表编号</span><span class="v mono">{{ detail.record.report_no }}</span></div>
          <div class="detail-item"><span class="k">报表类型</span><span class="v">{{ detail.record.report_type }}</span></div>
          <div class="detail-item"><span class="k">统计周期</span><span class="v mono">{{ detail.record.period_start }} 至 {{ detail.record.period_end }}</span></div>
          <div class="detail-item"><span class="k">生成人</span><span class="v">{{ detail.record.generated_by }}</span></div>
          <div class="detail-item"><span class="k">合规检查通过</span><span class="v mono">{{ detail.breakdown.compliance.passed }} / {{ detail.breakdown.compliance.total }}</span></div>
          <div class="detail-item"><span class="k">警告 / 不通过</span><span class="v mono">{{ detail.breakdown.compliance.warning }} / {{ detail.breakdown.compliance.failed }}</span></div>
          <div class="detail-item span-2"><span class="k">风险级别分布</span><span class="v">{{ riskLevelText }}</span></div>
        </div>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { EChartsOption } from 'echarts';
import { Plus, Refresh, RefreshLeft, Search } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import ChartBox from '@/components/ChartBox.vue';
import EmptyState from '@/components/EmptyState.vue';
import DetailDrawer from '@/components/DetailDrawer.vue';
import { useAuthStore } from '@/stores/auth';
import { fmtNumber, fmtPercent } from '@/utils/format';
import {
  createAuditReport,
  getAuditOverview,
  getAuditReportDetail,
  getAuditReports,
  type AuditOverview,
  type AuditReportDetail,
  type AuditReportRow,
  type AuditReportType,
} from '@/api/audit';

const REPORT_TYPES: AuditReportType[] = ['日报', '周报', '月报', '年报'];
const DEFAULT_CARDS = {
  todayLogs: 0,
  todayFail: 0,
  failRate: 0,
  totalLogs: 0,
  activeUsers: 0,
  reportCount: 0,
};

const auth = useAuthStore();
const canWrite = computed(() => auth.canWrite('audit'));

const overview = ref<AuditOverview | null>(null);
const reports = ref<AuditReportRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const loading = ref(false);

const reportType = ref('');
const createVisible = ref(false);
const createType = ref<AuditReportType>('日报');
const creating = ref(false);

const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<AuditReportDetail | null>(null);

const cards = computed(() => overview.value?.cards ?? DEFAULT_CARDS);

const trendOption = computed<EChartsOption>(() => ({
  grid: { left: 8, right: 16, top: 28, bottom: 6, containLabel: true },
  legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: '#7b8aa3', fontSize: 11 } },
  tooltip: { trigger: 'axis' },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: (overview.value?.trend ?? []).map((d) => d.date),
    axisLine: { lineStyle: { color: '#dbe4f0' } },
    axisLabel: { color: '#8595ad', fontSize: 11 },
  },
  yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#eef2f8' } }, axisLabel: { color: '#8595ad', fontSize: 11 } },
  series: [
    {
      name: '日志总量',
      type: 'line',
      smooth: true,
      symbolSize: 6,
      data: (overview.value?.trend ?? []).map((d) => d.total),
      itemStyle: { color: '#1f6feb' },
      areaStyle: { color: 'rgba(31,111,235,0.12)' },
    },
    {
      name: '失败数',
      type: 'line',
      smooth: true,
      symbolSize: 6,
      data: (overview.value?.trend ?? []).map((d) => d.fail),
      itemStyle: { color: '#ef4444' },
    },
  ],
}));

const typeOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'item' },
  legend: { bottom: 0, icon: 'circle', textStyle: { color: '#7b8aa3', fontSize: 11 } },
  series: [{
    type: 'pie',
    radius: ['46%', '70%'],
    center: ['50%', '42%'],
    itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
    label: { formatter: '{b}\n{c}', fontSize: 11, color: '#4a5b73' },
    data: overview.value?.logTypeDist ?? [],
  }],
}));

const previewPeriod = computed(() => {
  const end = new Date();
  const days = createType.value === '日报' ? 0 : createType.value === '周报' ? 6 : createType.value === '月报' ? 29 : 364;
  const start = new Date(end.getTime() - days * 86400000);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: fmt(start), end: fmt(end) };
});

const typeBars = computed(() => {
  const items = detail.value?.breakdown.logTypes ?? [];
  const sum = items.reduce((acc, item) => acc + item.value, 0) || 1;
  return items.map((item) => ({ ...item, rate: Math.round((item.value / sum) * 100) }));
});

const riskLevelText = computed(() => {
  const items = detail.value?.breakdown.riskLevels ?? [];
  if (!items.length) return '暂无风险事件';
  return items.map((item) => `${item.name}危 ${item.value} 条`).join(' · ');
});

function toPercent(value: number | string): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

function rateColor(percent: number): string {
  if (percent >= 90) return '#16a34a';
  if (percent >= 70) return '#d97706';
  return '#dc2626';
}

function typeTag(value: string): 'primary' | 'success' | 'warning' | 'info' {
  if (value === '日报') return 'primary';
  if (value === '周报') return 'success';
  if (value === '月报') return 'warning';
  return 'info';
}

async function loadOverview(): Promise<void> {
  const res = await getAuditOverview();
  overview.value = res.data;
}

async function loadReports(): Promise<void> {
  loading.value = true;
  try {
    const res = await getAuditReports({
      page: page.value,
      pageSize: pageSize.value,
      reportType: reportType.value || undefined,
    });
    reports.value = res.data;
    total.value = res.meta?.total ?? res.data.length;
  } finally {
    loading.value = false;
  }
}

async function loadAll(): Promise<void> {
  await Promise.all([loadOverview(), loadReports()]);
}

function applyFilter(): void {
  page.value = 1;
  loadReports();
}

function resetFilter(): void {
  reportType.value = '';
  page.value = 1;
  loadReports();
}

function handleSizeChange(): void {
  page.value = 1;
  loadReports();
}

function openCreate(): void {
  createType.value = '日报';
  createVisible.value = true;
}

async function submitCreate(): Promise<void> {
  creating.value = true;
  try {
    const res = await createAuditReport(createType.value);
    createVisible.value = false;
    ElMessage.success(`审计报表 ${res.data.report_no} 生成成功`);
    page.value = 1;
    await Promise.all([loadReports(), loadOverview()]);
    await openDetail(res.data);
  } finally {
    creating.value = false;
  }
}

async function openDetail(row: AuditReportRow | Record<string, unknown>): Promise<void> {
  const report = row as AuditReportRow;
  detail.value = null;
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    const res = await getAuditReportDetail(report.id);
    detail.value = res.data;
  } finally {
    detailLoading.value = false;
  }
}

onMounted(loadAll);
</script>

<style scoped>
.report-no { font-weight: 600; color: #1f5fbf; }
.report-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.report-head h3 { margin: 0 0 4px; font-size: 16px; color: #13233c; }
.report-head p { margin: 0; font-size: 12.5px; color: #8595ad; }
.metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.metric-block { border: 1px solid #e9eef6; border-radius: 10px; padding: 10px 12px; background: #fbfdff; display: flex; flex-direction: column; gap: 2px; }
.metric-block span { font-size: 11.5px; color: #8595ad; }
.metric-block b { font-size: 20px; color: #13233c; font-variant-numeric: tabular-nums; }
.metric-block em { font-style: normal; font-size: 11px; color: #9aa8bc; }
.metric-block.danger b { color: #dc2626; }
.metric-block.success b { color: #16a34a; }
.summary-body { margin: 0; padding: 12px 14px; background: #f8fafd; border-left: 3px solid #3b82f6; border-radius: 6px; font-size: 13px; line-height: 1.9; color: #3d4f6a; }
.breakdown-list { display: flex; flex-direction: column; gap: 8px; }
.breakdown-line { display: flex; align-items: center; gap: 10px; }
.b-label { width: 64px; font-size: 12.5px; color: #5b6c85; flex-shrink: 0; }
.b-bar { flex: 1; }
.b-value { width: 42px; text-align: right; font-size: 12px; color: #8595ad; }
.drawer-loading { min-height: 280px; }
</style>
