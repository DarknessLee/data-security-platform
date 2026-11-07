<template>
  <div class="page">
    <PageHeader title="整改跟踪" subtitle="跟踪合规检查不符合项的整改进度，逾期单据自动标记并高亮">
      <el-button :loading="loading" @click="load">刷新</el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="待整改" :value="statOf('待整改')" unit="单" tone="warning" icon="AlarmClock" hint="尚未启动整改" />
      <StatCard label="整改中" :value="statOf('整改中')" unit="单" tone="primary" icon="Refresh" hint="整改进度进行中" />
      <StatCard label="已逾期" :value="statOf('已逾期')" unit="单" tone="danger" icon="WarningFilled" hint="已超过整改期限" />
      <StatCard label="已闭环" :value="statOf('已闭环')" unit="单" tone="success" icon="CircleCheck" hint="完成整改并归档" />
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="整改状态">
          <el-select v-model="filters.status" clearable placeholder="全部状态" style="width: 140px" @change="search">
            <el-option v-for="item in STATUS_OPTIONS" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="filters.keyword" placeholder="整改单号 / 标题 / 责任人" clearable style="width: 220px" @keyup.enter="search" />
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
          <span>整改单列表</span>
          <span class="sub">共 {{ total }} 单 · 逾期 {{ statOf('已逾期') }} 单</span>
        </div>
      </template>

      <el-table :data="rows" v-loading="loading" row-key="id" :row-class-name="rowClass">
        <el-table-column prop="rectify_no" label="整改单号" width="128" />
        <el-table-column label="整改标题" min-width="240">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.title }}</span>
              <span class="sub">{{ row.rule_code ?? '-' }} · {{ row.rule_title ?? '未关联规则' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="责任人 / 部门" width="150">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.owner }}</span>
              <span class="sub">{{ row.dept_name ?? '-' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="整改期限" width="120">
          <template #default="{ row }">
            <span :class="{ 'text-danger': row.overdue }">{{ row.due_date ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><StatusTag :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="整改进度" width="180">
          <template #default="{ row }">
            <el-progress :percentage="row.progress" :status="progressStatus(row as unknown as RectifyRow)" :stroke-width="8" />
          </template>
        </el-table-column>
        <el-table-column label="闭环时间" width="165">
          <template #default="{ row }">{{ row.closed_at ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="!auth.canWrite('compliance')" @click="openUpdate(row as unknown as RectifyRow)">更新进度</el-button>
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
        @current-change="load"
        @size-change="onSizeChange"
      />
    </el-card>

    <DetailDrawer v-model="drawerVisible" :title="`更新整改进度 · ${current?.rectify_no ?? ''}`" width="560px">
      <el-form v-if="current" label-width="96px">
        <el-form-item label="整改标题">
          <span>{{ current.title }}</span>
        </el-form-item>
        <el-form-item label="整改状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option v-for="item in STATUS_OPTIONS" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="整改进度">
          <el-slider v-model="form.progress" :max="100" :step="5" show-input />
        </el-form-item>
        <el-form-item label="整改措施">
          <el-input v-model="form.measure" type="textarea" :rows="4" maxlength="512" show-word-limit placeholder="记录整改措施、责任人与完成情况" />
        </el-form-item>
        <el-alert
          v-if="form.status === '已闭环' || form.progress >= 100"
          title="提交后整改单将自动闭环并记录闭环时间"
          type="warning"
          :closable="false"
          show-icon
        />
      </el-form>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!auth.canWrite('compliance')" @click="submit">保存</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import StatusTag from '@/components/StatusTag.vue';
import DetailDrawer from '@/components/DetailDrawer.vue';
import { useAuthStore } from '@/stores/auth';
import { getRectifyList, updateRectify, type NameValue, type RectifyRow } from '@/api/compliance';

const auth = useAuthStore();

const STATUS_OPTIONS = ['待整改', '整改中', '已逾期', '已闭环'];

const rows = ref<RectifyRow[]>([]);
const stats = ref<NameValue[]>([]);
const total = ref(0);
const loading = ref(false);
const saving = ref(false);

const filters = reactive({ status: '', keyword: '' });
const pagination = reactive({ page: 1, pageSize: 10 });

const drawerVisible = ref(false);
const current = ref<RectifyRow | null>(null);
const form = reactive({ status: '待整改', progress: 0, measure: '' });

function statOf(name: string): number {
  return stats.value.find((s) => s.name === name)?.value ?? 0;
}

function rowClass({ row }: { row: RectifyRow }): string {
  return row.overdue ? 'row-overdue' : '';
}

function progressStatus(row: RectifyRow): 'success' | 'exception' | undefined {
  if (row.status === '已闭环') return 'success';
  if (row.overdue) return 'exception';
  return undefined;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await getRectifyList({
      page: pagination.page,
      pageSize: pagination.pageSize,
      status: filters.status || undefined,
      keyword: filters.keyword || undefined,
    });
    rows.value = res.data;
    total.value = res.meta?.total ?? 0;
    stats.value = (res.meta?.stats as NameValue[] | undefined) ?? [];
  } finally {
    loading.value = false;
  }
}

function search(): void {
  pagination.page = 1;
  load();
}

function reset(): void {
  filters.status = '';
  filters.keyword = '';
  search();
}

function onSizeChange(): void {
  pagination.page = 1;
  load();
}

function openUpdate(row: RectifyRow): void {
  current.value = row;
  form.status = row.status;
  form.progress = row.progress;
  form.measure = row.measure ?? '';
  drawerVisible.value = true;
}

async function submit(): Promise<void> {
  if (!current.value) return;
  saving.value = true;
  try {
    await updateRectify(current.value.id, { status: form.status, progress: form.progress, measure: form.measure });
    ElMessage.success(`整改单 ${current.value.rectify_no} 已更新`);
    drawerVisible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.filter-card :deep(.el-form-item) { margin-bottom: 0; }
.cell-main { display: flex; flex-direction: column; gap: 2px; }
.cell-main .title { font-weight: 600; color: #23324a; }
.cell-main .sub { font-size: 12px; color: #8595ad; }
:deep(.row-overdue) { background: #fff7f7; }
:deep(.row-overdue:hover > td) { background: #fff1f1 !important; }
</style>
