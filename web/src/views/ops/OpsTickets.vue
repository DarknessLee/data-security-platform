<template>
  <div class="page">
    <PageHeader title="运维工单" subtitle="故障处理 / 安全事件 / 服务咨询 / 变更申请全流程跟踪">
      <el-button type="primary" :disabled="!auth.canWrite('ops')" @click="openCreate">新建工单</el-button>
      <el-button :loading="loading" @click="fetchData">刷新</el-button>
    </PageHeader>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent>
        <el-form-item label="关键字">
          <el-input v-model="query.keyword" placeholder="单号 / 标题 / 描述 / 提单人" clearable style="width: 240px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 130px" @change="search">
            <el-option v-for="s in STATUS_OPTIONS" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="query.category" placeholder="全部分类" clearable style="width: 130px" @change="search">
            <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="query.priority" placeholder="全部优先级" clearable style="width: 120px" @change="search">
            <el-option v-for="p in PRIORITY_OPTIONS" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
      <div v-if="byStatus.length" class="status-summary">
        <span v-for="s in byStatus" :key="s.name" class="chip">{{ s.name }} {{ s.value }}</span>
      </div>
    </el-card>

    <el-card shadow="never" class="content-card">
      <el-table v-loading="loading" :data="rows" row-key="id" stripe>
        <el-table-column prop="ticket_no" label="工单号" width="150">
          <template #default="{ row }"><span class="mono">{{ row.ticket_no }}</span></template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
        <el-table-column prop="category" label="分类" width="100" />
        <el-table-column label="优先级" width="84">
          <template #default="{ row }"><StatusTag :value="row.priority" /></template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }"><StatusTag :value="row.status" /></template>
        </el-table-column>
        <el-table-column prop="reporter" label="提单人" width="84" show-overflow-tooltip />
        <el-table-column label="处理人" width="84">
          <template #default="{ row }">{{ row.assignee || '-' }}</template>
        </el-table-column>
        <el-table-column label="SLA" width="110">
          <template #default="{ row }">
            <span v-if="row.status === '已关闭'" class="text-success">已关闭</span>
            <span v-else-if="row.overdue" class="text-danger">逾期 {{ row.overdue_hours }}h</span>
            <span v-else :class="row.remaining_hours <= 4 ? 'text-warning' : ''">剩余 {{ row.remaining_hours }}h</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }"><span class="mono">{{ fmtDateTime(row.created_at) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="76" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row.id)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="fetchData"
          @size-change="search"
        />
      </div>
    </el-card>

    <DetailDrawer v-model="detailVisible" :title="detail ? `${detail.ticket_no} · ${detail.title}` : '工单详情'" width="640px">
      <template #header-extra>
        <StatusTag v-if="detail" :value="detail.status" />
      </template>
      <div v-if="detail" v-loading="detailLoading">
        <div class="detail-grid">
          <div class="detail-item"><span class="k">分类</span><span class="v">{{ detail.category }}</span></div>
          <div class="detail-item"><span class="k">优先级</span><span class="v">{{ detail.priority }}</span></div>
          <div class="detail-item"><span class="k">提单人</span><span class="v">{{ detail.reporter }}</span></div>
          <div class="detail-item"><span class="k">处理人</span><span class="v">{{ detail.assignee || '-' }}</span></div>
          <div class="detail-item"><span class="k">创建时间</span><span class="v mono">{{ fmtDateTime(detail.created_at) }}</span></div>
          <div class="detail-item"><span class="k">SLA 截止</span><span class="v mono">{{ fmtDateTime(detail.sla_deadline) }}</span></div>
          <div class="detail-item"><span class="k">受理时间</span><span class="v mono">{{ fmtDateTime(detail.accepted_at) }}</span></div>
          <div class="detail-item"><span class="k">关闭时间</span><span class="v mono">{{ fmtDateTime(detail.closed_at) }}</span></div>
          <div class="detail-item"><span class="k">联系方式</span><span class="v">{{ detail.contact || '-' }}</span></div>
          <div class="detail-item"><span class="k">SLA 时限</span><span class="v">{{ detail.sla_hours }} 小时</span></div>
          <div class="detail-item span-2">
            <span class="k">问题描述</span>
            <span class="v text-block">{{ detail.description }}</span>
          </div>
          <div v-if="detail.resolution" class="detail-item span-2">
            <span class="k">处理结果</span>
            <span class="v text-block">{{ detail.resolution }}</span>
          </div>
        </div>

        <div class="section-title">流转轨迹</div>
        <el-timeline class="trace-timeline">
          <el-timeline-item
            v-for="t in detail.traces"
            :key="t.id"
            :timestamp="fmtDateTime(t.created_at)"
            placement="top"
            :type="traceType(t.action)"
          >
            <div class="trace-head">
              <span class="trace-action">{{ t.action }}</span>
              <span class="mono trace-operator">{{ t.operator }}</span>
            </div>
            <p v-if="t.note" class="trace-note">{{ t.note }}</p>
          </el-timeline-item>
          <EmptyState v-if="!detail.traces.length" description="暂无流转记录" />
        </el-timeline>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="nextAction" type="primary" :disabled="!auth.canWrite('ops')" @click="openAction">
          {{ nextAction.label }}
        </el-button>
      </template>
    </DetailDrawer>

    <el-dialog v-model="createVisible" title="新建运维工单" width="560px" destroy-on-close @closed="resetCreateForm">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="90px">
        <el-form-item label="工单标题" prop="title">
          <el-input v-model="createForm.title" maxlength="128" show-word-limit placeholder="简要描述问题现象" />
        </el-form-item>
        <el-form-item label="工单分类" prop="category">
          <el-select v-model="createForm.category" style="width: 100%">
            <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级" prop="priority">
          <el-select v-model="createForm.priority" style="width: 100%">
            <el-option v-for="p in PRIORITY_OPTIONS" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="问题描述" prop="description">
          <el-input v-model="createForm.description" type="textarea" :rows="4" maxlength="1024" show-word-limit placeholder="影响范围、复现步骤、期望结果等（至少 5 个字符）" />
        </el-form-item>
        <el-form-item label="联系方式" prop="contact">
          <el-input v-model="createForm.contact" maxlength="32" placeholder="手机号 / 邮箱 / 分机号" />
        </el-form-item>
        <el-form-item label="SLA 时限" prop="sla_hours">
          <el-input-number v-model="createForm.sla_hours" :min="1" :max="720" :step="1" />
          <span class="form-hint">小时（超时未关闭将在告警与列表中标记逾期）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">提交工单</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="actionVisible" :title="nextAction ? nextAction.label : '流转工单'" width="520px" destroy-on-close>
      <el-form v-if="detail" :model="actionForm" label-width="90px">
        <el-form-item v-if="detail.status === '待受理'" label="处理人">
          <el-input v-model="actionForm.assignee" maxlength="32" placeholder="默认当前用户" />
        </el-form-item>
        <el-form-item label="处理说明">
          <el-input v-model="actionForm.note" type="textarea" :rows="3" maxlength="512" show-word-limit placeholder="记录本次流转的处理说明（可选）" />
        </el-form-item>
        <el-form-item v-if="detail.status === '待验证'" label="处理结果">
          <el-input v-model="actionForm.resolution" type="textarea" :rows="3" maxlength="512" show-word-limit placeholder="填写最终处理结果，关闭工单前必填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="actionVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitAction">确认{{ nextAction?.label }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import DetailDrawer from '@/components/DetailDrawer.vue';
import EmptyState from '@/components/EmptyState.vue';
import { useAuthStore } from '@/stores/auth';
import { fmtDateTime } from '@/utils/format';
import {
  createTicket,
  getTicket,
  getTickets,
  updateTicketStatus,
  type CreateTicketPayload,
  type TicketDetail,
  type TicketRow,
  type TicketStatusPayload,
  type TicketStatGroup,
} from '@/api/ops';

const STATUS_OPTIONS = ['待受理', '处理中', '待验证', '已关闭'];
const CATEGORY_OPTIONS = ['故障处理', '安全事件', '服务咨询', '变更申请'];
const PRIORITY_OPTIONS = ['低', '中', '高', '紧急'];
const NEXT_MAP: Record<string, { status: string; label: string } | undefined> = {
  待受理: { status: '处理中', label: '受理工单' },
  处理中: { status: '待验证', label: '提交验证' },
  待验证: { status: '已关闭', label: '验证通过并关闭' },
};

const auth = useAuthStore();

const loading = ref(false);
const rows = ref<TicketRow[]>([]);
const total = ref(0);
const byStatus = ref<TicketStatGroup[]>([]);
const query = reactive({ page: 1, pageSize: 10, status: '', category: '', priority: '', keyword: '' });

const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<TicketDetail | null>(null);
const nextAction = computed(() => (detail.value ? NEXT_MAP[detail.value.status] : undefined));

const createVisible = ref(false);
const creating = ref(false);
const createFormRef = ref<FormInstance>();
const createForm = reactive<CreateTicketPayload>({ title: '', category: '故障处理', priority: '中', description: '', contact: '', sla_hours: 24 });
const createRules: FormRules = {
  title: [
    { required: true, message: '请输入工单标题', trigger: 'blur' },
    { min: 2, max: 128, message: '标题长度需在 2-128 个字符之间', trigger: 'blur' },
  ],
  category: [{ required: true, message: '请选择工单分类', trigger: 'change' }],
  priority: [{ required: true, message: '请选择优先级', trigger: 'change' }],
  description: [
    { required: true, message: '请填写问题描述', trigger: 'blur' },
    { min: 5, max: 1024, message: '问题描述长度需在 5-1024 个字符之间', trigger: 'blur' },
  ],
  sla_hours: [{ required: true, message: '请设置 SLA 时限', trigger: 'change' }],
};

const actionVisible = ref(false);
const actionLoading = ref(false);
const actionForm = reactive({ note: '', assignee: '', resolution: '' });

function traceType(action: string): 'primary' | 'success' | 'warning' | 'info' {
  if (action === '创建') return 'primary';
  if (action === '受理') return 'warning';
  if (action === '关闭') return 'success';
  return 'info';
}

async function fetchData(): Promise<void> {
  loading.value = true;
  try {
    const params: Record<string, unknown> = { page: query.page, pageSize: query.pageSize };
    if (query.status) params.status = query.status;
    if (query.category) params.category = query.category;
    if (query.priority) params.priority = query.priority;
    if (query.keyword.trim()) params.keyword = query.keyword.trim();
    const res = await getTickets(params);
    rows.value = res.data;
    total.value = res.meta?.total ?? res.data.length;
    byStatus.value = (res.meta?.byStatus as TicketStatGroup[] | undefined) ?? [];
  } finally {
    loading.value = false;
  }
}

function search(): void {
  query.page = 1;
  fetchData();
}

function reset(): void {
  query.status = '';
  query.category = '';
  query.priority = '';
  query.keyword = '';
  query.page = 1;
  fetchData();
}

async function openDetail(id: number): Promise<void> {
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    const res = await getTicket(id);
    detail.value = res.data;
  } finally {
    detailLoading.value = false;
  }
}

function openCreate(): void {
  createVisible.value = true;
}

function resetCreateForm(): void {
  createForm.title = '';
  createForm.category = '故障处理';
  createForm.priority = '中';
  createForm.description = '';
  createForm.contact = '';
  createForm.sla_hours = 24;
  createFormRef.value?.clearValidate();
}

async function submitCreate(): Promise<void> {
  const valid = await createFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  creating.value = true;
  try {
    const payload: CreateTicketPayload = {
      title: createForm.title.trim(),
      category: createForm.category,
      priority: createForm.priority,
      description: createForm.description.trim(),
      sla_hours: createForm.sla_hours,
    };
    if (createForm.contact?.trim()) payload.contact = createForm.contact.trim();
    const res = await createTicket(payload);
    ElMessage.success(`工单 ${res.data.ticket_no} 创建成功`);
    createVisible.value = false;
    query.page = 1;
    await fetchData();
  } finally {
    creating.value = false;
  }
}

function openAction(): void {
  actionForm.note = '';
  actionForm.resolution = '';
  actionForm.assignee = detail.value?.status === '待受理' ? auth.displayName : '';
  actionVisible.value = true;
}

async function submitAction(): Promise<void> {
  const target = detail.value;
  const next = nextAction.value;
  if (!target || !next) return;
  if (next.status === '已关闭' && !actionForm.resolution.trim()) {
    ElMessage.warning('关闭工单前请填写处理结果');
    return;
  }
  actionLoading.value = true;
  try {
    const payload: TicketStatusPayload = { status: next.status };
    if (actionForm.note.trim()) payload.note = actionForm.note.trim();
    if (actionForm.assignee.trim()) payload.assignee = actionForm.assignee.trim();
    if (next.status === '已关闭') payload.resolution = actionForm.resolution.trim();
    const res = await updateTicketStatus(target.id, payload);
    detail.value = res.data;
    actionVisible.value = false;
    ElMessage.success(`工单已${next.label.replace('工单', '')}`);
    await fetchData();
  } finally {
    actionLoading.value = false;
  }
}

onMounted(fetchData);
</script>

<style scoped>
.status-summary { display: flex; gap: 8px; flex-wrap: wrap; padding: 0 2px 2px; }
.pager { display: flex; justify-content: flex-end; margin-top: 14px; }
.text-block { display: block; line-height: 1.7; color: #3d4f68; white-space: pre-wrap; word-break: break-word; }
.trace-timeline { padding-left: 4px; margin-top: 4px; }
.trace-head { display: flex; align-items: center; gap: 10px; }
.trace-action { font-size: 13px; font-weight: 600; color: #1c2c46; }
.trace-operator { font-size: 12px; color: #94a3b8; }
.trace-note { margin: 4px 0 0; font-size: 12px; color: #5b6c85; line-height: 1.6; }
.form-hint { margin-left: 10px; font-size: 12px; color: #94a3b8; }
</style>
