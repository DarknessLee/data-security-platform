<template>
  <div class="page">
    <PageHeader title="脱敏管理" subtitle="维护敏感字段脱敏规则，支持掩码、哈希、加密、泛化四种算法在线验证">
      <el-button :loading="loading" @click="load">刷新</el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="脱敏规则总数" :value="rules.length" unit="条" tone="primary" icon="Lock" />
      <StatCard label="启用规则" :value="enabledCount" unit="条" tone="success" icon="CircleCheck" />
      <StatCard label="静态脱敏" :value="staticCount" unit="条" tone="info" icon="Files" hint="落库 / 导出时脱敏" />
      <StatCard label="动态脱敏" :value="dynamicCount" unit="条" tone="warning" icon="View" hint="查询 / 接口返回时脱敏" />
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="关键字">
          <el-input v-model="filters.keyword" placeholder="规则名称 / 字段 / 场景" clearable style="width: 220px" @keyup.enter="load" />
        </el-form-item>
        <el-form-item label="脱敏算法">
          <el-select v-model="filters.algorithm" clearable placeholder="全部算法" style="width: 130px" @change="load">
            <el-option v-for="item in ALGORITHMS" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="脱敏方式">
          <el-select v-model="filters.mask_type" clearable placeholder="全部方式" style="width: 130px" @change="load">
            <el-option v-for="item in MASK_TYPES" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="content-card">
      <template #header>
        <div class="section-title">
          <span>脱敏规则清单</span>
          <span class="sub">共 {{ rules.length }} 条 · 覆盖 {{ algorithmCount }} 种算法</span>
        </div>
      </template>

      <el-table :data="rules" v-loading="loading" row-key="id">
        <el-table-column label="规则名称" min-width="180">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.rule_name }}</span>
              <span class="sub">{{ row.scene }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="字段匹配" min-width="170">
          <template #default="{ row }"><span class="mono">{{ row.field_pattern }}</span></template>
        </el-table-column>
        <el-table-column label="脱敏算法" width="100">
          <template #default="{ row }"><StatusTag :value="row.algorithm" /></template>
        </el-table-column>
        <el-table-column label="脱敏方式" width="100">
          <template #default="{ row }">{{ row.mask_type }}</template>
        </el-table-column>
        <el-table-column label="脱敏样例" min-width="260">
          <template #default="{ row }">
            <div class="sample-line">
              <span class="mono before">{{ row.sample_before }}</span>
              <el-icon class="arrow"><Right /></el-icon>
              <span class="mono after">{{ row.sample_after }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="启停" width="80">
          <template #default="{ row }">
            <el-switch
              :model-value="row.status === '启用'"
              :disabled="!auth.canWrite('compliance')"
              @change="(value: string | number | boolean) => toggleStatus(row as unknown as MaskingRule, Boolean(value))"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openTest(row as unknown as MaskingRule)">试脱敏</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="试脱敏验证" width="560px">
      <div v-if="current" class="test-body">
        <div class="test-head">
          <span class="test-name">{{ current.rule_name }}</span>
          <StatusTag :value="current.algorithm" />
          <span class="muted">{{ current.mask_type }}脱敏 · {{ current.field_pattern }}</span>
        </div>
        <el-input
          v-model="sample"
          type="textarea"
          :rows="3"
          maxlength="256"
          show-word-limit
          placeholder="请输入待脱敏的样例数据，如身份证号 / 手机号 / 姓名"
        />
        <div class="test-actions">
          <el-button @click="fillSample">填入示例</el-button>
          <el-button type="primary" :loading="testing" @click="runTest">执行脱敏</el-button>
        </div>
        <div class="result-grid">
          <div class="result-item">
            <span class="result-label">脱敏前</span>
            <span class="mono">{{ result?.before ?? (sample || '—') }}</span>
          </div>
          <div class="result-item">
            <span class="result-label">脱敏后</span>
            <span class="mono result-after">{{ result?.after ?? '—' }}</span>
          </div>
        </div>
        <div v-if="result" class="muted mt-8">算法 {{ result.algorithm }} · 规则 {{ result.ruleName }}</div>
      </div>
      <template #footer>
        <el-button type="primary" @click="dialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Right } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuthStore } from '@/stores/auth';
import { getMaskingRules, testMasking, updateMasking, type MaskingRule, type MaskingTestResult } from '@/api/compliance';

const auth = useAuthStore();

const ALGORITHMS = ['掩码', '哈希', '加密', '泛化'];
const MASK_TYPES = ['静态', '动态'];

const rules = ref<MaskingRule[]>([]);
const loading = ref(false);
const filters = reactive({ keyword: '', algorithm: '', mask_type: '' });

const enabledCount = computed(() => rules.value.filter((r) => r.status === '启用').length);
const staticCount = computed(() => rules.value.filter((r) => r.mask_type === '静态').length);
const dynamicCount = computed(() => rules.value.filter((r) => r.mask_type === '动态').length);
const algorithmCount = computed(() => new Set(rules.value.map((r) => r.algorithm)).size);

const dialogVisible = ref(false);
const current = ref<MaskingRule | null>(null);
const sample = ref('');
const testing = ref(false);
const result = ref<MaskingTestResult | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await getMaskingRules({
      keyword: filters.keyword || undefined,
      algorithm: filters.algorithm || undefined,
      mask_type: filters.mask_type || undefined,
    });
    rules.value = res.data;
  } finally {
    loading.value = false;
  }
}

function reset(): void {
  filters.keyword = '';
  filters.algorithm = '';
  filters.mask_type = '';
  load();
}

async function toggleStatus(row: MaskingRule, enable: boolean): Promise<void> {
  const status = enable ? '启用' : '停用';
  try {
    await updateMasking(row.id, { status });
    row.status = status;
    ElMessage.success(`脱敏规则「${row.rule_name}」已${status}`);
  } catch {
    /* 错误提示由 http 拦截器统一处理 */
  }
}

function openTest(row: MaskingRule): void {
  current.value = row;
  sample.value = row.sample_before;
  result.value = null;
  dialogVisible.value = true;
}

function fillSample(): void {
  if (!current.value) return;
  sample.value = current.value.sample_before;
  result.value = null;
}

async function runTest(): Promise<void> {
  if (!current.value) return;
  if (!sample.value.trim()) {
    ElMessage.warning('请输入待脱敏的样例数据');
    return;
  }
  testing.value = true;
  try {
    const res = await testMasking(current.value.id, sample.value.trim());
    result.value = res.data;
  } finally {
    testing.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.filter-card :deep(.el-form-item) { margin-bottom: 0; }
.cell-main { display: flex; flex-direction: column; gap: 2px; }
.cell-main .title { font-weight: 600; color: #23324a; }
.cell-main .sub { font-size: 12px; color: #8595ad; }
.sample-line { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.sample-line .before { color: #94a3b8; text-decoration: line-through; }
.sample-line .after { color: #16a34a; }
.sample-line .arrow { color: #c0cad8; font-size: 12px; }
.test-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.test-name { font-size: 15px; font-weight: 600; color: #13233c; }
.test-actions { display: flex; justify-content: flex-end; gap: 8px; margin: 12px 0; }
.result-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.result-item { background: #f7fafd; border: 1px solid #e9eef6; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; min-height: 74px; }
.result-label { font-size: 12px; color: #8595ad; }
.result-item .mono { font-size: 13px; word-break: break-all; color: #3d4f6a; }
.result-after { color: #16a34a !important; }
</style>
