<template>
  <section class="page risk-events">
    <PageHeader title="风险事件" subtitle="智能风险监测 · 风险事件全量台账与处置闭环">
      <el-button :loading="loading" icon="Refresh" @click="load">刷新</el-button>
      <el-tag type="info" effect="plain">待处置 {{ pendingCount }} 起</el-tag>
    </PageHeader>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" :model="query" @submit.prevent>
        <el-form-item label="风险级别">
          <el-select v-model="query.level" clearable placeholder="全部级别" style="width: 130px">
            <el-option v-for="l in LEVELS" :key="l" :label="l" :value="l" />
          </el-select>
        </el-form-item>
        <el-form-item label="处置状态">
          <el-select v-model="query.status" clearable placeholder="全部状态" style="width: 130px">
            <el-option v-for="s in STATUSES" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="事件类型">
          <el-select v-model="query.eventType" clearable placeholder="全部类型" style="width: 140px">
            <el-option v-for="t in EVENT_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="query.keyword" clearable placeholder="事件编号/账号/IP/资产/规则" style="width: 230px" />
        </el-form-item>
        <el-form-item label="发生时间">
          <el-date-picker
            v-model="query.dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" icon="Search" @click="reload">查询</el-button>
          <el-button icon="RefreshLeft" @click="resetQuery">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="content-card">
      <template #header>
        <div class="section-title">
          <span>风险事件列表</span>
          <span class="sub">共 {{ total }} 条 · 数据范围：{{ auth.user?.dataScope === 'ALL' ? '全平台' : auth.user?.dataScope === 'DEPT' ? '本部门' : '仅本人' }}</span>
        </div>
      </template>

      <el-table
        v-loading="loading"
        :data="rows"
        stripe
        data-testid="risk-event-table"
        row-key="id"
        @row-click="openDetail"
      >
        <el-table-column label="事件编号" width="150">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title mono">{{ row.event_no }}</span>
              <span class="sub">{{ row.rule_code ?? '无规则' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="事件类型 / 关联资产" min-width="200">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.event_type }}</span>
              <span class="sub">{{ row.asset_name ?? '未关联资产' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="级别" width="80">
          <template #default="{ row }"><StatusTag :value="row.level" /></template>
        </el-table-column>
        <el-table-column label="状态" width="92">
          <template #default="{ row }"><StatusTag :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="操作账号 / IP" min-width="160">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.username }}</span>
              <span class="sub mono">{{ row.ip ?? '-' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="归属部门" width="120">
          <template #default="{ row }">{{ row.dept_name ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="occurred_at" label="发生时间" width="165" />
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="openDetail(row)">详情</el-button>
            <el-button link type="warning" :disabled="!canOperate(row)" @click.stop="openHandle(row)">处置</el-button>
            <el-button link type="info" :disabled="!canOperate(row)" @click.stop="doIgnore(row)">忽略</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState description="暂无符合条件的风险事件" />
        </template>
      </el-table>

      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="load"
        @size-change="reload"
      />
    </el-card>

    <!-- 详情抽屉：基础信息 + 关联事件 + 溯源链路 -->
    <DetailDrawer v-model="drawer" :title="detail ? `风险事件详情 · ${detail.event_no}` : '风险事件详情'" width="720px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <div class="detail-flex">
            <StatusTag :value="detail.level" />
            <StatusTag :value="detail.status" />
            <el-tag size="small" effect="plain">{{ detail.event_type }}</el-tag>
            <span class="muted">{{ fmtDateTime(detail.occurred_at) }}</span>
          </div>

          <div class="detail-grid mt-12">
            <div class="detail-item"><span class="k">事件编号</span><span class="v mono">{{ detail.event_no }}</span></div>
            <div class="detail-item"><span class="k">监测规则</span><span class="v">{{ detail.rule_name ?? '-' }}（{{ detail.rule_code ?? '-' }}）</span></div>
            <div class="detail-item"><span class="k">操作账号</span><span class="v">{{ detail.username }}（{{ detail.dept_name ?? '未知部门' }}）</span></div>
            <div class="detail-item"><span class="k">来源 IP</span><span class="v mono">{{ detail.ip ?? '-' }}</span></div>
            <div class="detail-item"><span class="k">终端设备</span><span class="v">{{ detail.device ?? '-' }}</span></div>
            <div class="detail-item"><span class="k">登录地点</span><span class="v">{{ detail.location ?? '-' }}</span></div>
            <div class="detail-item"><span class="k">关联资产</span><span class="v">{{ detail.asset_name ?? '未关联资产' }}</span></div>
            <div class="detail-item"><span class="k">资产级别</span><span class="v">{{ detail.asset_level ?? '-' }}</span></div>
            <div class="detail-item"><span class="k">处置人</span><span class="v">{{ detail.handled_by ?? '-' }}</span></div>
            <div class="detail-item"><span class="k">处置时间</span><span class="v">{{ detail.handled_at ?? '-' }}</span></div>
            <div class="detail-item span-2"><span class="k">处置意见</span><span class="v">{{ detail.handle_note ?? '-' }}</span></div>
            <div class="detail-item span-2"><span class="k">事件详情</span><span class="v">{{ detail.detail }}</span></div>
          </div>

          <el-divider content-position="left">关联事件（同 IP / 同账号）</el-divider>
          <el-table :data="detail.related" size="small" max-height="220">
            <el-table-column prop="event_no" label="事件编号" width="140" />
            <el-table-column prop="event_type" label="类型" width="100" />
            <el-table-column label="级别" width="72">
              <template #default="{ row }"><StatusTag :value="row.level" /></template>
            </el-table-column>
            <el-table-column label="状态" width="86">
              <template #default="{ row }"><StatusTag :value="row.status" /></template>
            </el-table-column>
            <el-table-column prop="occurred_at" label="发生时间" min-width="150" />
            <template #empty><EmptyState description="暂无关联事件" /></template>
          </el-table>

          <el-divider content-position="left">
            溯源链路
            <el-button link type="primary" size="small" :loading="traceLoading" class="ml-8" @click="loadTrace">
              {{ trace ? '重新分析' : '开始溯源' }}
            </el-button>
          </el-divider>
          <div v-if="trace" class="trace-box">
            <el-timeline>
              <el-timeline-item type="danger" :timestamp="trace.event.occurred_at" placement="top">
                <b>风险事件触发</b>
                <div class="muted">{{ trace.event.event_no }} · {{ trace.event.event_type }} · {{ trace.event.level }}</div>
              </el-timeline-item>
              <el-timeline-item type="warning" :timestamp="trace.account?.last_login_at ?? '-'" placement="top">
                <b>涉事账号</b>
                <div class="muted">
                  {{ trace.account ? `${trace.account.real_name}（${trace.account.username}）· ${trace.account.dept_name ?? '未知部门'} · 角色 ${trace.account.roles.map((r) => r.role_name).join('、') || '-'}` : '账号不存在或已注销' }}
                </div>
              </el-timeline-item>
              <el-timeline-item type="primary" placement="top">
                <b>关联数据资产</b>
                <div class="muted">{{ trace.asset ? `${trace.asset.asset_name}（${trace.asset.asset_code}）· ${trace.asset.data_level}级 · ${trace.asset.source_system}` : '未关联资产' }}</div>
              </el-timeline-item>
              <el-timeline-item type="info" :timestamp="`共 ${trace.auditLogs.length} 条`" placement="top">
                <b>账号 / IP 最近审计日志</b>
                <div class="trace-logs">
                  <div v-for="log in trace.auditLogs" :key="log.id" class="trace-log-line">
                    <span class="mono">{{ fmtDateTime(log.created_at) }}</span>
                    <span>{{ log.username }} · {{ log.action }}</span>
                    <span class="muted mono">{{ log.ip ?? '-' }}</span>
                    <el-tag size="small" :type="log.result === '成功' ? 'success' : 'danger'">{{ log.result }}</el-tag>
                  </div>
                  <EmptyState v-if="!trace.auditLogs.length" description="暂无审计日志" />
                </div>
              </el-timeline-item>
              <el-timeline-item type="danger" :timestamp="`共 ${trace.sameIp.length} 条`" placement="top">
                <b>同 IP / 同网段其他事件</b>
                <div class="trace-log-line" v-for="e in trace.sameIp" :key="e.id">
                  <el-tag size="small" :type="e.match_type === '同IP' ? 'danger' : 'info'">{{ e.match_type }}</el-tag>
                  <span class="mono">{{ e.event_no }}</span>
                  <span>{{ e.event_type }}</span>
                  <span class="muted">{{ e.occurred_at }}</span>
                </div>
                <EmptyState v-if="!trace.sameIp.length" description="暂无同 IP 关联事件" />
              </el-timeline-item>
            </el-timeline>
            <div class="muted">链路生成时间：{{ trace.generatedAt }}</div>
          </div>
          <el-alert v-else type="info" :closable="false" show-icon title="点击「开始溯源」可查看该事件到账号、资产、审计日志与同 IP 事件的完整链路" />
        </template>
        <EmptyState v-else description="暂无事件详情" />
      </div>

      <template #footer>
        <el-button @click="drawer = false">关闭</el-button>
        <el-button :disabled="!detail || !canOperate(detail)" type="warning" @click="detail && openHandle(detail)">处置</el-button>
        <el-button :disabled="!detail || !canOperate(detail)" type="info" @click="detail && doIgnore(detail)">忽略</el-button>
      </template>
    </DetailDrawer>

    <!-- 处置弹窗 -->
    <el-dialog v-model="handleDialog" title="处置风险事件" width="520px" :close-on-click-modal="false">
      <div v-if="handleTarget" class="handle-target">
        <span class="mono">{{ handleTarget.event_no }}</span>
        <span>{{ handleTarget.event_type }}</span>
        <StatusTag :value="handleTarget.level" />
        <StatusTag :value="handleTarget.status" />
      </div>
      <el-form label-width="90px" class="mt-12">
        <el-form-item label="处置状态">
          <el-radio-group v-model="handleForm.status">
            <el-radio value="处置中">处置中</el-radio>
            <el-radio value="已处置">已处置</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="处置意见">
          <el-input
            v-model="handleForm.note"
            type="textarea"
            :rows="4"
            maxlength="255"
            show-word-limit
            placeholder="请填写处置意见，例如：已确认账号异常登录，已封禁账号并通知责任人"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="handleDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitHandle">确认处置</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';
import DetailDrawer from '@/components/DetailDrawer.vue';
import {
  getEventDetail,
  getEvents,
  getTrace,
  handleEvent,
  ignoreEvent,
  type RiskEventDetail,
  type RiskEventRow,
  type RiskTrace,
} from '@/api/risk';
import { useAuthStore } from '@/stores/auth';
import { fmtDateTime } from '@/utils/format';

const auth = useAuthStore();

const LEVELS = ['紧急', '高', '中', '低'];
const STATUSES = ['待处置', '处置中', '已处置', '已忽略'];
const EVENT_TYPES = ['越权访问', '批量导出', '异常登录', '数据篡改', '敏感外传'];

const rows = ref<RiskEventRow[]>([]);
const total = ref(0);
const loading = ref(false);
const pendingCount = computed(() => rows.value.filter((r) => r.status === '待处置').length);

const query = reactive({
  page: 1,
  pageSize: 10,
  level: '',
  status: '',
  eventType: '',
  keyword: '',
  dateRange: [] as string[],
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await getEvents({
      page: query.page,
      pageSize: query.pageSize,
      level: query.level || undefined,
      status: query.status || undefined,
      eventType: query.eventType || undefined,
      keyword: query.keyword.trim() || undefined,
      start: query.dateRange?.[0] || undefined,
      end: query.dateRange?.[1] || undefined,
    });
    rows.value = res.data;
    total.value = res.meta?.total ?? res.data.length;
  } finally {
    loading.value = false;
  }
}

function reload(): void {
  query.page = 1;
  load();
}

function resetQuery(): void {
  Object.assign(query, { page: 1, level: '', status: '', eventType: '', keyword: '', dateRange: [] });
  load();
}

/* ============================ 详情抽屉 ============================ */

const drawer = ref(false);
const detailLoading = ref(false);
const detail = ref<RiskEventDetail | null>(null);

const trace = ref<RiskTrace | null>(null);
const traceLoading = ref(false);

async function openDetail(rawRow: unknown): Promise<void> {
  const row = rawRow as RiskEventRow;
  drawer.value = true;
  detail.value = null;
  trace.value = null;
  detailLoading.value = true;
  try {
    const res = await getEventDetail(row.id);
    detail.value = res.data;
  } finally {
    detailLoading.value = false;
  }
}

async function refreshDetail(): Promise<void> {
  if (!detail.value) return;
  const res = await getEventDetail(detail.value.id);
  detail.value = res.data;
}

async function loadTrace(): Promise<void> {
  if (!detail.value) return;
  traceLoading.value = true;
  try {
    const res = await getTrace(detail.value.id);
    trace.value = res.data;
  } finally {
    traceLoading.value = false;
  }
}

/* ============================ 处置 / 忽略 ============================ */

const handleDialog = ref(false);
const submitting = ref(false);
const handleTarget = ref<RiskEventRow | null>(null);
const handleForm = reactive<{ status: '处置中' | '已处置'; note: string }>({ status: '已处置', note: '' });

function canOperate(rawRow: unknown): boolean {
  const row = rawRow as RiskEventRow | null;
  if (!row) return false;
  return auth.canWrite('risk') && (row.status === '待处置' || row.status === '处置中');
}

function openHandle(rawRow: unknown): void {
  const row = rawRow as RiskEventRow;
  handleTarget.value = row;
  handleForm.status = '已处置';
  handleForm.note = '';
  handleDialog.value = true;
}

async function submitHandle(): Promise<void> {
  if (!handleTarget.value) return;
  submitting.value = true;
  try {
    const target = handleTarget.value;
    await handleEvent(target.id, { status: handleForm.status, note: handleForm.note.trim() || undefined });
    ElMessage.success(`事件 ${target.event_no} 处置成功`);
    handleDialog.value = false;
    await load();
    if (drawer.value && detail.value && detail.value.id === target.id) await refreshDetail();
  } finally {
    submitting.value = false;
  }
}

async function doIgnore(rawRow: unknown): Promise<void> {
  const row = rawRow as RiskEventRow;
  let note = '';
  try {
    const res = await ElMessageBox.prompt('请填写忽略原因（可留空）', `忽略风险事件 ${row.event_no}`, {
      confirmButtonText: '确认忽略',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '例如：业务已确认误报 / 重复告警，已合并处理',
    });
    note = res.value ?? '';
  } catch {
    return; // 用户取消
  }
  await ignoreEvent(row.id, { note: note.trim() || undefined });
  ElMessage.success(`事件 ${row.event_no} 已忽略`);
  await load();
  if (drawer.value && detail.value && detail.value.id === row.id) await refreshDetail();
}

onMounted(load);
</script>

<style scoped>
.detail-flex { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.trace-box { background: #fbfdff; border: 1px dashed var(--ds-border); border-radius: 10px; padding: 14px 16px 2px; }
.trace-logs { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.trace-log-line { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #3d4f6a; padding: 3px 0; border-bottom: 1px dashed #eef2f8; }
.trace-log-line:last-child { border-bottom: none; }
.handle-target { display: flex; align-items: center; gap: 8px; background: #f7f9fd; border-radius: 8px; padding: 10px 12px; color: #23324a; }
.ml-8 { margin-left: 8px; }
:deep(.el-form-item__label) { color: #4a5b73; }
</style>
