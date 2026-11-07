<template>
  <div class="page">
    <PageHeader title="合规规则库" subtitle="覆盖《数据安全法》《个人信息保护法》与等保 2.0 的合规要求基线">
      <el-button :loading="loading" @click="loadRules">刷新</el-button>
      <el-button type="primary" :disabled="!auth.canWrite('compliance')" @click="openCreate">
        <el-icon><Plus /></el-icon>
        <span>新建规则</span>
      </el-button>
    </PageHeader>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="关键字">
          <el-input
            v-model="filters.keyword"
            placeholder="规则编号 / 标题 / 要求"
            clearable
            style="width: 220px"
            @keyup.enter="search"
          />
        </el-form-item>
        <el-form-item label="合规依据">
          <el-select v-model="filters.basis" clearable placeholder="全部依据" style="width: 160px">
            <el-option v-for="item in basisOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="规则分类">
          <el-select v-model="filters.category" clearable placeholder="全部分类" style="width: 150px">
            <el-option v-for="item in categoryOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" clearable placeholder="全部状态" style="width: 120px">
            <el-option v-for="item in statusOptions" :key="item" :label="item" :value="item" />
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
          <span>规则清单</span>
          <span class="sub">共 {{ total }} 条 · 覆盖 {{ basisOptions.length }} 类依据 / {{ categoryOptions.length }} 个分类</span>
        </div>
      </template>

      <el-table :data="rules" v-loading="loading" row-key="id" size="default">
        <el-table-column prop="rule_code" label="规则编号" width="108" />
        <el-table-column label="规则标题 / 合规依据" min-width="250">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.rule_title }}</span>
              <span class="sub">{{ row.basis }} · {{ row.category }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="requirement" label="合规要求" min-width="280" show-overflow-tooltip />
        <el-table-column label="风险等级" width="90">
          <template #default="{ row }"><StatusTag :value="row.risk_level" /></template>
        </el-table-column>
        <el-table-column label="检查方式" width="92">
          <template #default="{ row }">{{ row.check_method }}</template>
        </el-table-column>
        <el-table-column label="最近检查" width="150">
          <template #default="{ row }">
            <div v-if="row.last_result" class="cell-main">
              <StatusTag :value="row.last_result" />
              <span class="sub">{{ row.last_checked_at ?? '-' }}</span>
            </div>
            <span v-else class="muted">暂未检查</span>
          </template>
        </el-table-column>
        <el-table-column label="启停" width="80">
          <template #default="{ row }">
            <el-switch
              :model-value="row.status === '启用'"
              :disabled="!auth.canWrite('compliance')"
              @change="(value: string | number | boolean) => toggleStatus(row as unknown as ComplianceRule, Boolean(value))"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="88" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="!auth.canWrite('compliance')" @click="openEdit(row as unknown as ComplianceRule)">编辑</el-button>
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
        @current-change="loadRules"
        @size-change="onSizeChange"
      />
    </el-card>

    <DetailDrawer v-model="drawerVisible" :title="editingId ? '编辑合规规则' : '新增合规规则'" width="620px">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="96px">
        <el-form-item label="规则编号" prop="rule_code">
          <el-input v-model="form.rule_code" placeholder="留空则自动生成，如 CR-021" />
        </el-form-item>
        <el-form-item label="规则标题" prop="rule_title">
          <el-input v-model="form.rule_title" placeholder="请输入规则标题" maxlength="128" show-word-limit />
        </el-form-item>
        <el-form-item label="合规依据" prop="basis">
          <el-select v-model="form.basis" placeholder="请选择合规依据" style="width: 100%">
            <el-option v-for="item in basisOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="规则分类" prop="category">
          <el-select v-model="form.category" placeholder="请选择规则分类" style="width: 100%">
            <el-option v-for="item in categoryOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="风险等级" prop="risk_level">
          <el-select v-model="form.risk_level" placeholder="请选择风险等级" style="width: 100%">
            <el-option v-for="item in riskLevelOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="检查方式" prop="check_method">
          <el-radio-group v-model="form.check_method">
            <el-radio value="自动">自动</el-radio>
            <el-radio value="人工">人工</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="合规要求" prop="requirement">
          <el-input v-model="form.requirement" type="textarea" :rows="4" maxlength="512" show-word-limit placeholder="请描述该规则对应的合规要求" />
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="form.status" style="width: 100%">
            <el-option v-for="item in statusOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
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
import { Plus } from '@element-plus/icons-vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatusTag from '@/components/StatusTag.vue';
import DetailDrawer from '@/components/DetailDrawer.vue';
import { useAuthStore } from '@/stores/auth';
import {
  createRule,
  getRules,
  updateRule,
  type ComplianceRule,
  type RuleFilters,
  type RulePayload,
} from '@/api/compliance';

const auth = useAuthStore();

const FALLBACK_FILTERS: RuleFilters = {
  bases: ['数据安全法', '个人信息保护法', '等保2.0', '行业规范'],
  categories: ['分类分级', '访问控制', '加密脱敏', '审计留痕', '跨境传输', '合规管理'],
  riskLevels: ['低', '中', '高', '紧急'],
  statuses: ['启用', '停用'],
};

const rules = ref<ComplianceRule[]>([]);
const total = ref(0);
const loading = ref(false);
const saving = ref(false);

const filters = reactive({ keyword: '', basis: '', category: '', status: '' });
const pagination = reactive({ page: 1, pageSize: 10 });

const basisOptions = ref<string[]>(FALLBACK_FILTERS.bases);
const categoryOptions = ref<string[]>(FALLBACK_FILTERS.categories);
const riskLevelOptions = ref<string[]>(FALLBACK_FILTERS.riskLevels);
const statusOptions = ref<string[]>(FALLBACK_FILTERS.statuses);

const drawerVisible = ref(false);
const editingId = ref<number | null>(null);
const formRef = ref<FormInstance>();
const form = reactive<RulePayload>({
  rule_code: '',
  rule_title: '',
  basis: '数据安全法',
  category: '分类分级',
  requirement: '',
  risk_level: '中',
  check_method: '自动',
  status: '启用',
});

const formRules: FormRules = {
  rule_title: [{ required: true, message: '请输入规则标题', trigger: 'blur' }],
  basis: [{ required: true, message: '请选择合规依据', trigger: 'change' }],
  category: [{ required: true, message: '请选择规则分类', trigger: 'change' }],
  requirement: [{ required: true, message: '请填写合规要求', trigger: 'blur' }],
};

async function loadRules(): Promise<void> {
  loading.value = true;
  try {
    const res = await getRules({
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: filters.keyword || undefined,
      basis: filters.basis || undefined,
      category: filters.category || undefined,
      status: filters.status || undefined,
    });
    rules.value = res.data;
    total.value = res.meta?.total ?? 0;
    const meta = res.meta?.filters as RuleFilters | undefined;
    if (meta) {
      basisOptions.value = meta.bases ?? FALLBACK_FILTERS.bases;
      categoryOptions.value = meta.categories ?? FALLBACK_FILTERS.categories;
      riskLevelOptions.value = meta.riskLevels ?? FALLBACK_FILTERS.riskLevels;
      statusOptions.value = meta.statuses ?? FALLBACK_FILTERS.statuses;
    }
  } finally {
    loading.value = false;
  }
}

function search(): void {
  pagination.page = 1;
  loadRules();
}

function reset(): void {
  filters.keyword = '';
  filters.basis = '';
  filters.category = '';
  filters.status = '';
  search();
}

function onSizeChange(): void {
  pagination.page = 1;
  loadRules();
}

function defaultForm(): RulePayload {
  return {
    rule_code: '',
    rule_title: '',
    basis: '数据安全法',
    category: '分类分级',
    requirement: '',
    risk_level: '中',
    check_method: '自动',
    status: '启用',
  };
}

function openCreate(): void {
  editingId.value = null;
  Object.assign(form, defaultForm());
  drawerVisible.value = true;
}

function openEdit(row: ComplianceRule): void {
  editingId.value = row.id;
  Object.assign(form, {
    rule_code: row.rule_code,
    rule_title: row.rule_title,
    basis: row.basis,
    category: row.category,
    requirement: row.requirement,
    risk_level: row.risk_level,
    check_method: row.check_method,
    status: row.status,
  });
  drawerVisible.value = true;
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (editingId.value) {
      await updateRule(editingId.value, { ...form });
      ElMessage.success('规则已更新');
    } else {
      await createRule({ ...form, rule_code: form.rule_code || undefined });
      ElMessage.success('规则已创建');
    }
    drawerVisible.value = false;
    await loadRules();
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(row: ComplianceRule, enable: boolean): Promise<void> {
  const status = enable ? '启用' : '停用';
  try {
    await updateRule(row.id, { status });
    row.status = status;
    ElMessage.success(`规则 ${row.rule_code} 已${status}`);
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  }
}

onMounted(loadRules);
</script>

<style scoped>
.filter-card :deep(.el-form-item) { margin-bottom: 0; }
.cell-main { display: flex; flex-direction: column; gap: 2px; }
.cell-main .title { font-weight: 600; color: #23324a; }
.cell-main .sub { font-size: 12px; color: #8595ad; }
</style>
