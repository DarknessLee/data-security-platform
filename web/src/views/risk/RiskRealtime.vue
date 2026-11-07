<template>
  <section class="page risk-realtime">
    <PageHeader title="实时监控" subtitle="智能风险监测 · 实时风险态势大屏">
      <el-tag :type="polling ? 'success' : 'info'" effect="plain">
        {{ polling ? '30 秒自动刷新' : '已暂停刷新' }}
      </el-tag>
      <span class="muted">最近刷新：{{ lastRefresh || '-' }}</span>
      <el-button :loading="loading" icon="Refresh" @click="loadAll">立即刷新</el-button>
      <el-button :type="polling ? 'warning' : 'primary'" plain @click="togglePolling">
        {{ polling ? '暂停轮询' : '开启轮询' }}
      </el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard
        v-for="lv in levelCards"
        :key="lv.level"
        :label="`${lv.level}风险事件`"
        :value="lv.count"
        unit="起"
        :tone="lv.tone"
        :hint="`占今日事件 ${todayTotal ? Math.round((lv.count / todayTotal) * 100) : 0}%`"
      />
    </div>

    <div class="grid-2">
      <ChartBox title="近 24 小时风险趋势" :option="hourlyOption" :height="300" :loading="loading" />
      <ChartBox title="事件类型分布" :option="typeOption" :height="300" :loading="loading" />
    </div>

    <div class="grid-2-1">
      <el-card shadow="never" class="content-card">
        <template #header>
          <div class="section-title">
            <span>最新风险事件</span>
            <span class="sub">实时滚动 · 最近 {{ latest.length }} 条</span>
          </div>
        </template>
        <el-scrollbar height="360px">
          <div class="live-list" data-testid="risk-live-list">
            <div v-for="item in latest" :key="item.id" class="live-item">
              <div class="live-main">
                <StatusTag :value="item.level" />
                <span class="mono live-no">{{ item.event_no }}</span>
                <span class="live-type">{{ item.event_type }}</span>
                <span class="muted live-user">{{ item.username }} · {{ item.ip ?? '-' }}</span>
              </div>
              <div class="live-side">
                <StatusTag :value="item.status" />
                <span class="muted">{{ fmtRelative(item.occurred_at) }}</span>
              </div>
            </div>
            <EmptyState v-if="!latest.length" description="暂无实时事件" />
          </div>
        </el-scrollbar>
      </el-card>

      <div class="right-col">
        <el-card shadow="never" class="content-card">
          <template #header>
            <div class="section-title"><span>重点 IP 排行</span><span class="sub">按命中次数</span></div>
          </template>
          <div class="ip-list" data-testid="risk-ip-rank">
            <div v-for="(ip, idx) in topIps" :key="ip.ip" class="ip-item">
              <span class="ip-rank" :class="{ hot: idx < 3 }">{{ idx + 1 }}</span>
              <div class="ip-body">
                <div class="ip-line">
                  <span class="mono">{{ ip.ip }}</span>
                  <span class="ip-hits">{{ ip.hits }} 次</span>
                </div>
                <el-progress :percentage="ipPercent(ip.hits)" :stroke-width="8" :show-text="false" :color="idx === 0 ? '#e5484d' : '#f76808'" />
                <div class="muted ip-sub">紧急 {{ ip.urgent }} 起 · 涉及账号 {{ ip.users }} 个 · 最近 {{ ip.last_at ? fmtRelative(ip.last_at) : '-' }}</div>
              </div>
            </div>
            <EmptyState v-if="!topIps.length" description="暂无重点 IP" />
          </div>
        </el-card>
        <ChartBox title="近 60 分钟每分钟事件数" :option="perMinuteOption" :height="170" :loading="loading" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { EChartsOption } from 'echarts';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import ChartBox from '@/components/ChartBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';
import { getOverview, getRealtime, type RiskEventRow, type RiskRealtime } from '@/api/risk';
import { fmtRelative } from '@/utils/format';

const POLL_INTERVAL = 30_000;

const loading = ref(false);
const polling = ref(true);
const lastRefresh = ref('');
const latest = ref<RiskEventRow[]>([]);
const topIps = ref<RiskRealtime['topIps']>([]);
const perMinute = ref<RiskRealtime['perMinute']>([]);
const levelCounts = ref<RiskRealtime['levelCounts']>([]);
const hourlyTrend = ref<Array<{ time: string; total: number; low: number; mid: number; high: number; urgent: number }>>([]);
const typeDist = ref<Array<{ name: string; value: number }>>([]);

const LEVEL_ORDER = ['紧急', '高', '中', '低'];
const LEVEL_TONES: Record<string, 'danger' | 'warning' | 'primary' | 'info'> = {
  紧急: 'danger',
  高: 'warning',
  中: 'primary',
  低: 'info',
};

const levelCards = computed(() =>
  LEVEL_ORDER.map((level) => ({
    level,
    tone: LEVEL_TONES[level],
    count: levelCounts.value.find((l) => l.level === level)?.count ?? 0,
  })),
);

const todayTotal = computed(() => levelCards.value.reduce((sum, c) => sum + c.count, 0));
const maxIpHits = computed(() => Math.max(1, ...topIps.value.map((i) => i.hits)));

function ipPercent(hits: number): number {
  return Math.round((hits / maxIpHits.value) * 100);
}

const hourlyOption = computed<EChartsOption>(() => {
  const points = hourlyTrend.value;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    legend: { data: ['事件总数', '紧急事件'], top: 6, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
    xAxis: {
      type: 'category',
      data: points.map((p) => p.time),
      axisLabel: { fontSize: 10, interval: Math.max(0, Math.floor(points.length / 8) - 1) },
      axisTick: { show: false },
    },
    yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } }, axisLabel: { fontSize: 10 } },
    series: [
      {
        name: '事件总数',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        data: points.map((p) => p.total),
        itemStyle: { color: '#2563eb' },
        areaStyle: { color: 'rgba(37,99,235,0.14)' },
      },
      {
        name: '紧急事件',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        data: points.map((p) => p.urgent),
        itemStyle: { color: '#e5484d' },
      },
    ],
  };
});

const typeOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'item', formatter: '{b}：{c} 起（{d}%）' },
  legend: { orient: 'vertical', right: 6, top: 'center', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
  color: ['#e5484d', '#f76808', '#2563eb', '#14b8a6', '#8b5cf6'],
  series: [
    {
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['38%', '52%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { show: true, fontSize: 10, formatter: '{b}\n{d}%' },
      labelLine: { length: 8, length2: 8 },
      data: typeDist.value,
    },
  ],
}));

const perMinuteOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 34, right: 12, top: 16, bottom: 24 },
  xAxis: {
    type: 'category',
    data: perMinute.value.map((p) => p.minute),
    axisLabel: { fontSize: 9, interval: Math.max(0, Math.floor(perMinute.value.length / 5) - 1) },
    axisTick: { show: false },
  },
  yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 9 }, splitLine: { lineStyle: { type: 'dashed' } } },
  series: [
    {
      type: 'bar',
      barWidth: '55%',
      data: perMinute.value.map((p) => p.count),
      itemStyle: { color: '#2563eb', borderRadius: [3, 3, 0, 0] },
    },
  ],
}));

async function loadAll(): Promise<void> {
  loading.value = true;
  try {
    const [overview, realtime] = await Promise.all([getOverview(), getRealtime()]);
    latest.value = realtime.data.latest;
    topIps.value = realtime.data.topIps;
    perMinute.value = realtime.data.perMinute;
    levelCounts.value = realtime.data.levelCounts;
    hourlyTrend.value = overview.data.hourlyTrend;
    typeDist.value = overview.data.typeDist;
    lastRefresh.value = realtime.data.generatedAt || overview.data.generatedAt;
  } finally {
    loading.value = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  stopPolling();
  timer = setInterval(() => {
    if (!document.hidden) loadAll();
  }, POLL_INTERVAL);
}

function stopPolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function togglePolling(): void {
  polling.value = !polling.value;
  if (polling.value) startPolling();
  else stopPolling();
}

onMounted(async () => {
  await loadAll();
  startPolling();
});

onBeforeUnmount(stopPolling);
</script>

<style scoped>
.live-list { display: flex; flex-direction: column; }
.live-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 4px; border-bottom: 1px dashed #eef2f8; }
.live-item:last-child { border-bottom: none; }
.live-main { display: flex; align-items: center; gap: 8px; min-width: 0; }
.live-no { color: #2563eb; font-size: 12.5px; }
.live-type { font-size: 13px; color: #23324a; }
.live-user { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.live-side { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.right-col { display: flex; flex-direction: column; gap: 16px; }
.ip-list { display: flex; flex-direction: column; gap: 10px; }
.ip-item { display: flex; gap: 10px; align-items: flex-start; }
.ip-rank { width: 20px; height: 20px; border-radius: 50%; background: #eef2f8; color: #64748b; font-size: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
.ip-rank.hot { background: #fee2e2; color: #e5484d; font-weight: 700; }
.ip-body { flex: 1; min-width: 0; }
.ip-line { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
.ip-hits { font-size: 12px; color: #e5484d; font-weight: 600; }
.ip-sub { font-size: 11px; margin-top: 3px; }
</style>
