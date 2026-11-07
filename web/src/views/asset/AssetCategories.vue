<template>
  <section class="page asset-categories">
    <PageHeader title="分类分级" subtitle="数据资产分类体系 · 分级分布与分类资产清单">
      <el-button :loading="loading" icon="Refresh" @click="loadAll">刷新</el-button>
      <el-tag type="info" effect="plain">共 {{ categoryCount }} 个分类</el-tag>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="分类总数" :value="categoryCount" unit="个" icon="FolderOpened" hint="数据资产分类目录" />
      <StatCard label="纳管资产" :value="stats?.total ?? 0" unit="项" icon="Coin" :hint="`覆盖 ${stats?.sourceSystem.length ?? 0} 个来源系统`" />
      <StatCard label="敏感资产" :value="stats?.sensitive ?? 0" unit="项" tone="danger" icon="Lock" :hint="`机密/绝密占比 ${fmtPercent(stats?.sensitiveRate ?? 0)}`" />
      <StatCard label="平均质量分" :value="stats?.avgQualityScore ?? 0" unit="分" tone="success" icon="CircleCheck" hint="资产质量分均值" />
    </div>

    <div class="grid-2">
      <ChartBox title="数据分级分布" :option="levelOption" :height="260" :loading="loading" />
      <ChartBox title="各分类资产数量" :option="categoryOption" :height="260" :loading="loading" />
    </div>

    <div class="grid-1-2">
      <el-card shadow="never" class="content-card">
        <template #header>
          <div class="section-title">
            <span>资产分类树</span>
            <span class="sub">点击分类查看资产</span>
          </div>
        </template>
        <el-tree
          v-loading="loading"
          :data="tree"
          node-key="id"
          default-expand-all
          highlight-current
          :expand-on-click-node="false"
          :props="{ label: 'category_name', children: 'children' }"
          class="category-tree"
          @node-click="onSelectNode"
        >
          <template #default="{ data }">
            <div class="tree-node">
              <span class="tree-name">{{ data.category_name }}</span>
              <el-tag size="small" type="info" effect="plain">{{ data.assetCount }}</el-tag>
            </div>
          </template>
        </el-tree>
        <EmptyState v-if="!tree.length" description="暂无资产分类" />
      </el-card>

      <el-card shadow="never" class="content-card">
        <template #header>
          <div class="section-title">
            <span>{{ selectedName }} 资产清单</span>
            <span class="sub">共 {{ assetTotal }} 项 · 公开 {{ levelCount('公开') }} / 内部 {{ levelCount('内部') }} / 机密 {{ levelCount('机密') }} / 绝密 {{ levelCount('绝密') }}</span>
          </div>
        </template>

        <el-table v-loading="assetLoading" :data="assets" stripe row-key="id" data-testid="category-asset-table">
          <el-table-column label="资产编号 / 名称" min-width="220">
            <template #default="{ row }">
              <div class="cell-main">
                <span class="title">{{ row.asset_name }}</span>
                <span class="sub mono">{{ row.asset_code }} · {{ row.source_system }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="数据级别" width="90">
            <template #default="{ row }"><StatusTag :value="row.data_level" /></template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }"><StatusTag :value="row.status" /></template>
          </el-table-column>
          <el-table-column label="敏感度" width="90" align="center">
            <template #default="{ row }">
              <span class="score" :class="scoreClass(row.sensitivity_score)">{{ row.sensitivity_score }}</span>
            </template>
          </el-table-column>
          <el-table-column label="存储" width="100">
            <template #default="{ row }">{{ fmtSizeGb(row.size_gb) }}</template>
          </el-table-column>
          <el-table-column prop="owner" label="责任人" width="100" />
          <el-table-column label="最近访问" width="165">
            <template #default="{ row }"><span class="muted">{{ fmtDateTime(row.last_access_at) }}</span></template>
          </el-table-column>
          <template #empty>
            <EmptyState description="该分类下暂无资产" />
          </template>
        </el-table>

        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="assetTotal"
          :page-sizes="[10, 20, 50]"
          layout="total, prev, pager, next"
          @current-change="loadAssets"
        />
      </el-card>
    </div>
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
  getAssetCategories,
  getAssetStats,
  getAssets,
  type AssetCategoryNode,
  type AssetRow,
  type AssetStats,
} from '@/api/asset';
import { fmtDateTime, fmtPercent, fmtSizeGb } from '@/utils/format';

const LEVEL_COLORS = ['#38bdf8', '#60a5fa', '#f59e0b', '#ef4444'];

const loading = ref(false);
const stats = ref<AssetStats | null>(null);
const tree = ref<AssetCategoryNode[]>([]);
const categoryCount = ref(0);

const selectedId = ref<number | null>(null);
const selectedName = ref('全部资产');
const levelCounts = ref<Record<string, number>>({});
const assets = ref<AssetRow[]>([]);
const assetTotal = ref(0);
const assetLoading = ref(false);
const page = ref(1);
const pageSize = ref(10);

function scoreClass(score: number): string {
  if (score >= 80) return 'text-danger';
  if (score >= 60) return 'text-warning';
  return 'text-success';
}

function levelCount(level: string): number {
  return Number(levelCounts.value[level] ?? 0);
}

const levelOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'item' },
  legend: { bottom: 0, icon: 'circle' },
  series: [{
    type: 'pie',
    radius: ['46%', '70%'],
    center: ['50%', '44%'],
    itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
    label: { formatter: '{b}\n{c} 项', fontSize: 12, color: '#4a5b73' },
    data: (stats.value?.levelDistribution ?? []).map((d, i) => ({
      ...d,
      itemStyle: { color: LEVEL_COLORS[i] },
    })),
  }],
}));

const categoryOption = computed<EChartsOption>(() => {
  const roots = tree.value;
  return {
    grid: { left: 8, right: 28, top: 10, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#eef2f8' } },
      axisLabel: { color: '#8595ad', fontSize: 11 },
    },
    yAxis: {
      type: 'category',
      data: roots.map((c) => c.category_name).reverse(),
      axisLine: { lineStyle: { color: '#dbe4f0' } },
      axisLabel: { color: '#4a5b73', fontSize: 11 },
    },
    series: [{
      type: 'bar',
      barWidth: 14,
      itemStyle: { color: '#3b82f6', borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', color: '#64748b', fontSize: 11 },
      data: roots.map((c) => c.assetCount).reverse(),
    }],
  };
});

async function loadAll(): Promise<void> {
  loading.value = true;
  try {
    const [catRes, statRes] = await Promise.all([getAssetCategories(), getAssetStats()]);
    tree.value = catRes.data.tree;
    categoryCount.value = catRes.data.categoryCount;
    stats.value = statRes.data;
    if (!selectedId.value && tree.value.length) {
      selectCategory(tree.value[0]);
    }
    await loadAssets();
  } finally {
    loading.value = false;
  }
}

function selectCategory(node: AssetCategoryNode): void {
  selectedId.value = node.id;
  selectedName.value = node.category_name;
  levelCounts.value = node.levelCounts;
  page.value = 1;
}

function onSelectNode(data: AssetCategoryNode): void {
  selectCategory(data);
  void loadAssets();
}

async function loadAssets(): Promise<void> {
  assetLoading.value = true;
  try {
    const res = await getAssets({
      page: page.value,
      pageSize: pageSize.value,
      categoryId: selectedId.value ?? undefined,
    });
    assets.value = res.data;
    assetTotal.value = res.meta?.total ?? res.data.length;
    if (!selectedId.value) levelCounts.value = {};
  } finally {
    assetLoading.value = false;
  }
}

onMounted(loadAll);
</script>

<style scoped>
.category-tree { padding: 2px 0; }
.tree-node { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding-right: 8px; }
.tree-name { font-size: 13px; color: #23324a; }
.score { font-weight: 700; font-variant-numeric: tabular-nums; }
</style>
