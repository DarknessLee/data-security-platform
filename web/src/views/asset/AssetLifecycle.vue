<template>
  <section class="page asset-lifecycle">
    <PageHeader title="生命周期" subtitle="数据资产 5 阶段全生命周期留痕 · 采集 / 存储 / 使用 / 共享 / 销毁">
      <el-button :loading="loading" icon="Refresh" @click="loadAll">刷新</el-button>
      <el-tag type="info" effect="plain">累计 {{ totalRecords }} 条生命周期记录</el-tag>
    </PageHeader>

    <div class="stat-grid">
      <StatCard
        v-for="item in STAGES"
        :key="item.stage"
        :label="`${item.stage}阶段`"
        :value="stageCount(item.stage)"
        unit="项"
        :tone="item.tone"
        :icon="item.icon"
        :hint="`占全部资产 ${fmtPercent(stageRate(item.stage))}`"
      />
    </div>

    <div class="grid-2">
      <ChartBox title="各阶段资产分布" :option="stageBarOption" :height="250" :loading="loading" />
      <ChartBox title="生命周期阶段占比" :option="stagePieOption" :height="250" :loading="loading" />
    </div>

    <el-card shadow="never" class="content-card">
      <template #header>
        <div class="section-title">
          <span>资产生命周期时间线</span>
          <span class="sub">选择资产查看其采集、存储、使用、共享、销毁全流程留痕</span>
        </div>
      </template>

      <div class="filter-row">
        <el-select
          v-model="selectedAssetId"
          filterable
          clearable
          placeholder="按资产编号/名称检索"
          style="width: 320px"
          :loading="assetLoading"
          data-testid="lifecycle-asset-select"
          @change="loadLifecycle"
        >
          <el-option v-for="a in assetOptions" :key="a.id" :label="`${a.asset_code} · ${a.asset_name}`" :value="a.id" />
        </el-select>
        <el-select v-model="stageFilter" clearable placeholder="全部阶段" style="width: 130px">
          <el-option v-for="s in STAGES" :key="s.stage" :label="s.stage" :value="s.stage" />
        </el-select>
        <span class="muted">共 {{ filteredLifecycle.length }} 条记录</span>
      </div>

      <template v-if="selectedAsset">
        <div class="asset-brief mt-12">
          <div class="cell-main">
            <span class="title">{{ selectedAsset.asset_name }}</span>
            <span class="sub mono">{{ selectedAsset.asset_code }} · {{ selectedAsset.source_system }} · {{ selectedAsset.category_name ?? '-' }}</span>
          </div>
          <StatusTag :value="selectedAsset.data_level" />
          <StatusTag :value="selectedAsset.status" />
          <el-tag size="small" effect="plain">当前阶段 {{ selectedAsset.lifecycle_stage }}</el-tag>
          <span class="muted">敏感度 {{ selectedAsset.sensitivity_score }} 分 · 责任人 {{ selectedAsset.owner }}</span>
        </div>

        <el-steps :active="coveredCount" finish-status="success" process-status="finish" align-center class="mt-16">
          <el-step
            v-for="s in STAGES"
            :key="s.stage"
            :title="s.stage"
            :description="`${countByStage(s.stage)} 条记录`"
          />
        </el-steps>
      </template>

      <el-timeline v-loading="lifecycleLoading" class="timeline mt-12">
        <el-timeline-item
          v-for="item in filteredLifecycle"
          :key="item.id"
          :type="stageType(item.stage)"
          :timestamp="fmtDateTime(item.occurred_at)"
          placement="top"
        >
          <div class="timeline-head">
            <b>{{ item.action }}</b>
            <el-tag size="small" effect="plain">{{ item.stage }}</el-tag>
            <span class="muted">操作人 {{ item.operator }}</span>
          </div>
          <div class="muted">{{ item.detail ?? '-' }}</div>
        </el-timeline-item>
      </el-timeline>
      <EmptyState v-if="selectedAssetId && !filteredLifecycle.length" description="该资产暂无符合筛选条件的生命周期记录" />
      <EmptyState v-if="!selectedAssetId && !lifecycleLoading" description="请选择资产查看生命周期时间线" />
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { EChartsOption } from 'echarts';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import ChartBox from '@/components/ChartBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';
import {
  getAssetLifecycle,
  getAssetStats,
  getAssets,
  type AssetLifecycleItem,
  type AssetRow,
  type AssetStats,
} from '@/api/asset';
import { fmtDateTime, fmtPercent } from '@/utils/format';

const STAGES = [
  { stage: '采集', tone: 'primary' as const, icon: 'Download' },
  { stage: '存储', tone: 'info' as const, icon: 'Coin' },
  { stage: '使用', tone: 'success' as const, icon: 'View' },
  { stage: '共享', tone: 'warning' as const, icon: 'Share' },
  { stage: '销毁', tone: 'danger' as const, icon: 'Delete' },
];

const loading = ref(false);
const stats = ref<AssetStats | null>(null);
const assetOptions = ref<AssetRow[]>([]);
const assetLoading = ref(false);

const selectedAssetId = ref<number | null>(null);
const stageFilter = ref('');
const lifecycle = ref<AssetLifecycleItem[]>([]);
const lifecycleLoading = ref(false);

const selectedAsset = computed(() => assetOptions.value.find((a) => a.id === selectedAssetId.value) ?? null);

const stageMap = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {};
  for (const item of stats.value?.stageDistribution ?? []) map[item.name] = item.value;
  return map;
});

const totalAssets = computed(() => stats.value?.total ?? 0);
const totalRecords = computed(() =>
  (stats.value?.stageDistribution ?? []).reduce((sum, item) => sum + item.value, 0),
);

function stageCount(stage: string): number {
  return Number(stageMap.value[stage] ?? 0);
}

function stageRate(stage: string): number {
  if (!totalAssets.value) return 0;
  return Math.round((stageCount(stage) / totalAssets.value) * 1000) / 10;
}

function stageType(stage: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  if (stage === '采集') return 'primary';
  if (stage === '存储') return 'info';
  if (stage === '使用') return 'success';
  if (stage === '共享') return 'warning';
  return 'danger';
}

const filteredLifecycle = computed(() => {
  if (!stageFilter.value) return lifecycle.value;
  return lifecycle.value.filter((item) => item.stage === stageFilter.value);
});

function countByStage(stage: string): number {
  return lifecycle.value.filter((item) => item.stage === stage).length;
}

const coveredCount = computed(() => STAGES.filter((s) => countByStage(s.stage) > 0).length);

const stageBarOption = computed<EChartsOption>(() => ({
  grid: { left: 8, right: 16, top: 16, bottom: 6, containLabel: true },
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  xAxis: {
    type: 'category',
    data: (stats.value?.stageDistribution ?? []).map((d) => d.name),
    axisLine: { lineStyle: { color: '#dbe4f0' } },
    axisLabel: { color: '#4a5b73', fontSize: 12 },
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    splitLine: { lineStyle: { color: '#eef2f8' } },
    axisLabel: { color: '#8595ad', fontSize: 11 },
  },
  series: [{
    type: 'bar',
    barWidth: 26,
    data: (stats.value?.stageDistribution ?? []).map((d) => d.value),
    itemStyle: { borderRadius: [4, 4, 0, 0], color: '#3b82f6' },
    label: { show: true, position: 'top', color: '#64748b', fontSize: 11 },
  }],
}));

const STAGE_COLORS = ['#1f6feb', '#38bdf8', '#16a34a', '#d97706', '#dc2626'];

const stagePieOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'item' },
  legend: { bottom: 0, icon: 'circle' },
  series: [{
    type: 'pie',
    radius: ['42%', '68%'],
    center: ['50%', '44%'],
    itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
    label: { formatter: '{b}\n{c} 项', fontSize: 12, color: '#4a5b73' },
    data: (stats.value?.stageDistribution ?? []).map((d, i) => ({
      ...d,
      itemStyle: { color: STAGE_COLORS[i] },
    })),
  }],
}));

async function loadAll(): Promise<void> {
  loading.value = true;
  try {
    const [statRes, assetRes] = await Promise.all([
      getAssetStats(),
      getAssets({ page: 1, pageSize: 100 }),
    ]);
    stats.value = statRes.data;
    assetOptions.value = assetRes.data;
    if (!selectedAssetId.value && assetOptions.value.length) {
      selectedAssetId.value = assetOptions.value[0].id;
      await loadLifecycle();
    }
  } finally {
    loading.value = false;
  }
}

async function loadLifecycle(): Promise<void> {
  if (!selectedAssetId.value) {
    lifecycle.value = [];
    return;
  }
  lifecycleLoading.value = true;
  try {
    const res = await getAssetLifecycle(selectedAssetId.value);
    lifecycle.value = res.data;
  } finally {
    lifecycleLoading.value = false;
  }
}

onMounted(loadAll);
</script>

<style scoped>
.filter-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.asset-brief { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: #f7f9fd; border-radius: 10px; padding: 10px 14px; }
.timeline { padding-left: 4px; }
.timeline-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 2px; }
</style>
