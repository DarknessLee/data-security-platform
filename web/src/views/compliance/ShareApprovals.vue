<template>
  <div class="page">
    <PageHeader title="共享审批" subtitle="数据共享申请在线审批，通过后自动通知申请人与审批人并留痕">
      <el-button :loading="loading" @click="refresh">刷新</el-button>
      <el-button type="primary" :disabled="!auth.canWrite('compliance')" @click="openCreate">
        <el-icon><Plus /></el-icon>
        发起共享申请
      </el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="待审批" :value="statOf('待审批')" unit="单" tone="warning" icon="Stamp" hint="等待审批人处理" />
      <StatCard label="已通过" :value="statOf('已通过')" unit="单" tone="success" icon="CircleCheck" hint="审批通过并完成通知" />
      <StatCard label="已驳回" :value="statOf('已驳回')" unit="单" tone="danger" icon="CircleClose" hint="审批未通过" />
      <StatCard label="已撤回" :value="statOf('已撤回')" unit="单" tone="info" icon="RefreshLeft" hint="申请人主动撤回" />
    </div>

    <el-card shadow="never" class="content-card">
      <template #header>
        <div class="section-title">
          <span>待审批共享申请</span>
          <span class="sub">共 {{ pendingTotal }} 单待处理</span>
        </div>
      </template>

      <el-table :data="pendingRows" v-loading="loading" row-key="id">
        <el-table-column prop="approval_no" label="审批单号" width="128" />
        <el-table-column label="申请资产" min-width="190">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.asset_name ?? '-' }}</span>
              <span class="sub">{{ row.asset_code ?? '-' }} · {{ row.asset_level ?? '-' }}级</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="申请人 / 部门" width="140">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.applicant_name }}</span>
              <span class="sub">{{ row.applicant_dept ?? '-' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="receiver" label="数据接收方" width="140" show-overflow-tooltip />
        <el-table-column prop="purpose" label="共享用途" min-width="180" show-overflow-tooltip />
        <el-table-column prop="share_way" label="共享方式" width="110" />
        <el-table-column label="风险等级" width="100">
          <template #default="{ row }"><StatusTag :value="row.risk_level" kind="risk" /></template>
        </el-table-column>
        <el-table-column prop="created_at" label="申请时间" width="165" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="success" :disabled="!auth.canWrite('compliance')" @click="approve(row as unknown as ApprovalRow)">通过</el-button>
            <el-button link type="danger" :disabled="!auth.canWrite('compliance')" @click="reject(row as unknown as ApprovalRow)">驳回</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="content-card">
      <template #header>
        <div class="section-title">
          <span>历史记录</span>
          <span class="sub">全部共享申请审批流水</span>
        </div>
      </template>

      <el-form :inline="true" class="mb-12" @submit.prevent>
        <el-form-item label="审批状态">
          <el-select v-model="filters.status" clearable placeholder="全部状态" style="width: 140px" @change="search">
            <el-option v-for="item in STATUS_OPTIONS" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="filters.keyword" placeholder="单号 / 资产 / 接收方" clearable style="width: 220px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="historyRows" v-loading="historyLoading" row-key="id">
        <el-table-column prop="approval_no" label="审批单号" width="128" />
        <el-table-column label="申请资产" min-width="180">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.asset_name ?? '-' }}</span>
              <span class="sub">{{ row.asset_code ?? '-' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="applicant_name" label="申请人" width="100" />
        <el-table-column prop="receiver" label="接收方" width="140" show-overflow-tooltip />
        <el-table-column prop="purpose" label="共享用途" min-width="160" show-overflow-tooltip />
        <el-table-column label="风险等级" width="100">
          <template #default="{ row }"><StatusTag :value="row.risk_level" kind="risk" /></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><StatusTag :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="审批人" width="110">
          <template #default="{ row }">{{ row.approver ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="审批时间" width="165">
          <template #default="{ row }">{{ row.approved_at ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="comment" label="审批意见" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.comment ?? '-' }}</template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="historyTotal"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        class="mt-16"
        @current-change="loadHistory"
        @size-change="onSizeChange"
      />
    </el-card>

    <el-dialog v-model="dialogVisible" title="发起数据共享申请" width="560px">
      <el-form :model="form" label-width="96px">
        <el-form-item label="共享资产" required>
          <el-select v-model="form.asset_id" filterable placeholder="选择数据资产" style="width: 100%">
            <el-option
              v-for="asset in assets"
              :key="asset.id"
              :label="`${asset.asset_name}（${asset.asset_code} · ${asset.data_level}）`"
              :value="asset.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="数据接收方" required>
          <el-input v-model="form.receiver" placeholder="接收方单位 / 系统名称" maxlength="64" />
        </el-form-item>
        <el-form-item label="共享用途" required>
          <el-input v-model="form.purpose" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="说明共享用途与使用范围" />
        </el-form-item>
        <el-form-item label="共享方式" required>
          <el-radio-group v-model="form.share_way">
            <el-radio v-for="item in SHARE_WAYS" :key="item" :value="item">{{ item }}</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" :disabled="!auth.canWrite('compliance')" @click="submit">提交申请</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import {
  approveApproval,
  createApproval,
  getApprovalAssets,
  getApprovals,
  type ApprovalRow,
  type AssetOption,
  type NameValue,
} from '@/api/compliance';

const auth = useAuthStore();

const STATUS_OPTIONS = ['待审批', '已通过', '已驳回', '已撤回'];
const SHARE_WAYS = ['接口', '文件', '数据库直连'];

const loading = ref(false);
const historyLoading = ref(false);
const submitting = ref(false);

const pendingRows = ref<ApprovalRow[]>([]);
const pendingTotal = ref(0);
const stats = ref<NameValue[]>([]);

const historyRows = ref<ApprovalRow[]>([]);
const historyTotal = ref(0);
const filters = reactive({ status: '', keyword: '' });
const pagination = reactive({ page: 1, pageSize: 10 });

const dialogVisible = ref(false);
const assets = ref<AssetOption[]>([]);
const form = reactive({ asset_id: null as number | null, receiver: '', purpose: '', share_way: '接口' });

function statOf(name: string): number {
  return stats.value.find((s) => s.name === name)?.value ?? 0;
}

async function loadPending(): Promise<void> {
  loading.value = true;
  try {
    const res = await getApprovals({ status: '待审批', page: 1, pageSize: 50 });
    pendingRows.value = res.data;
    pendingTotal.value = res.meta?.total ?? res.data.length;
    const statsMeta = res.meta?.stats as NameValue[] | undefined;
    const all = await getApprovals({ page: 1, pageSize: 1 });
    const allStats = all.meta?.stats as NameValue[] | undefined;
    stats.value = allStats ?? statsMeta ?? [];
  } finally {
    loading.value = false;
  }
}

async function loadHistory(): Promise<void> {
  historyLoading.value = true;
  try {
    const res = await getApprovals({
      page: pagination.page,
      pageSize: pagination.pageSize,
      status: filters.status || undefined,
      keyword: filters.keyword || undefined,
    });
    historyRows.value = res.data;
    historyTotal.value = res.meta?.total ?? 0;
    const statsMeta = res.meta?.stats as NameValue[] | undefined;
    if (statsMeta) stats.value = statsMeta;
  } finally {
    historyLoading.value = false;
  }
}

async function refresh(): Promise<void> {
  await Promise.all([loadPending(), loadHistory()]);
}

function search(): void {
  pagination.page = 1;
  loadHistory();
}

function reset(): void {
  filters.status = '';
  filters.keyword = '';
  search();
}

function onSizeChange(): void {
  pagination.page = 1;
  loadHistory();
}

async function openCreate(): Promise<void> {
  form.asset_id = null;
  form.receiver = '';
  form.purpose = '';
  form.share_way = '接口';
  dialogVisible.value = true;
  if (!assets.value.length) {
    const res = await getApprovalAssets();
    assets.value = res.data;
  }
}

async function submit(): Promise<void> {
  if (!form.asset_id) {
    ElMessage.warning('请选择共享资产');
    return;
  }
  if (!form.receiver.trim() || !form.purpose.trim()) {
    ElMessage.warning('请填写数据接收方与共享用途');
    return;
  }
  submitting.value = true;
  try {
    const res = await createApproval({
      asset_id: form.asset_id,
      receiver: form.receiver.trim(),
      purpose: form.purpose.trim(),
      share_way: form.share_way,
    });
    ElMessage.success(`共享申请已提交，审批单号 ${res.data.approval.approval_no}`);
    dialogVisible.value = false;
    await refresh();
  } finally {
    submitting.value = false;
  }
}

async function approve(row: ApprovalRow): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      `确认通过共享申请「${row.approval_no}」（${row.asset_name ?? '-'} → ${row.receiver}）？可通过填写审批意见。`,
      '审批通过',
      {
        confirmButtonText: '确认通过',
        cancelButtonText: '取消',
        type: 'warning',
        inputPlaceholder: '审批意见（可选）',
        inputType: 'textarea',
        inputValidator: () => true,
      },
    );
    await approveApproval(row.id, { approved: true, comment: value || '同意共享，请按审批范围使用' });
    ElMessage.success(`审批单 ${row.approval_no} 已通过`);
    await refresh();
  } catch {
    /* 用户取消或请求失败，均无需额外处理 */
  }
}

async function reject(row: ApprovalRow): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      `确认驳回共享申请「${row.approval_no}」？请填写驳回理由。`,
      '驳回申请',
      {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        type: 'warning',
        inputPlaceholder: '驳回理由（必填）',
        inputValidator: (input: string) => (input && input.trim() ? true : '请填写驳回理由'),
      },
    );
    await approveApproval(row.id, { approved: false, comment: value.trim() });
    ElMessage.success(`审批单 ${row.approval_no} 已驳回`);
    await refresh();
  } catch {
    /* 用户取消或请求失败，均无需额外处理 */
  }
}

onMounted(refresh);
</script>

<style scoped>
.mb-12 { margin-bottom: 12px; }
.filter-card :deep(.el-form-item) { margin-bottom: 0; }
.cell-main { display: flex; flex-direction: column; gap: 2px; }
.cell-main .title { font-weight: 600; color: #23324a; }
.cell-main .sub { font-size: 12px; color: #8595ad; }
</style>
