<template>
  <div class="page">
    <PageHeader title="运行监控" :subtitle="`平台核心指标 30 秒自动刷新 · 最近更新 ${lastUpdated || '-'}`">
      <el-tag v-if="availability" type="success" effect="plain">近 {{ availability.days }} 日可用率 {{ availability.rate }}%</el-tag>
      <el-button :loading="loading" @click="load(false)">刷新数据</el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="CPU 使用率" :value="metricValue(latest?.cpu_usage)" unit="%" :tone="toneOf(latest?.cpu_usage)" icon="Cpu" :hint="`告警阈值 ${thresholds.cpu_usage}%`" />
      <StatCard label="内存使用率" :value="metricValue(latest?.mem_usage)" unit="%" :tone="toneOf(latest?.mem_usage)" icon="Odometer" :hint="`告警阈值 ${thresholds.mem_usage}%`" />
      <StatCard label="磁盘使用率" :value="metricValue(latest?.disk_usage)" unit="%" :tone="diskTone" icon="Coin" hint="数据盘 /data" />
      <StatCard label="在线用户" :value="metricValue(latest?.online_users)" unit="人" tone="primary" icon="User" :hint="`数据库连接 ${latest?.db_connections ?? '-'}`" />
      <StatCard label="接口 QPS" :value="metricValue(latest?.api_qps)" unit="次/秒" tone="primary" icon="Connection" :hint="`Redis 命中率 ${latest?.redis_hit_rate ?? '-'}%`" />
      <StatCard label="平均响应时间" :value="metricValue(latest?.api_avg_ms)" unit="ms" :tone="apiTone" icon="Timer" :hint="`告警阈值 ${thresholds.api_avg_ms} ms`" />
      <StatCard label="7 日可用率" :value="availability?.rate ?? '-'" unit="%" :tone="(availability?.rate ?? 0) >= 99 ? 'success' : 'warning'" icon="CircleCheck" :hint="availability?.window ?? '统计窗口加载中'" />
      <StatCard label="备份成功率" :value="overview?.backups.successRate ?? '-'" unit="%" :tone="(overview?.backups.successRate ?? 0) >= 95 ? 'success' : 'warning'" icon="DataLine" :hint="`成功 ${overview?.backups.success ?? 0} / 失败 ${overview?.backups.failed ?? 0}`" />
    </div>

    <div class="grid-2">
      <ChartBox title="近 24 小时资源使用率" :option="trendOption" :height="300" :loading="loading" />
      <ChartBox title="接口吞吐与平均响应（24 小时）" :option="trafficOption" :height="300" :loading="loading" />
    </div>

    <div class="grid-2-1">
      <el-card shadow="never" class="content-card">
        <template #header>
          <div class="section-title">
            <span>告警列表 <span class="sub">严重 {{ alertSummary.critical }} 条 · 警告 {{ alertSummary.warning }} 条</span></span>
            <el-button v-if="pendingAlerts.length" text type="primary" @click="confirmAll">全部确认</el-button>
          </div>
        </template>
        <div v-loading="alertsLoading" class="alert-list">
          <div v-for="a in pendingAlerts" :key="a.id" class="alert-item">
            <el-tag :type="a.level === '严重' ? 'danger' : 'warning'" size="small" effect="dark" class="alert-level">{{ a.level }}</el-tag>
            <div class="alert-main">
              <div class="alert-head">
                <span class="alert-title">{{ a.title }}</span>
                <span class="alert-time mono">{{ a.occurredAt }}</span>
              </div>
              <p class="alert-detail">{{ a.detail }}</p>
              <div class="alert-meta">
                <span class="chip">{{ sourceText(a.source) }}</span>
                <span class="chip">{{ a.metric }}：{{ a.value }} / 阈值 {{ a.threshold }}</span>
              </div>
            </div>
            <el-button size="small" @click="confirmOne(a)">确认</el-button>
          </div>
          <EmptyState v-if="!pendingAlerts.length" :description="ackedCount ? `全部 ${ackedCount} 条告警已确认` : '当前无告警'" />
        </div>
      </el-card>

      <ChartBox title="近 7 日可用率" :option="availabilityOption" :height="300" :loading="loading" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { EChartsOption } from 'echarts';
import { ElMessage } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import ChartBox from '@/components/ChartBox.vue';
import EmptyState from '@/components/EmptyState.vue';
import {
  getOpsAlerts,
  getOpsMetrics,
  getOpsOverview,
  type OpsAlert,
  type OpsMetric,
  type OpsOverview,
} from '@/api/ops';


const overview = ref<OpsOverview | null>(null);
const metrics = ref<OpsMetric[]>([]);
const alerts = ref<OpsAlert[]>([]);
const ackedIds = ref<Set<string>>(new Set());
const loading = ref(false);
const alertsLoading = ref(false);
const lastUpdated = ref('');
let timer: number | undefined;

const latest = computed<OpsMetric | null>(() => overview.value?.latest ?? null);
const availability = computed(() => overview.value?.availability);
const thresholds = computed(() => overview.value?.thresholds ?? { cpu_usage: 85, mem_usage: 85, api_avg_ms: 500 });

const pendingAlerts = computed(() => alerts.value.filter((a) => !ackedIds.value.has(a.id)));
const ackedCount = computed(() => ackedIds.value.size);
const alertSummary = computed(() => {
  const summary = { critical: 0, warning: 0 };
  for (const a of pendingAlerts.value) {
    if (a.level === '严重') summary.critical += 1;
    else summary.warning += 1;
  }
  return summary;
});

function metricValue(v: number | null | undefined): number | string {
  return typeof v === 'number' && Number.isFinite(v) ? v : '-';
}

function toneOf(v: number | null | undefined): 'success' | 'warning' | 'danger' {
  const n = Number(v ?? 0);
  if (n >= 85) return 'danger';
  if (n >= 70) return 'warning';
  return 'success';
}

function apiToneOf(v: number | null | undefined): 'success' | 'warning' | 'danger' {
  const n = Number(v ?? 0);
  if (n >= 500) return 'danger';
  if (n >= 300) return 'warning';
  return 'success';
}

const diskTone = computed<'success' | 'warning' | 'danger'>(() => {
  const n = Number(latest.value?.disk_usage ?? 0);
  if (n >= 90) return 'danger';
  if (n >= 80) return 'warning';
  return 'success';
});
const apiTone = computed<'success' | 'warning' | 'danger'>(() => apiToneOf(latest.value?.api_avg_ms));

const metricTimeLabels = computed(() => metrics.value.map((m) => m.metric_time.slice(11, 16)));

const trendOption = computed<EChartsOption>(() => ({
  grid: { left: 8, right: 16, top: 30, bottom: 6, containLabel: true },
  legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: '#7b8aa3', fontSize: 11 } },
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', boundaryGap: false, data: metricTimeLabels.value, axisLine: { lineStyle: { color: '#dbe4f0' } }, axisLabel: { color: '#8595ad', fontSize: 11 } },
  yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%', color: '#8595ad', fontSize: 11 }, splitLine: { lineStyle: { color: '#eef2f8' } } },
  series: [
    { name: 'CPU', type: 'line', smooth: true, symbol: 'none', data: metrics.value.map((m) => m.cpu_usage), itemStyle: { color: '#1f6feb' }, areaStyle: { color: 'rgba(31,111,235,0.10)' } },
    { name: '内存', type: 'line', smooth: true, symbol: 'none', data: metrics.value.map((m) => m.mem_usage), itemStyle: { color: '#f59e0b' } },
    { name: '磁盘', type: 'line', smooth: true, symbol: 'none', data: metrics.value.map((m) => m.disk_usage), itemStyle: { color: '#16a34a' } },
  ],
}));

const trafficOption = computed<EChartsOption>(() => ({
  grid: { left: 8, right: 8, top: 34, bottom: 6, containLabel: true },
  legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: '#7b8aa3', fontSize: 11 } },
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', data: metricTimeLabels.value, axisLine: { lineStyle: { color: '#dbe4f0' } }, axisLabel: { color: '#8595ad', fontSize: 11 } },
  yAxis: [
    { type: 'value', name: 'QPS', nameTextStyle: { color: '#8595ad', fontSize: 11 }, axisLabel: { color: '#8595ad', fontSize: 11 }, splitLine: { lineStyle: { color: '#eef2f8' } } },
    { type: 'value', name: '响应(ms)', nameTextStyle: { color: '#8595ad', fontSize: 11 }, axisLabel: { color: '#8595ad', fontSize: 11 }, splitLine: { show: false } },
  ],
  series: [
    { name: '接口 QPS', type: 'bar', barWidth: 10, data: metrics.value.map((m) => m.api_qps), itemStyle: { color: 'rgba(31,111,235,0.75)', borderRadius: [3, 3, 0, 0] } },
    { name: '平均响应', type: 'line', yAxisIndex: 1, smooth: true, symbol: 'none', data: metrics.value.map((m) => m.api_avg_ms), itemStyle: { color: '#ef4444' } },
  ],
}));

const availabilityOption = computed<EChartsOption>(() => ({
  grid: { left: 8, right: 16, top: 20, bottom: 6, containLabel: true },
  tooltip: { trigger: 'axis', valueFormatter: (v) => `${v}%` },
  xAxis: { type: 'category', data: (availability.value?.daily ?? []).map((d) => d.date.slice(5)), axisLine: { lineStyle: { color: '#dbe4f0' } }, axisLabel: { color: '#8595ad', fontSize: 11 } },
  yAxis: { type: 'value', min: 90, max: 100, axisLabel: { formatter: '{value}%', color: '#8595ad', fontSize: 11 }, splitLine: { lineStyle: { color: '#eef2f8' } } },
  series: [
    {
      name: '可用率',
      type: 'bar',
      barWidth: 22,
      data: (availability.value?.daily ?? []).map((d) => d.rate),
      itemStyle: { color: '#16a34a', borderRadius: [4, 4, 0, 0] },
      label: { show: true, position: 'top', formatter: '{c}%', color: '#4a5b73', fontSize: 11 },
    },
  ],
}));

function sourceText(source: string): string {
  return { metric: '指标阈值', backup: '备份记录', risk: '风险事件', ticket: '运维工单' }[source] ?? source;
}

function confirmOne(a: OpsAlert): void {
  ackedIds.value.add(a.id);
  ElMessage.success('告警已确认');
}

function confirmAll(): void {
  const count = pendingAlerts.value.length;
  for (const a of pendingAlerts.value) ackedIds.value.add(a.id);
  ElMessage.success(`已确认 ${count} 条告警`);
}

async function load(_silent = true): Promise<void> {
  loading.value = true;
  alertsLoading.value = true;
  try {
    const [ov, mt, al] = await Promise.all([getOpsOverview(), getOpsMetrics(24), getOpsAlerts()]);
    overview.value = ov.data;
    metrics.value = mt.data;
    alerts.value = al.data;
    lastUpdated.value = ov.data.generatedAt;
  } finally {
    loading.value = false;
    alertsLoading.value = false;
  }
}

onMounted(() => {
  load(false);
  timer = window.setInterval(() => load(true), 30_000);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<style scoped>
.stat-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.alert-list { display: flex; flex-direction: column; gap: 8px; max-height: 420px; overflow-y: auto; padding-right: 2px; }
.alert-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid #eef2f8; border-radius: 10px; background: #fbfdff; }
.alert-level { flex-shrink: 0; margin-top: 1px; }
.alert-main { flex: 1; min-width: 0; }
.alert-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.alert-title { font-size: 13px; font-weight: 600; color: #1c2c46; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.alert-time { font-size: 11px; color: #94a3b8; flex-shrink: 0; }
.alert-detail { margin: 4px 0 6px; font-size: 12px; color: #5b6c85; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.alert-meta { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { font-size: 11px; color: #64748b; background: #f1f5fb; border-radius: 999px; padding: 1px 8px; }
.section-title .sub { margin-left: 6px; }
</style>
