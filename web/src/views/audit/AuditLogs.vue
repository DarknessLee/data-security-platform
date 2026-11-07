<template>
  <div class="page">
    <PageHeader
      title="审计日志"
      :subtitle="`共 ${total} 条审计记录 · 今日 ${cards.todayLogs} 条 · 失败 ${cards.todayFail} 条 · 数据生成时间 ${overview?.generatedAt ?? '-'}`"
    >
      <el-button :icon="Refresh" :loading="loading" @click="loadAll">刷新</el-button>
      <el-button :icon="CircleCheck" @click="checkIntegrity">完整性校验</el-button>
      <el-button type="primary" :icon="Download" :loading="exporting" @click="exportCsv">导出 CSV</el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="今日日志量" :value="cards.todayLogs" unit="条" icon="Tickets" hint="登录 / 访问 / 操作 / 接口" />
      <StatCard label="今日失败操作" :value="cards.todayFail" unit="条" tone="danger" icon="Warning" :hint="`失败率 ${cards.failRate}%`" />
      <StatCard label="日志总量" :value="cards.totalLogs" unit="条" tone="success" icon="Files" :hint="`近 7 天活跃账号 ${cards.activeUsers} 个`" />
      <StatCard label="活跃账号（近 7 天）" :value="cards.activeUsers" unit="个" tone="info" icon="User" hint="账号维度 TOP5 见右侧卡片" />
      <StatCard label="审计报表" :value="cards.reportCount" unit="份" tone="primary" icon="Document" hint="日报 / 周报 / 月报 / 年报" />
      <StatCard
        label="哈希链状态"
        :value="chainText"
        tone="info"
        icon="Lock"
        :hint="integrity ? `已校验 ${integrity.checked} 条 · 链头 ${shortHash(integrity.headHash)}` : '点击上方完整性校验'"
      />
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" :model="filters" @submit.prevent>
        <el-form-item label="日志类型">
          <el-select v-model="filters.logType" placeholder="全部类型" clearable style="width: 150px" @change="applyFilters">
            <el-option v-for="t in LOG_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="结果">
          <el-select v-model="filters.result" placeholder="全部结果" clearable style="width: 120px" @change="applyFilters">
            <el-option label="成功" value="成功" />
            <el-option label="失败" value="失败" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input
            v-model="filters.keyword"
            placeholder="账号 / 动作 / IP"
            clearable
            style="width: 200px"
            @keyup.enter="applyFilters"
            @clear="applyFilters"
          />
        </el-form-item>
        <el-form-item label="时间范围">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            unlink-panels
            style="width: 260px"
            @change="applyFilters"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="applyFilters">查询</el-button>
          <el-button :icon="RefreshLeft" @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <div class="grid-3">
      <ChartBox title="今日日志类型分布" :option="typeOption" :height="220" :loading="loading" />
      <ChartBox title="近 7 天日志趋势" :option="trendOption" :height="220" :loading="loading" />
      <el-card shadow="never" class="content-card">
        <template #header>
          <div class="section-title"><span>异常 IP TOP5</span><span class="sub">近 7 天失败 / 4xx 以上</span></div>
        </template>
        <div class="rank-list">
          <div v-for="(item, index) in overview?.topIps ?? []" :key="item.ip ?? index" class="rank-line">
            <span class="rank-no" :class="{ top: index === 0 }">{{ index + 1 }}</span>
            <span class="rank-name mono">{{ item.ip ?? '-' }}</span>
            <span class="rank-value">{{ item.fail }} / {{ item.total }}</span>
          </div>
          <EmptyState v-if="!overview?.topIps?.length" description="暂无异常 IP" />
        </div>
      </el-card>
    </div>

    <el-card shadow="never" class="content-card">
      <template #header>
        <div class="section-title">
          <span>审计日志明细</span>
          <span class="sub">按发生时间倒序 · 当前筛选共 {{ total }} 条</span>
        </div>
      </template>
      <el-table v-loading="loading" :data="logs" size="default" @row-click="openDetail">
        <el-table-column prop="created_at" label="发生时间" width="165" />
        <el-table-column label="日志类型" width="105">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="typeTag(row.log_type)">{{ row.log_type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="username" label="操作账号" width="110" />
        <el-table-column label="动作 / 资源" min-width="175">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.action }}</span>
              <span class="sub">{{ row.resource ?? '-' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="请求接口 / IP" min-width="210">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title mono">{{ row.method ?? '-' }} {{ row.path ?? '-' }}</span>
              <span class="sub mono">{{ row.ip ?? '-' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态码" width="85" align="center">
          <template #default="{ row }">
            <span :class="Number(row.status_code) >= 400 ? 'text-danger' : 'text-success'">{{ row.status_code }}</span>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="80" align="center">
          <template #default="{ row }"><StatusTag :value="row.result" /></template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState description="暂无符合条件的审计日志" />
        </template>
      </el-table>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="loadLogs"
        @size-change="handleSizeChange"
      />
    </el-card>

    <DetailDrawer v-model="detailVisible" :title="`审计日志详情 #${detail?.record.id ?? ''}`" width="640px">
      <div v-if="detailLoading" v-loading="true" class="drawer-loading" />
      <template v-else-if="detail">
        <div class="verify-banner" :class="detail.verified ? 'ok' : 'bad'">
          <el-icon :size="26">
            <CircleCheckFilled v-if="detail.verified" />
            <CircleCloseFilled v-else />
          </el-icon>
          <div class="verify-text">
            <b>{{ detail.verified ? '完整性校验通过' : '完整性校验未通过' }}</b>
            <span>SHA-256 链式摘要与数据库实时重建结果{{ detail.verified ? '完全一致，日志未被篡改' : '不一致，日志可能被篡改' }}</span>
          </div>
          <StatusTag :value="detail.verified ? '通过' : '失败'" />
        </div>

        <div class="section-title mt-16"><span>日志字段</span><span class="sub">audit_log #{{ detail.record.id }}</span></div>
        <div class="detail-grid">
          <div class="detail-item"><span class="k">发生时间</span><span class="v mono">{{ detail.record.created_at }}</span></div>
          <div class="detail-item"><span class="k">日志类型</span><span class="v">{{ detail.record.log_type }}</span></div>
          <div class="detail-item"><span class="k">操作账号</span><span class="v">{{ detail.record.username }}</span></div>
          <div class="detail-item"><span class="k">执行结果</span><span class="v"><StatusTag :value="detail.record.result" /></span></div>
          <div class="detail-item"><span class="k">动作</span><span class="v">{{ detail.record.action }}</span></div>
          <div class="detail-item"><span class="k">资源类型</span><span class="v">{{ detail.record.resource ?? '-' }}</span></div>
          <div class="detail-item"><span class="k">请求方法</span><span class="v mono">{{ detail.record.method ?? '-' }}</span></div>
          <div class="detail-item"><span class="k">状态码</span><span class="v mono">{{ detail.record.status_code }}</span></div>
          <div class="detail-item"><span class="k">请求路径</span><span class="v mono">{{ detail.record.path ?? '-' }}</span></div>
          <div class="detail-item"><span class="k">来源 IP</span><span class="v mono">{{ detail.record.ip ?? '-' }}</span></div>
          <div class="detail-item span-2"><span class="k">User-Agent</span><span class="v mono">{{ detail.record.user_agent ?? '-' }}</span></div>
          <div class="detail-item span-2"><span class="k">详情描述</span><span class="v">{{ detail.record.detail ?? '-' }}</span></div>
        </div>

        <div class="section-title mt-16"><span>哈希链校验</span><span class="sub">SHA-256(prevHash + id + log_type + username + action + created_at)</span></div>
        <div class="hash-chain">
          <div class="hash-node">
            <span class="k">前序摘要 prevHash</span>
            <code>{{ detail.prevHash }}</code>
          </div>
          <div class="hash-arrow">→</div>
          <div class="hash-node current">
            <span class="k">当前摘要 hash</span>
            <code>{{ detail.hash }}</code>
          </div>
        </div>
      </template>
    </DetailDrawer>

    <el-dialog v-model="integrityVisible" title="审计日志不可篡改校验" width="680px">
      <div v-if="integrity">
        <div class="verify-banner" :class="integrity.chainValid ? 'ok' : 'bad'">
          <el-icon :size="26">
            <CircleCheckFilled v-if="integrity.chainValid" />
            <CircleCloseFilled v-else />
          </el-icon>
          <div class="verify-text">
            <b>{{ integrity.chainValid ? '哈希链完整，未发现篡改' : `发现 ${integrity.broken.length} 处链上异常` }}</b>
            <span>{{ integrity.algorithm }} · 已校验 {{ integrity.checked }} / {{ integrity.total }} 条</span>
          </div>
          <StatusTag :value="integrity.chainValid ? '通过' : '失败'" />
        </div>
        <div class="detail-grid mt-16">
          <div class="detail-item"><span class="k">校验时间</span><span class="v mono">{{ integrity.verifiedAt }}</span></div>
          <div class="detail-item"><span class="k">校验条数</span><span class="v mono">{{ integrity.checked }} / {{ integrity.total }}</span></div>
          <div class="detail-item span-2"><span class="k">链头摘要 headHash</span><span class="v mono break">{{ integrity.headHash }}</span></div>
        </div>
        <el-table v-if="integrity.broken.length" :data="integrity.broken" size="small" class="mt-12">
          <el-table-column prop="id" label="日志 ID" width="100" />
          <el-table-column prop="reason" label="异常原因" />
        </el-table>
        <p v-else class="integrity-tip">
          <el-icon><CircleCheck /></el-icon>
          逐条按 id 升序重建 SHA-256 链式摘要，所有记录均与当前库内容一致。
        </p>
      </div>
      <template #footer>
        <el-button @click="integrityVisible = false">关闭</el-button>
        <el-button type="primary" :icon="Refresh" @click="checkIntegrity">重新校验</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { EChartsOption } from 'echarts';
import {
  CircleCheck,
  CircleCheckFilled,
  CircleCloseFilled,
  Download,
  Refresh,
  RefreshLeft,
  Search,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import ChartBox from '@/components/ChartBox.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';
import DetailDrawer from '@/components/DetailDrawer.vue';
import {
  exportAuditLogs,
  getAuditIntegrity,
  getAuditLogDetail,
  getAuditLogs,
  getAuditOverview,
  type AuditIntegrity,
  type AuditLogDetail,
  type AuditLogRow,
  type AuditOverview,
} from '@/api/audit';

const LOG_TYPES = ['登录日志', '访问日志', '操作日志', '接口日志'];
const DEFAULT_CARDS = {
  todayLogs: 0,
  todayFail: 0,
  failRate: 0,
  totalLogs: 0,
  activeUsers: 0,
  reportCount: 0,
};

const overview = ref<AuditOverview | null>(null);
const integrity = ref<AuditIntegrity | null>(null);
const logs = ref<AuditLogRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const loading = ref(false);
const exporting = ref(false);
const integrityVisible = ref(false);

const filters = reactive({ logType: '', result: '', keyword: '' });
const dateRange = ref<[string, string] | null>(null);

const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<AuditLogDetail | null>(null);

const cards = computed(() => overview.value?.cards ?? DEFAULT_CARDS);
const chainText = computed(() => {
  if (!integrity.value) return '待校验';
  return integrity.value.chainValid ? '完整' : '异常';
});

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
  yAxis: {
    type: 'value',
    minInterval: 1,
    splitLine: { lineStyle: { color: '#eef2f8' } },
    axisLabel: { color: '#8595ad', fontSize: 11 },
  },
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

function typeTag(value: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  if (value === '登录日志') return 'primary';
  if (value === '访问日志') return 'success';
  if (value === '操作日志') return 'warning';
  if (value === '接口日志') return 'info';
  return 'primary';
}

function shortHash(hash: string | null | undefined): string {
  if (!hash) return '-';
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function buildQuery(): { logType?: string; result?: string; keyword?: string; start?: string; end?: string } {
  const query: { logType?: string; result?: string; keyword?: string; start?: string; end?: string } = {};
  if (filters.logType) query.logType = filters.logType;
  if (filters.result) query.result = filters.result;
  if (filters.keyword.trim()) query.keyword = filters.keyword.trim();
  if (dateRange.value?.length === 2) {
    query.start = dateRange.value[0];
    query.end = dateRange.value[1];
  }
  return query;
}

async function loadOverview(): Promise<void> {
  const res = await getAuditOverview();
  overview.value = res.data;
}

async function loadIntegrity(): Promise<void> {
  const res = await getAuditIntegrity();
  integrity.value = res.data;
}

async function loadLogs(): Promise<void> {
  loading.value = true;
  try {
    const res = await getAuditLogs({ ...buildQuery(), page: page.value, pageSize: pageSize.value });
    logs.value = res.data;
    total.value = res.meta?.total ?? res.data.length;
  } finally {
    loading.value = false;
  }
}

async function loadAll(): Promise<void> {
  await Promise.all([loadOverview(), loadLogs(), loadIntegrity()]);
}

function applyFilters(): void {
  page.value = 1;
  loadLogs();
}

function resetFilters(): void {
  filters.logType = '';
  filters.result = '';
  filters.keyword = '';
  dateRange.value = null;
  page.value = 1;
  loadLogs();
}

function handleSizeChange(): void {
  page.value = 1;
  loadLogs();
}

async function openDetail(row: AuditLogRow | Record<string, unknown>): Promise<void> {
  const log = row as AuditLogRow;
  detail.value = null;
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    const res = await getAuditLogDetail(log.id);
    detail.value = res.data;
  } finally {
    detailLoading.value = false;
  }
}

async function checkIntegrity(): Promise<void> {
  integrityVisible.value = true;
  await loadIntegrity();
  if (integrity.value) {
    ElMessage.success(integrity.value.chainValid ? '哈希链校验通过，日志未被篡改' : '哈希链存在异常，请核查');
  }
}

async function exportCsv(): Promise<void> {
  exporting.value = true;
  try {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const filename = `审计日志_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.csv`;
    await exportAuditLogs(buildQuery(), filename);
    ElMessage.success(`已导出当前筛选的 ${total.value} 条审计日志`);
  } finally {
    exporting.value = false;
  }
}

onMounted(loadAll);
</script>

<style scoped>
.rank-list { display: flex; flex-direction: column; }
.rank-line { display: flex; align-items: center; gap: 10px; padding: 7px 2px; border-bottom: 1px dashed #eef2f8; }
.rank-line:last-child { border-bottom: none; }
.rank-no { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; color: #64748b; background: #eef2f8; flex-shrink: 0; }
.rank-no.top { color: #fff; background: #ef4444; }
.rank-name { flex: 1; font-size: 12.5px; color: #3d4f6a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rank-value { font-size: 12px; color: #8595ad; font-variant-numeric: tabular-nums; }
.drawer-loading { min-height: 280px; }
.verify-banner { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 12px; border: 1px solid #c7f0d4; background: linear-gradient(135deg, #f0fdf4, #ecfdf5); color: #15803d; }
.verify-banner.bad { border-color: #fecaca; background: linear-gradient(135deg, #fef2f2, #fff1f2); color: #b91c1c; }
.verify-text { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.verify-text b { font-size: 14px; }
.verify-text span { font-size: 12px; opacity: 0.85; }
.hash-chain { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: stretch; }
.hash-node { border: 1px solid #e4ebf5; border-radius: 10px; padding: 10px 12px; background: #fbfdff; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.hash-node.current { border-color: #bfdbfe; background: #f5f9ff; }
.hash-node .k { font-size: 11px; color: #8595ad; }
.hash-node code { font-family: 'Cascadia Mono', Consolas, monospace; font-size: 11.5px; color: #1e3a5f; word-break: break-all; line-height: 1.55; }
.hash-arrow { display: grid; place-items: center; color: #93b4e8; font-size: 18px; }
.break { word-break: break-all; }
.integrity-tip { display: flex; align-items: center; gap: 6px; margin: 16px 0 0; padding: 10px 12px; background: #f8fafd; border-radius: 8px; font-size: 12.5px; color: #5b6c85; }
</style>
