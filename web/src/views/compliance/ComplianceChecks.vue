<template>
  <div class="page">
    <PageHeader title="合规检查" subtitle="按批次执行合规规则检查，跟踪通过率与不符合项证据">
      <el-button :loading="loading" @click="refresh">刷新</el-button>
      <el-button type="primary" :loading="running" :disabled="!auth.canWrite('compliance')" @click="run">
        <el-icon><VideoPlay /></el-icon>
        <span>立即执行检查</span>
      </el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="当前批次通过率" :value="currentBatch?.rate ?? 0" unit="%" tone="success" icon="DocumentChecked" :hint="filters.batchNo || '全部批次'" />
      <StatCard label="通过项" :value="currentBatch?.passed ?? 0" unit="项" tone="primary" icon="CircleCheck" />
      <StatCard label="警告项" :value="currentBatch?.warning ?? 0" unit="项" tone="warning" icon="Warning" />
      <StatCard label="不通过项" :value="currentBatch?.failed ?? 0" unit="项" tone="danger" icon="CircleClose" />
      <StatCard label="累计检查批次" :value="batches.length" unit="批" tone="info" icon="Files" />
    </div>

    <ChartBox title="批次通过率趋势" :option="trendOption" :height="250" />

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="检查批次">
          <el-select v-model="filters.batchNo" clearable placeholder="全部批次" style="width: 190px" @change="search">
            <el-option v-for="b in batches" :key="b.batch_no" :label="`${b.batch_no}（${b.rate}%）`" :value="b.batch_no" />
          </el-select>
        </el-form-item>
        <el-form-item label="检查结果">
          <el-select v-model="filters.result" clearable placeholder="全部结果" style="width: 130px" @change="search">
            <el-option v-for="item in RESULT_OPTIONS" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="content-card">
      <template #header>
        <div class="section-title">
          <span>检查结果明细</span>
          <span class="sub">共 {{ total }} 条记录</span>
        </div>
      </template>

      <el-table :data="checks" v-loading="loading" row-key="id">
        <el-table-column prop="rule_code" label="规则编号" width="108" />
        <el-table-column label="规则名称" min-width="240">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.rule_title }}</span>
              <span class="sub">{{ row.basis }} · {{ row.category }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="target" label="检查对象" min-width="150" show-overflow-tooltip />
        <el-table-column label="检查结果" width="100">
          <template #default="{ row }"><StatusTag :value="row.result" /></template>
        </el-table-column>
        <el-table-column prop="score" label="得分" width="80" />
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">{{ row.duration_ms }} ms</template>
        </el-table-column>
        <el-table-column prop="checked_at" label="检查时间" width="165" />
        <el-table-column label="操作" width="88" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row as unknown as ComplianceCheck)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        class="mt-16"
        @current-change="loadChecks"
        @size-change="onSizeChange"
      />
    </el-card>

    <DetailDrawer v-model="drawerVisible" title="检查结果详情" width="640px">
      <div v-if="detail" v-loading="detailLoading" class="detail-body">
        <div class="detail-grid">
          <div class="detail-item"><span class="k">规则编号</span><span class="v mono">{{ detail.check.rule_code }}</span></div>
          <div class="detail-item"><span class="k">检查批次</span><span class="v mono">{{ detail.check.batch_no }}</span></div>
          <div class="detail-item span-2"><span class="k">规则标题</span><span class="v">{{ detail.check.rule_title }}</span></div>
          <div class="detail-item"><span class="k">合规依据</span><span class="v">{{ detail.check.basis }}</span></div>
          <div class="detail-item"><span class="k">规则分类</span><span class="v">{{ detail.check.category }}</span></div>
          <div class="detail-item"><span class="k">风险等级</span><span class="v"><StatusTag :value="detail.check.risk_level" /></span></div>
          <div class="detail-item"><span class="k">检查结果</span><span class="v"><StatusTag :value="detail.check.result" /></span></div>
          <div class="detail-item"><span class="k">得分</span><span class="v">{{ detail.check.score }}</span></div>
          <div class="detail-item"><span class="k">检查对象</span><span class="v">{{ detail.check.target }}</span></div>
          <div class="detail-item"><span class="k">检查耗时</span><span class="v">{{ detail.check.duration_ms }} ms</span></div>
          <div class="detail-item"><span class="k">检查时间</span><span class="v">{{ detail.check.checked_at }}</span></div>
          <div class="detail-item"><span class="k">检查方式</span><span class="v">{{ detail.rule.check_method }}</span></div>
        </div>

        <div class="section-title mt-16"><span>规则原文</span></div>
        <div class="text-block">{{ detail.rule.requirement }}</div>

        <div class="section-title mt-16"><span>检查证据</span></div>
        <el-alert :title="detail.check.evidence" :type="evidenceType" :closable="false" show-icon />

        <div class="section-title mt-16">
          <span>同批次检查结果</span>
          <span class="sub">批次 {{ detail.check.batch_no }} · 通过率 {{ detail.batch?.rate ?? '-' }}%</span>
        </div>
        <el-table :data="detail.sameBatch" size="small" max-height="240">
          <el-table-column prop="rule_code" label="规则编号" width="100" />
          <el-table-column prop="rule_title" label="规则标题" min-width="180" show-overflow-tooltip />
          <el-table-column label="结果" width="90">
            <template #default="{ row }"><StatusTag :value="row.result" /></template>
          </el-table-column>
          <el-table-column prop="score" label="得分" width="70" />
        </el-table>
      </div>
      <el-empty v-else description="暂无检查详情" />
      <template #footer>
        <el-button @click="drawerVisible = false">关闭</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { EChartsOption } from 'echarts';
import { VideoPlay } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import ChartBox from '@/components/ChartBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import DetailDrawer from '@/components/DetailDrawer.vue';
import { useAuthStore } from '@/stores/auth';
import {
  getBatches,
  getCheckDetail,
  getChecks,
  runChecks,
  type BatchStat,
  type CheckDetail,
  type ComplianceCheck,
} from '@/api/compliance';

const auth = useAuthStore();

const RESULT_OPTIONS = ['通过', '警告', '不通过'];

const batches = ref<BatchStat[]>([]);
const checks = ref<ComplianceCheck[]>([]);
const total = ref(0);
const loading = ref(false);
const running = ref(false);

const filters = reactive({ batchNo: '', result: '' });
const pagination = reactive({ page: 1, pageSize: 10 });

const currentBatch = computed(() => batches.value.find((b) => b.batch_no === filters.batchNo) ?? null);
const totalChecks = computed(() => batches.value.reduce((sum, b) => sum + b.total, 0));

const drawerVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<CheckDetail | null>(null);

const evidenceType = computed<'success' | 'warning' | 'error'>(() => {
  const result = detail.value?.check.result;
  if (result === '不通过') return 'error';
  if (result === '警告') return 'warning';
  return 'success';
});

const trendOption = computed<EChartsOption>(() => {
  const list = [...batches.value].reverse();
  return {
    grid: { left: 8, right: 20, top: 20, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${v}%` },
    xAxis: {
      type: 'category',
      data: list.map((b) => b.batch_no),
      axisLine: { lineStyle: { color: '#dbe4f0' } },
      axisLabel: { color: '#8595ad', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { formatter: '{value}%', color: '#8595ad', fontSize: 11 },
      splitLine: { lineStyle: { color: '#eef2f8' } },
    },
    series: [{
      name: '通过率',
      type: 'line',
      smooth: true,
      symbolSize: 8,
      data: list.map((b) => b.rate),
      itemStyle: { color: '#16a34a' },
      lineStyle: { width: 3 },
      areaStyle: { color: 'rgba(22,163,74,0.10)' },
      markLine: { silent: true, symbol: 'none', data: [{ yAxis: 90 }], lineStyle: { color: '#f59e0b', type: 'dashed' } },
    }],
  };
});

async function loadBatches(): Promise<void> {
  const res = await getBatches();
  batches.value = res.data;
  if (!filters.batchNo && res.data.length) filters.batchNo = res.data[0].batch_no;
}

async function loadChecks(): Promise<void> {
  loading.value = true;
  try {
    const res = await getChecks({
      page: pagination.page,
      pageSize: pagination.pageSize,
      batchNo: filters.batchNo || undefined,
      result: filters.result || undefined,
    });
    checks.value = res.data;
    total.value = res.meta?.total ?? 0;
  } finally {
    loading.value = false;
  }
}

async function refresh(): Promise<void> {
  await Promise.all([loadBatches(), loadChecks()]);
}

function search(): void {
  pagination.page = 1;
  loadChecks();
}

function reset(): void {
  filters.batchNo = batches.value[0]?.batch_no ?? '';
  filters.result = '';
  search();
}

function onSizeChange(): void {
  pagination.page = 1;
  loadChecks();
}

async function run(): Promise<void> {
  running.value = true;
  try {
    const res = await runChecks();
    const data = res.data;
    ElMessage.success(`检查完成：批次 ${data.batchNo}，通过 ${data.passed}/${data.total}，通过率 ${data.rate}%`);
    await loadBatches();
    filters.batchNo = data.batchNo;
    pagination.page = 1;
    await loadChecks();
  } finally {
    running.value = false;
  }
}

async function openDetail(row: ComplianceCheck): Promise<void> {
  drawerVisible.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    const res = await getCheckDetail(row.id);
    detail.value = res.data;
  } finally {
    detailLoading.value = false;
  }
}

onMounted(refresh);
</script>

<style scoped>
.filter-card :deep(.el-form-item) { margin-bottom: 0; }
.cell-main { display: flex; flex-direction: column; gap: 2px; }
.cell-main .title { font-weight: 600; color: #23324a; }
.cell-main .sub { font-size: 12px; color: #8595ad; }
.detail-body { display: flex; flex-direction: column; }
.text-block { background: #f7fafd; border: 1px solid #e9eef6; border-radius: 10px; padding: 12px 14px; font-size: 13px; line-height: 1.7; color: #3d4f6a; }
</style>