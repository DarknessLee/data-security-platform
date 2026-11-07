<template>
  <div class="page dashboard">
    <PageHeader title="安全运营总览" :subtitle="`数据安全治理全景 · 数据生成时间 ${overview?.generatedAt ?? '-'}`">
      <el-button :loading="loading" @click="load">刷新数据</el-button>
      <el-tag v-if="overview?.cards.latestBatchNo" type="info" effect="plain">最新合规批次 {{ overview.cards.latestBatchNo }}</el-tag>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="纳管数据资产" :value="cards.totalAssets" unit="项" icon="Coin" hint="覆盖 8 个来源业务系统" />
      <StatCard label="敏感数据资产" :value="cards.sensitiveAssets" unit="项" tone="danger" icon="Lock" hint="机密 / 绝密级资产" />
      <StatCard label="待处置风险" :value="cards.openRisk" unit="起" tone="warning" icon="Warning" :hint="`其中高危及紧急 ${cards.urgentRisk} 起`" />
      <StatCard label="合规通过率" :value="cards.complianceRate" unit="%" tone="success" icon="DocumentChecked" hint="最近一次自动检查" />
      <StatCard label="待办工单" :value="cards.pendingTickets" unit="单" tone="primary" icon="Service" :hint="`待整改 ${cards.openRectify} 项`" />
      <StatCard label="今日审计日志" :value="cards.todayLogs" unit="条" tone="info" icon="Tickets" :hint="`在线账号 ${cards.onlineUsers} 个`" />
    </div>

    <div class="grid-1-2">
      <ChartBox title="资产分级分布" :option="levelOption" :height="280" />
      <ChartBox title="风险事件 7 日趋势" :option="riskTrendOption" :height="280" />
    </div>

    <div class="grid-2">
      <ChartBox title="合规检查通过率（近 5 批次）" :option="complianceOption" :height="260" />
      <ChartBox title="风险级别分布" :option="riskLevelOption" :height="260" />
    </div>

    <div class="grid-2-1">
      <el-card shadow="never" class="content-card">
        <template #header>
          <div class="section-title">
            <span>重点风险事件</span>
            <router-link v-if="auth.canRead('risk')" to="/risk/events" class="sub">查看全部 →</router-link>
          </div>
        </template>
        <el-table :data="overview?.recentEvents ?? []" size="small" v-loading="loading">
          <el-table-column prop="event_no" label="事件编号" width="140" />
          <el-table-column label="事件类型" min-width="130">
            <template #default="{ row }">
              <div class="cell-main">
                <span class="title">{{ row.event_type }}</span>
                <span class="sub">{{ row.asset_name ?? '未关联资产' }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="level" label="级别" width="80">
            <template #default="{ row }"><StatusTag :value="row.level" /></template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }"><StatusTag :value="row.status" /></template>
          </el-table-column>
          <el-table-column label="操作人 / IP" min-width="150">
            <template #default="{ row }">
              <div class="cell-main"><span class="title">{{ row.username }}</span><span class="sub mono">{{ row.ip ?? '-' }}</span></div>
            </template>
          </el-table-column>
          <el-table-column prop="occurred_at" label="发生时间" width="165" />
        </el-table>
      </el-card>

      <div class="side-col">
        <ChartBox title="生命周期阶段分布" :option="stageOption" :height="200" />
        <el-card shadow="never" class="content-card">
          <template #header><div class="section-title"><span>运维实时指标</span><span class="sub">CPU / 内存</span></div></template>
          <div class="metric-row">
            <div class="metric-item">
              <span>CPU 使用率</span>
              <b :class="pctClass(Number(overview?.opsLatest?.cpu_usage ?? 0))">{{ overview?.opsLatest?.cpu_usage ?? '-' }}%</b>
            </div>
            <div class="metric-item">
              <span>内存使用率</span>
              <b :class="pctClass(Number(overview?.opsLatest?.mem_usage ?? 0))">{{ overview?.opsLatest?.mem_usage ?? '-' }}%</b>
            </div>
            <div class="metric-item">
              <span>接口 QPS</span>
              <b>{{ overview?.opsLatest?.api_qps ?? '-' }}</b>
            </div>
            <div class="metric-item">
              <span>平均响应</span>
              <b>{{ overview?.opsLatest?.api_avg_ms ?? '-' }} ms</b>
            </div>
          </div>
          <div class="notice-list mt-12">
            <div v-for="n in overview?.notices ?? []" :key="n.id" class="notice-line">
              <el-tag size="small" :type="n.level === '紧急' ? 'danger' : n.level === '警告' ? 'warning' : 'info'">{{ n.level }}</el-tag>
              <span class="notice-text">{{ n.title }}</span>
              <span class="notice-time">{{ fmtRelative(n.created_at) }}</span>
            </div>
            <EmptyState v-if="!overview?.notices?.length" description="暂无通知" />
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { EChartsOption } from 'echarts';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import ChartBox from '@/components/ChartBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';
import { getOverview, type DashboardOverview } from '@/api/dashboard';
import { useAuthStore } from '@/stores/auth';
import { fmtRelative } from '@/utils/format';

const auth = useAuthStore();
const overview = ref<DashboardOverview | null>(null);
const loading = ref(false);
const cards = computed(() => overview.value?.cards ?? {
  totalAssets: 0, sensitiveAssets: 0, openRisk: 0, urgentRisk: 0, pendingTickets: 0,
  openRectify: 0, todayLogs: 0, onlineUsers: 0, complianceRate: 0, latestBatchNo: null,
});
let timer: number | undefined;

const LEVEL_COLORS = ['#38bdf8', '#60a5fa', '#f59e0b', '#ef4444'];

const levelOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'item' },
  legend: { bottom: 0, icon: 'circle' },
  series: [{
    type: 'pie',
    radius: ['48%', '72%'],
    center: ['50%', '44%'],
    itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
    label: { formatter: '{b}\n{c} 项', fontSize: 12, color: '#4a5b73' },
    data: (overview.value?.assetLevel ?? []).map((d, i) => ({ ...d, itemStyle: { color: LEVEL_COLORS[i] } })),
  }],
}));

const stageOption = computed<EChartsOption>(() => ({
  grid: { left: 8, right: 12, top: 10, bottom: 6, containLabel: true },
  xAxis: { type: 'category', data: (overview.value?.assetStage ?? []).map((d) => d.name), axisLine: { lineStyle: { color: '#dbe4f0' } }, axisLabel: { color: '#8595ad', fontSize: 11 } },
  yAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef2f8' } }, axisLabel: { color: '#8595ad', fontSize: 11 } },
  tooltip: { trigger: 'axis' },
  series: [{
    type: 'bar',
    barWidth: 18,
    itemStyle: { borderRadius: [4, 4, 0, 0], color: '#3b82f6' },
    data: (overview.value?.assetStage ?? []).map((d) => d.value),
  }],
}));

const riskTrendOption = computed<EChartsOption>(() => ({
  grid: { left: 8, right: 16, top: 28, bottom: 6, containLabel: true },
  legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: '#7b8aa3', fontSize: 11 } },
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', boundaryGap: false, data: (overview.value?.riskTrend ?? []).map((d) => d.date), axisLine: { lineStyle: { color: '#dbe4f0' } }, axisLabel: { color: '#8595ad', fontSize: 11 } },
  yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#eef2f8' } }, axisLabel: { color: '#8595ad', fontSize: 11 } },
  series: [
    { name: '事件总数', type: 'line', smooth: true, symbolSize: 6, data: (overview.value?.riskTrend ?? []).map((d) => d.total), itemStyle: { color: '#1f6feb' }, areaStyle: { color: 'rgba(31,111,235,0.12)' } },
    { name: '高危及紧急', type: 'line', smooth: true, symbolSize: 6, data: (overview.value?.riskTrend ?? []).map((d) => d.high), itemStyle: { color: '#ef4444' } },
  ],
}));

const complianceOption = computed<EChartsOption>(() => ({
  grid: { left: 8, right: 16, top: 24, bottom: 6, containLabel: true },
  tooltip: { trigger: 'axis', valueFormatter: (v) => `${v}%` },
  xAxis: { type: 'category', data: (overview.value?.complianceTrend ?? []).map((d) => d.batch), axisLine: { lineStyle: { color: '#dbe4f0' } }, axisLabel: { color: '#8595ad', fontSize: 11 } },
  yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', color: '#8595ad', fontSize: 11 }, splitLine: { lineStyle: { color: '#eef2f8' } } },
  series: [{
    type: 'line', smooth: true, symbolSize: 8,
    data: (overview.value?.complianceTrend ?? []).map((d) => d.rate),
    itemStyle: { color: '#16a34a' },
    lineStyle: { width: 3 },
    markLine: { silent: true, symbol: 'none', data: [{ yAxis: 90, label: { formatter: '目标 90%' } }], lineStyle: { color: '#f59e0b', type: 'dashed' } },
  }],
}));

const riskLevelOption = computed<EChartsOption>(() => ({
  grid: { left: 8, right: 20, top: 10, bottom: 6, containLabel: true },
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  xAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef2f8' } }, axisLabel: { color: '#8595ad', fontSize: 11 } },
  yAxis: { type: 'category', data: (overview.value?.riskLevel ?? []).map((d) => d.name).reverse(), axisLine: { lineStyle: { color: '#dbe4f0' } }, axisLabel: { color: '#4a5b73' } },
  series: [{
    type: 'bar',
    barWidth: 16,
    data: (overview.value?.riskLevel ?? []).map((d) => d.value).reverse().map((v, i, arr) => ({
      value: v,
      itemStyle: { color: i === arr.length - 1 ? '#ef4444' : i === arr.length - 2 ? '#f59e0b' : i === arr.length - 3 ? '#3b82f6' : '#94a3b8', borderRadius: [0, 4, 4, 0] },
    })),
    label: { show: true, position: 'right', color: '#64748b', fontSize: 11 },
  }],
}));

function pctClass(v: number): string {
  if (v >= 85) return 'text-danger';
  if (v >= 70) return 'text-warning';
  return 'text-success';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await getOverview();
    overview.value = res.data;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  timer = window.setInterval(load, 60000);
});
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<style scoped>
.side-col { display: flex; flex-direction: column; gap: 14px; }
.metric-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.metric-item { border: 1px solid #eef2f8; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; background: #fbfdff; }
.metric-item span { font-size: 12px; color: #8595ad; }
.metric-item b { font-size: 18px; color: #13233c; font-variant-numeric: tabular-nums; }
.notice-list { display: flex; flex-direction: column; gap: 2px; }
.notice-line { display: flex; align-items: center; gap: 8px; padding: 7px 2px; border-bottom: 1px dashed #eef2f8; }
.notice-line:last-child { border-bottom: none; }
.notice-text { flex: 1; font-size: 12.5px; color: #3d4f6a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notice-time { font-size: 11px; color: #9aa8bc; white-space: nowrap; }
.section-title a.sub { text-decoration: none; }
</style>
