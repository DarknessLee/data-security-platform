<template>
  <div class="page">
    <PageHeader title="备份管理" subtitle="全量 / 增量备份记录、校验和与执行结果">
      <el-button type="primary" :disabled="!auth.canWrite('ops')" :loading="backingUp" @click="startBackup">立即备份</el-button>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="备份总数" :value="summary.total" unit="次" tone="primary" icon="Files" hint="含全量与增量" />
      <StatCard label="成功备份" :value="summary.success" unit="次" tone="success" icon="CircleCheck" />
      <StatCard label="失败备份" :value="summary.failed" unit="次" :tone="summary.failed > 0 ? 'danger' : 'success'" icon="CircleClose" :hint="summary.failed > 0 ? '存在失败记录，请检查存储与网络' : '暂无失败记录'" />
      <StatCard label="备份成功率" :value="summary.successRate" unit="%" :tone="summary.successRate >= 95 ? 'success' : 'warning'" icon="DataLine" :hint="`最近备份 ${lastBackup?.started_at ?? '-'}`" />
    </div>

    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <el-form inline @submit.prevent>
          <el-form-item label="状态">
            <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 130px" @change="search">
              <el-option v-for="s in STATUS_OPTIONS" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
          <el-form-item label="类型">
            <el-select v-model="query.backup_type" placeholder="全部类型" clearable style="width: 130px" @change="search">
              <el-option v-for="t in TYPE_OPTIONS" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button @click="reset">重置</el-button>
          </el-form-item>
        </el-form>
      </div>
      <el-table v-loading="loading" :data="rows" row-key="id" stripe>
        <el-table-column prop="backup_no" label="备份编号" width="150">
          <template #default="{ row }"><span class="mono">{{ row.backup_no }}</span></template>
        </el-table-column>
        <el-table-column prop="backup_type" label="类型" width="70" />
        <el-table-column prop="scope" label="备份范围" width="100" show-overflow-tooltip />
        <el-table-column label="大小" width="90">
          <template #default="{ row }">{{ sizeText(row.size_mb) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }"><StatusTag :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="存储路径" min-width="150" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono">{{ row.storage_path }}</span></template>
        </el-table-column>
        <el-table-column label="校验和" width="120">
          <template #default="{ row }">
            <el-tooltip :content="row.checksum" placement="top">
              <span class="mono checksum">{{ shortChecksum(row.checksum) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="开始时间" width="150">
          <template #default="{ row }"><span class="mono">{{ fmtDateTime(row.started_at) }}</span></template>
        </el-table-column>
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">{{ durationText(row.started_at, row.finished_at) }}</template>
        </el-table-column>
        <el-table-column prop="operator" label="操作人" width="90" show-overflow-tooltip />
      </el-table>
      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="load"
          @size-change="search"
        />
      </div>
    </el-card>

    <div class="grid-2">
      <ChartBox title="备份状态分布" :option="pieOption" :height="300" :loading="loading" />
      <ChartBox title="最近备份容量（MB）" :option="sizeOption" :height="300" :loading="loading" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { EChartsOption } from 'echarts';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import ChartBox from '@/components/ChartBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { fmtDateTime, fmtNumber } from '@/utils/format';
import {
  createBackup,
  getBackups,
  type BackupRow,
  type BackupSummary,
} from '@/api/ops';

const STATUS_OPTIONS = ['成功', '失败', '进行中'];
const TYPE_OPTIONS = ['全量', '增量'];

const auth = useAuthStore();

const loading = ref(false);
const backingUp = ref(false);
const rows = ref<BackupRow[]>([]);
const chartRows = ref<BackupRow[]>([]);
const total = ref(0);
const summary = ref<BackupSummary>({ total: 0, success: 0, failed: 0, running: 0, successRate: 0 });
const query = reactive({ page: 1, pageSize: 10, status: '', backup_type: '' });

const lastBackup = computed(() => rows.value[0] ?? null);

const pieOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'item', formatter: '{b}：{c} 次（{d}%）' },
  legend: { bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: '#7b8aa3', fontSize: 12 } },
  series: [
    {
      name: '备份状态',
      type: 'pie',
      radius: ['45%', '68%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#fff', borderWidth: 3 },
      label: { formatter: '{b}\n{c} 次', color: '#4a5b73', fontSize: 12 },
      data: [
        { name: '成功', value: summary.value.success, itemStyle: { color: '#16a34a' } },
        { name: '失败', value: summary.value.failed, itemStyle: { color: '#ef4444' } },
        { name: '进行中', value: summary.value.running, itemStyle: { color: '#1f6feb' } },
      ].filter((d) => d.value > 0),
    },
  ],
}));

const sizeOption = computed<EChartsOption>(() => {
  const list = chartRows.value.slice(0, 12);
  return {
    grid: { left: 8, right: 16, top: 20, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${v} MB` },
    xAxis: { type: 'category', data: list.map((b) => b.backup_no.slice(-8)), axisLine: { lineStyle: { color: '#dbe4f0' } }, axisLabel: { color: '#8595ad', fontSize: 11, rotate: 30 } },
    yAxis: { type: 'value', axisLabel: { color: '#8595ad', fontSize: 11 }, splitLine: { lineStyle: { color: '#eef2f8' } } },
    series: [
      {
        name: '备份大小',
        type: 'bar',
        barWidth: 16,
        data: list.map((b) => Number(b.size_mb)),
        itemStyle: { borderRadius: [4, 4, 0, 0], color: (p: { dataIndex: number }) => (list[p.dataIndex]?.status === '失败' ? '#ef4444' : '#1f6feb') },
      },
    ],
  };
});

function sizeText(mb: string | number): string {
  const n = Number(mb);
  if (!Number.isFinite(n)) return '-';
  return n >= 1024 ? `${(n / 1024).toFixed(2)} GB` : `${fmtNumber(n, 1)} MB`;
}

function shortChecksum(checksum: string): string {
  if (!checksum) return '-';
  const hash = checksum.replace(/^sha256:/, '');
  return `${hash.slice(0, 10)}…`;
}

function durationText(start: string, end: string | null): string {
  if (!end) return '进行中';
  const s = new Date(start.replace(' ', 'T')).getTime();
  const e = new Date(end.replace(' ', 'T')).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return '-';
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec} 秒`;
  return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const params: Record<string, unknown> = { page: query.page, pageSize: query.pageSize };
    if (query.status) params.status = query.status;
    if (query.backup_type) params.backup_type = query.backup_type;
    const [list, chart] = await Promise.all([getBackups(params), getBackups({ page: 1, pageSize: 30 })]);
    rows.value = list.data;
    total.value = list.meta?.total ?? list.data.length;
    const metaSummary = list.meta?.summary as BackupSummary | undefined;
    if (metaSummary) summary.value = metaSummary;
    chartRows.value = chart.data;
  } finally {
    loading.value = false;
  }
}

function search(): void {
  query.page = 1;
  load();
}

function reset(): void {
  query.status = '';
  query.backup_type = '';
  query.page = 1;
  load();
}

async function startBackup(): Promise<void> {
  try {
    await ElMessageBox.confirm('将对全库执行一次全量备份并生成校验和，确认立即开始？', '立即备份', {
      type: 'warning',
      confirmButtonText: '开始备份',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  backingUp.value = true;
  try {
    const res = await createBackup({ backup_type: '全量', scope: '全库' });
    ElMessage.success(`备份 ${res.data.backup_no} 执行成功`);
    query.page = 1;
    await load();
  } finally {
    backingUp.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; }
.pager { display: flex; justify-content: flex-end; margin-top: 14px; }
.checksum { color: #5b6c85; cursor: default; }
</style>
