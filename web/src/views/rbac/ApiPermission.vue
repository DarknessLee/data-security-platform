<template>
  <section class="page">
    <PageHeader title="接口权限" subtitle="平台接口级最小授权矩阵与安全策略；账号权限由角色授予，接口调用时逐次校验">
      <el-button @click="loadAll">刷新</el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="接口总数" :value="apiData?.total ?? 0" hint="覆盖全部业务模块" />
      <StatCard label="接口分组" :value="groupCount" tone="info" hint="按业务模块归类" />
      <StatCard label="角色数" :value="apiData?.roles.length ?? 0" tone="success" hint="参与接口授权" />
      <StatCard label="授权关系" :value="grantCount" tone="warning" hint="角色 × 接口 授权条目" />
    </div>

    <el-card class="content-card" shadow="never">
      <div class="section-title">
        角色 × 接口 授权矩阵
        <span class="sub">✓ 表示角色拥有该接口调用权限，调整请前往角色管理</span>
      </div>
      <el-form :inline="true" class="filter-form" @submit.prevent>
        <el-form-item label="接口筛选">
          <el-input v-model="keyword" placeholder="接口名称 / 编码 / 路径" clearable style="width: 250px" />
        </el-form-item>
        <el-form-item label="接口分组">
          <el-select v-model="groupFilter" placeholder="全部分组" clearable style="width: 170px">
            <el-option v-for="g in apiData?.groups ?? []" :key="g.code" :label="`${g.name}（${g.count}）`" :value="g.code" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <span class="muted">共 {{ filteredApis.length }} / {{ apiData?.total ?? 0 }} 个接口</span>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="filteredApis" border stripe size="small" row-key="id" max-height="600">
        <el-table-column label="接口" min-width="330" fixed>
          <template #default="{ row }">
            <div class="api-cell">
              <span class="method" :class="`method-${(row.method || 'get').toLowerCase()}`">{{ row.method }}</span>
              <div class="api-main">
                <span class="api-name">{{ row.api_name }}</span>
                <span class="api-meta mono">{{ row.api_code }} · {{ row.path }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="分组" width="140">
          <template #default="{ row }">{{ groupName(row.api_group) }}</template>
        </el-table-column>
        <el-table-column
          v-for="role in apiData?.roles ?? []"
          :key="role.id"
          :label="role.role_name"
          width="104"
          align="center"
        >
          <template #default="{ row }">
            <span v-if="grantOf(role.id).has(row.id)" class="grant-yes">✓</span>
            <span v-else class="grant-no">—</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card class="content-card policy-card" shadow="never">
      <div class="policy-head">
        <div class="section-title">
          安全策略
          <span class="sub">密码策略、登录保护、会话与 IP 白名单，保存后对新建账号、密码重置与登录流程即时生效</span>
        </div>
        <div class="policy-actions">
          <span v-if="policy?.updatedAt" class="muted">最近更新：{{ policy.updatedAt }}</span>
          <el-button :disabled="!canWrite" @click="resetPolicyForm">还原</el-button>
          <el-button type="primary" :disabled="!canWrite" :loading="saving" @click="submitPolicy">保存策略</el-button>
        </div>
      </div>

      <el-alert
        v-if="policy?.passwordRule"
        :title="`当前密码策略：${policy.passwordRule}`"
        type="info"
        :closable="false"
        show-icon
        class="policy-alert"
      />

      <el-form label-width="160px" class="policy-form">
        <el-form-item v-for="item in policy?.items ?? []" :key="item.key" :label="item.label">
          <template v-if="item.type === 'text'">
            <el-input
              v-model="policyForm[item.key]"
              type="textarea"
              :rows="2"
              :disabled="!canWrite"
              :placeholder="item.placeholder ?? ''"
            />
          </template>
          <template v-else>
            <el-input v-model="policyForm[item.key]" :disabled="!canWrite" style="width: 200px">
              <template v-if="item.unit" #append>{{ item.unit }}</template>
            </el-input>
            <span v-if="item.min !== null || item.max !== null" class="policy-range muted">
              取值 {{ item.min ?? '—' }} ~ {{ item.max ?? '—' }}{{ item.unit ?? '' }}
            </span>
          </template>
          <div class="policy-desc">{{ item.description }}</div>
        </el-form-item>
      </el-form>

      <div class="policy-foot">
        <span class="muted">{{ policy?.note }}</span>
        <span v-if="!canWrite" class="muted">当前账号无「权限安全管控」写权限，仅可查看</span>
      </div>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import { useAuthStore } from '@/stores/auth';
import {
  getApis,
  getPolicy,
  savePolicy,
  type ApiPermissionData,
  type PolicyData,
} from '@/api/rbac';

const auth = useAuthStore();
const canWrite = computed(() => auth.canWrite('rbac'));

const apiData = ref<ApiPermissionData | null>(null);
const policy = ref<PolicyData | null>(null);
const policyForm = reactive<Record<string, string>>({});
const loading = ref(false);
const saving = ref(false);
const keyword = ref('');
const groupFilter = ref<string | undefined>(undefined);

const groupCount = computed(() => apiData.value?.groups.length ?? 0);
const grantCount = computed(() => (apiData.value?.grants ?? []).reduce((sum, g) => sum + g.apiIds.length, 0));

const grantMap = computed(() => {
  const map = new Map<number, Set<number>>();
  for (const grant of apiData.value?.grants ?? []) {
    map.set(grant.role_id, new Set(grant.apiIds.map(Number)));
  }
  return map;
});

const filteredApis = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return (apiData.value?.list ?? []).filter((api) => {
    if (groupFilter.value && api.api_group !== groupFilter.value) return false;
    if (!kw) return true;
    return [api.api_name, api.api_code, api.path, api.api_group]
      .join(' ')
      .toLowerCase()
      .includes(kw);
  });
});

function grantOf(roleId: number): Set<number> {
  return grantMap.value.get(roleId) ?? new Set<number>();
}

function groupName(code: string) {
  return apiData.value?.groups.find((g) => g.code === code)?.name ?? code;
}

function resetPolicyForm() {
  for (const key of Object.keys(policyForm)) delete policyForm[key];
  for (const item of policy.value?.items ?? []) policyForm[item.key] = item.value;
}

async function loadAll() {
  loading.value = true;
  try {
    const [apisRes, policyRes] = await Promise.all([getApis(), getPolicy()]);
    apiData.value = apisRes.data;
    policy.value = policyRes.data;
    resetPolicyForm();
  } catch {
    apiData.value = null;
    policy.value = null;
  } finally {
    loading.value = false;
  }
}

function buildPolicyItems(): { key: string; value: string }[] {
  const items: { key: string; value: string }[] = [];
  for (const item of policy.value?.items ?? []) {
    const raw = (policyForm[item.key] ?? '').trim();
    if (item.type === 'number') {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`「${item.label}」请填写数字`);
      if (item.min !== null && value < item.min) throw new Error(`「${item.label}」不得小于 ${item.min}`);
      if (item.max !== null && value > item.max) throw new Error(`「${item.label}」不得大于 ${item.max}`);
      items.push({ key: item.key, value: String(value) });
    } else {
      if (!raw) throw new Error(`「${item.label}」不能为空`);
      items.push({ key: item.key, value: raw });
    }
  }
  return items;
}

async function submitPolicy() {
  try {
    const items = buildPolicyItems();
    saving.value = true;
    const { data } = await savePolicy(items);
    ElMessage.success(data.message || '安全策略已保存并生效');
    if (Array.isArray(data.items)) {
      policy.value = { ...(policy.value as PolicyData), items: data.items, updatedAt: data.updatedAt };
      resetPolicyForm();
    } else {
      await loadAll();
    }
  } catch (err) {
    if (err instanceof Error && err.message) ElMessage.warning(err.message);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await loadAll();
});
</script>

<style scoped>
.filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin-bottom: 10px;
}
.api-cell {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.api-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.api-name {
  font-size: 13px;
  color: #24364f;
}
.api-meta {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.method {
  flex-shrink: 0;
  width: 46px;
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 0;
  border-radius: 4px;
  color: #fff;
  background: #64748b;
}
.method-get {
  background: #16a34a;
}
.method-post {
  background: #1f6feb;
}
.method-put {
  background: #d97706;
}
.method-delete {
  background: #dc2626;
}
.grant-yes {
  color: #16a34a;
  font-weight: 700;
}
.grant-no {
  color: #cbd5e1;
}
.policy-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.policy-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.policy-alert {
  margin: 6px 0 14px;
}
.policy-form {
  max-width: 780px;
}
.policy-desc {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: #94a3b8;
}
.policy-range {
  margin-left: 10px;
  font-size: 12px;
}
.policy-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  border-top: 1px dashed #eef2f8;
  padding-top: 10px;
}
</style>
