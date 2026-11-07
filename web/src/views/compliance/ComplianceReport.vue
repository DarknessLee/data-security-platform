<template>
  <div class="page">
    <PageHeader title="合规报告" subtitle="按检查批次汇总通过率、维度分布、不通过清单与整改跟踪，支持导出与打印">
      <el-select v-model="batchNo" placeholder="选择批次" style="width: 200px" @change="load">
        <el-option v-for="b in batches" :key="b.batch_no" :label="`${b.batch_no}（通过率 ${b.rate}%）`" :value="b.batch_no" />
      </el-select>
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-button :disabled="!report" @click="exportFails">
        <el-icon><Download /></el-icon>
        导出不通过清单
      </el-button>
      <el-button :disabled="!report" @click="print">
        <el-icon><Printer /></el-icon>
        打印
      </el-button>
    </PageHeader>

    <template v-if="report">
      <div class="stat-grid">
        <StatCard label="本批次检查项" :value="report.summary.total" unit="项" tone="primary" icon="Document" :hint="report.batchNo" />
        <StatCard label="通过" :value="report.summary.passed" unit="项" tone="success" icon="CircleCheck" />
        <StatCard label="警告" :value="report.summary.warning" unit="项" tone="warning" icon="Warning" />
        <StatCard label="不通过" :value="report.summary.failed" unit="项" tone="danger" icon="CircleClose" />
        <StatCard label="通过率" :value="report.summary.rate.toFixed(1)" unit="%" tone="info" icon="DataLine" />
      </div>

      <el-card shadow="never" class="content-card">
        <div class="section-title">
          <span>批次概览</span>
          <span class="sub">生成时间 {{ report.generatedAt }}</span>
        </div>
        <div class="stat-grid compact">
          <StatCard label="合规规则总数" :value="report.summary.cards.ruleTotal" unit="条" tone="primary" />
          <StatCard label="启用规则" :value="report.summary.cards.ruleEnabled" unit="条" tone="success" />
          <StatCard label="检查批次数" :value="report.summary.cards.checkBatches" unit="批" tone="info" />
          <StatCard label="整改闭环率" :value="report.summary.cards.closeRate.toFixed(1)" unit="%" tone="warning" />
          <StatCard label="待审批共享" :value="report.summary.cards.pendingApprovals" unit="单" tone="danger" />
          <StatCard label="脱敏规则" :value="report.summary.cards.maskingTotal" unit="条" tone="info" />
        </div>
      </el-card>

      <div class="grid-2">
        <el-card shadow="never" class="content-card">
          <ChartBox title="各合规分类检查结果分布" :option="categoryOption" :height="280" />
        </el-card>
        <el-card shadow="never" class="content-card">
          <ChartBox title="各合规依据检查结果分布" :option="basisOption" :height="280" />
        </el-card>
      </div>

      <el-card shadow="never" class="content-card">
        <template #header>
          <div class="section-title">
            <span>不通过清单</span>
            <span class="sub">共 {{ report.fails.length }} 项需重点整改</span>
          </div>
        </template>
        <el-table :data="report.fails" row-key="id" empty-text="本批次无检查不通过项">
          <el-table-column prop="rule_code" label="规则编号" width="110" />
          <el-table-column label="规则标题" min-width="240">
            <template #default="{ row }">
              <div class="cell-main">
                <span class="title">{{ row.rule_title }}</span>
                <span class="sub">{{ row.category }} · {{ row.basis }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="target" label="检查对象" min-width="150" show-overflow-tooltip />
          <el-table-column label="评分" width="90">
            <template #default="{ row }"><span class="text-danger">{{ row.score }}</span></template>
          </el-table-column>
          <el-table-column prop="evidence" label="检查证据" min-width="260" show-overflow-tooltip />
          <el-table-column prop="checked_at" label="检查时间" width="165" />
        </el-table>
      </el-card>

      <el-card shadow="never" class="content-card">
        <template #header>
          <div class="section-title">
            <span>整改跟踪</span>
            <span class="sub">关联未闭环整改单 {{ report.rectify.length }} 项</span>
          </div>
        </template>
        <el-table :data="report.rectify" row-key="id" empty-text="暂无关联整改单">
          <el-table-column prop="rectify_no" label="整改单号" width="128" />
          <el-table-column label="整改事项" min-width="240">
            <template #default="{ row }">
              <div class="cell-main">
                <span class="title">{{ row.title }}</span>
                <span class="sub">{{ row.rule_code ?? '-' }} · {{ row.rule_title ?? '未关联规则' }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="owner" label="责任人" width="100" />
          <el-table-column prop="due_date" label="整改期限" width="115" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }"><StatusTag :value="row.status" /></template>
          </el-table-column>
          <el-table-column label="进度" width="170">
            <template #default="{ row }">
              <el-progress :percentage="row.progress" :stroke-width="8" />
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <el-card v-else v-loading="loading" shadow="never" class="content-card">
      <EmptyState description="暂无可用的合规报告数据" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Download, Printer } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import type { EChartsOption } from 'echarts';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import ChartBox from '@/components/ChartBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';
import { getBatches, getReport, type BatchStat, type ComplianceReport, type ReportGroup } from '@/api/compliance';

const batches = ref<BatchStat[]>([]);
const batchNo = ref('');
const report = ref<ComplianceReport | null>(null);
const loading = ref(false);

function groupOption(groups: ReportGroup[], rotate = 0): EChartsOption {
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: '#5b6b84', fontSize: 12 } },
    grid: { left: 8, right: 16, top: 24, bottom: 34, containLabel: true },
    xAxis: {
      type: 'category',
      data: groups.map((g) => g.name),
      axisLabel: { color: '#8595ad', fontSize: 12, rotate, interval: 0 },
      axisLine: { lineStyle: { color: '#dbe4f0' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '项',
      nameTextStyle: { color: '#8595ad' },
      axisLabel: { color: '#8595ad' },
      splitLine: { lineStyle: { color: '#eef2f8' } },
    },
    series: [
      { name: '通过', type: 'bar', stack: 'total', barWidth: 22, itemStyle: { color: '#3ecf8e' }, data: groups.map((g) => g.passed) },
      { name: '警告', type: 'bar', stack: 'total', itemStyle: { color: '#f7b955' }, data: groups.map((g) => g.warning) },
      { name: '不通过', type: 'bar', stack: 'total', itemStyle: { color: '#ef4444' }, data: groups.map((g) => g.failed) },
    ],
  };
}

const categoryOption = computed<EChartsOption>(() => groupOption(report.value?.byCategory ?? []));
const basisOption = computed<EChartsOption>(() => groupOption(report.value?.byBasis ?? [], report.value && report.value.byBasis.length > 3 ? 12 : 0));

async function loadBatches(): Promise<void> {
  const res = await getBatches();
  batches.value = res.data;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await getReport(batchNo.value || undefined);
    report.value = res.data;
    batchNo.value = res.data.batchNo;
  } finally {
    loading.value = false;
  }
}

function exportFails(): void {
  if (!report.value) return;
  const header = ['规则编号', '规则标题', '合规依据', '合规分类', '检查对象', '评分', '检查证据', '检查时间'];
  const lines = report.value.fails.map((row) =>
    [row.rule_code, row.rule_title, row.basis, row.category, row.target, row.score, row.evidence, row.checked_at]
      .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
      .join(','),
  );
  const csv = `\uFEFF${header.join(',')}\r\n${lines.join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `合规报告-${report.value.batchNo}-不通过清单.csv`;
  link.click();
  URL.revokeObjectURL(url);
  ElMessage.success('不通过清单已导出');
}

function print(): void {
  window.print();
}

onMounted(async () => {
  await loadBatches();
  await load();
});
</script>

<style scoped>
.stat-grid.compact { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.cell-main { display: flex; flex-direction: column; gap: 2px; }
.cell-main .title { font-weight: 600; color: #23324a; }
.cell-main .sub { font-size: 12px; color: #8595ad; }
</style>
