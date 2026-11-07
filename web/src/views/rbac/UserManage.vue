<template>
  <section class="page">
    <PageHeader title="用户管理" subtitle="维护平台账号、所属部门与角色绑定；启停与权限调整即时生效，操作全程留痕">
      <el-button v-if="canWrite" type="primary" @click="openCreate">新增用户</el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="用户总数" :value="overview.userTotal" hint="平台全部账号" />
      <StatCard label="启用账号" :value="overview.userActive" tone="success" hint="可正常登录" />
      <StatCard label="停用账号" :value="overview.userDisabled" tone="warning" hint="已禁止登录" />
      <StatCard label="锁定账号" :value="overview.lockedCount" tone="danger" :hint="lockHint" />
    </div>

    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" class="filter-form" @submit.prevent>
        <el-form-item label="关键词">
          <el-input
            v-model="filters.keyword"
            placeholder="账号 / 姓名 / 手机号"
            clearable
            style="width: 200px"
            @keyup.enter="search"
          />
        </el-form-item>
        <el-form-item label="部门">
          <el-select v-model="filters.deptId" placeholder="全部部门" clearable style="width: 150px">
            <el-option v-for="d in depts" :key="d.id" :label="d.dept_name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width: 120px">
            <el-option label="启用" :value="1" />
            <el-option label="停用" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="filters.roleCode" placeholder="全部角色" clearable style="width: 180px">
            <el-option v-for="r in roles" :key="r.role_code" :label="r.role_name" :value="r.role_code" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="content-card" shadow="never">
      <el-table v-loading="loading" :data="rows" border stripe row-key="id" class="user-table">
        <el-table-column label="账号 / 姓名" min-width="150">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title mono">{{ row.username }}</span>
              <span class="sub">{{ row.real_name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="部门" width="130">
          <template #default="{ row }">{{ row.dept_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="岗位" width="120">
          <template #default="{ row }">{{ row.job_title || '—' }}</template>
        </el-table-column>
        <el-table-column label="角色" min-width="200">
          <template #default="{ row }">
            <div class="role-tags">
              <el-tag
                v-for="r in row.roles"
                :key="r.id"
                size="small"
                :type="r.role_code === 'SUPER_ADMIN' ? 'danger' : 'primary'"
                effect="light"
              >
                {{ r.role_name }}
              </el-tag>
              <span v-if="!row.roles.length" class="muted">未分配</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <StatusTag :value="row.status === 1 ? '启用' : '停用'" />
          </template>
        </el-table-column>
        <el-table-column label="最后登录" width="160">
          <template #default="{ row }">{{ row.last_login_at || '从未登录' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button v-if="canWrite" link type="primary" @click="openEdit(asUser(row))">编辑</el-button>
              <el-button
                v-if="canWrite"
                link
                :type="row.status === 1 ? 'danger' : 'success'"
                :disabled="row.id === auth.user?.id"
                @click="toggleStatus(asUser(row))"
              >
                {{ row.status === 1 ? '停用' : '启用' }}
              </el-button>
              <el-button v-if="canWrite" link type="primary" @click="openReset(asUser(row))">重置密码</el-button>
              <span v-if="!canWrite" class="muted">只读</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-if="!loading && !rows.length" description="未找到符合条件的用户" />
      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="loadUsers"
          @size-change="onSizeChange"
        />
      </div>
    </el-card>

    <DetailDrawer v-model="drawerVisible" :title="isEdit ? '编辑用户' : '新增用户'" width="640px">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="92px" class="user-form">
        <el-form-item label="账号" prop="username">
          <el-input v-model="form.username" :disabled="isEdit" placeholder="3–32 位字母、数字或下划线" />
        </el-form-item>
        <el-form-item label="姓名" prop="real_name">
          <el-input v-model="form.real_name" maxlength="32" placeholder="请输入真实姓名" />
        </el-form-item>
        <el-form-item v-if="!isEdit" label="初始密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="请设置初始密码" />
          <div class="form-hint">{{ passwordRule }}</div>
        </el-form-item>
        <el-form-item label="所属部门" prop="dept_id">
          <el-select v-model="form.dept_id" placeholder="请选择部门" style="width: 100%">
            <el-option v-for="d in depts" :key="d.id" :label="d.dept_name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="岗位">
          <el-input v-model="form.job_title" maxlength="32" placeholder="如：数据管理员" />
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="form.phone" maxlength="11" placeholder="选填" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="选填" />
        </el-form-item>
        <el-form-item label="角色" prop="roleCodes">
          <el-checkbox-group v-model="form.roleCodes">
            <el-checkbox v-for="r in roles" :key="r.role_code" :value="r.role_code">{{ r.role_name }}</el-checkbox>
          </el-checkbox-group>
          <div class="form-hint">角色决定该账号的菜单与接口权限，可多选</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">保存</el-button>
      </template>
    </DetailDrawer>

    <el-dialog v-model="pwdVisible" title="重置密码" width="460px">
      <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" label-width="80px">
        <el-form-item label="账号">
          <el-input :model-value="pwdTarget?.username ?? ''" disabled />
        </el-form-item>
        <el-form-item label="新密码" prop="password">
          <el-input v-model="pwdForm.password" type="password" show-password placeholder="请输入新密码" />
        </el-form-item>
      </el-form>
      <div class="form-hint">{{ passwordRule }}</div>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitReset">确认重置</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';
import DetailDrawer from '@/components/DetailDrawer.vue';
import { useAuthStore } from '@/stores/auth';
import {
  createUser,
  getDepts,
  getPolicy,
  getRbacOverview,
  getRoles,
  getUsers,
  resetUserPassword,
  updateUser,
  updateUserStatus,
  type PolicyData,
  type RbacDept,
  type RbacOverview,
  type RbacRole,
  type RbacUser,
  type UserQuery,
} from '@/api/rbac';

const auth = useAuthStore();
const canWrite = computed(() => auth.canWrite('rbac'));

const overview = ref<RbacOverview>({
  userTotal: 0,
  userActive: 0,
  userDisabled: 0,
  lockedCount: 0,
  roleTotal: 0,
  deptTotal: 0,
  menuTotal: 0,
  topMenuTotal: 0,
  apiTotal: 0,
  loginFail7d: 0,
  loginFailToday: 0,
  lastLoginFailAt: null,
  generatedAt: '',
});
const policy = ref<PolicyData | null>(null);
const passwordRule = computed(
  () => policy.value?.passwordRule ?? '密码长度不少于 10 位，且需同时包含大写字母、小写字母、数字与特殊字符',
);
const lockHint = computed(() => `近 7 天登录失败 ${overview.value.loginFail7d} 次`);

const roles = ref<RbacRole[]>([]);
const depts = ref<RbacDept[]>([]);
const rows = ref<RbacUser[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const loading = ref(false);
const saving = ref(false);

const filters = reactive<{ keyword: string; deptId: number | undefined; status: number | undefined; roleCode: string | undefined }>({
  keyword: '',
  deptId: undefined,
  status: undefined,
  roleCode: undefined,
});

const drawerVisible = ref(false);
const isEdit = ref(false);
const editingId = ref<number | null>(null);
const formRef = ref<FormInstance>();

const emptyForm = () => ({
  username: '',
  real_name: '',
  password: '',
  dept_id: null as number | null,
  job_title: '',
  phone: '',
  email: '',
  roleCodes: [] as string[],
});
const form = reactive(emptyForm());

function makePasswordValidator() {
  const minLength = computed(() => Number(policy.value?.items.find((i) => i.key === 'security.password.min_length')?.value ?? 10));
  return (_rule: unknown, value: string, callback: (error?: Error) => void) => {
    if (!value) return callback(new Error('请输入密码'));
    if (value.length < minLength.value) return callback(new Error(`密码长度不少于 ${minLength.value} 位`));
    if (!/[a-z]/.test(value)) return callback(new Error('需包含小写字母'));
    if (!/[A-Z]/.test(value)) return callback(new Error('需包含大写字母'));
    if (!/\d/.test(value)) return callback(new Error('需包含数字'));
    if (!/[^a-zA-Z0-9\s]/.test(value)) return callback(new Error('需包含特殊字符'));
    callback();
  };
}

const formRules: FormRules = {
  username: [
    { required: true, message: '请输入账号', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]{3,32}$/, message: '账号为 3–32 位字母、数字或下划线', trigger: 'blur' },
  ],
  real_name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  password: [{ validator: makePasswordValidator(), trigger: 'blur' }],
  dept_id: [{ required: true, message: '请选择所属部门', trigger: 'change' }],
  roleCodes: [{ type: 'array', required: true, message: '请至少选择一个角色', trigger: 'change' }],
  phone: [
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) =>
        !value || /^1\d{10}$/.test(value) ? callback() : callback(new Error('手机号格式不正确')),
      trigger: 'blur',
    },
  ],
  email: [
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) =>
        !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? callback() : callback(new Error('邮箱格式不正确')),
      trigger: 'blur',
    },
  ],
};

const pwdVisible = ref(false);
const pwdTarget = ref<RbacUser | null>(null);
const pwdFormRef = ref<FormInstance>();
const pwdForm = reactive({ password: '' });
const pwdRules: FormRules = { password: [{ validator: makePasswordValidator(), trigger: 'blur' }] };

async function loadOverview() {
  try {
    const { data } = await getRbacOverview();
    overview.value = data;
  } catch {
    /* 拦截器已提示 */
  }
}

async function loadUsers() {
  loading.value = true;
  try {
    const query: UserQuery = {
      page: page.value,
      pageSize: pageSize.value,
      keyword: filters.keyword.trim() || undefined,
      deptId: filters.deptId,
      status: filters.status,
      roleCode: filters.roleCode,
    };
    const { data, meta } = await getUsers(query);
    rows.value = data;
    total.value = Number(meta?.total ?? data.length);
  } catch {
    rows.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  void loadUsers();
}

function onSizeChange() {
  page.value = 1;
  void loadUsers();
}

function resetFilters() {
  filters.keyword = '';
  filters.deptId = undefined;
  filters.status = undefined;
  filters.roleCode = undefined;
  search();
}

function asUser(row: unknown): RbacUser {
  return row as RbacUser;
}

function openCreate() {
  isEdit.value = false;
  editingId.value = null;
  Object.assign(form, emptyForm());
  drawerVisible.value = true;
  formRef.value?.clearValidate();
}

function openEdit(row: RbacUser) {
  isEdit.value = true;
  editingId.value = row.id;
  Object.assign(form, {
    username: row.username,
    real_name: row.real_name,
    password: '',
    dept_id: row.dept_id,
    job_title: row.job_title ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    roleCodes: row.roles.map((r) => r.role_code),
  });
  drawerVisible.value = true;
  formRef.value?.clearValidate();
}

async function submitForm() {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (isEdit.value && editingId.value) {
      const { data } = await updateUser(editingId.value, {
        real_name: form.real_name.trim(),
        dept_id: form.dept_id,
        job_title: form.job_title.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        roleCodes: form.roleCodes,
      });
      ElMessage.success(data.message || '用户信息已更新');
    } else {
      const { data } = await createUser({
        username: form.username.trim(),
        real_name: form.real_name.trim(),
        password: form.password,
        dept_id: form.dept_id,
        job_title: form.job_title.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        roleCodes: form.roleCodes,
      });
      ElMessage.success(data.message || '用户创建成功');
    }
    drawerVisible.value = false;
    await Promise.all([loadUsers(), loadOverview()]);
  } catch {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(row: RbacUser) {
  const next = row.status === 1 ? 0 : 1;
  const action = next === 1 ? '启用' : '停用';
  try {
    await ElMessageBox.confirm(`确认${action}账号「${row.username}」吗？`, `${action}确认`, {
      type: 'warning',
      confirmButtonText: `确认${action}`,
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    const { data } = await updateUserStatus(row.id, next);
    ElMessage.success(data.message || `账号已${action}`);
    await loadUsers();
  } catch {
    /* 拦截器已提示 */
  }
}

function openReset(row: RbacUser) {
  pwdTarget.value = row;
  pwdForm.password = '';
  pwdVisible.value = true;
  pwdFormRef.value?.clearValidate();
}

async function submitReset() {
  if (!pwdFormRef.value || !pwdTarget.value) return;
  const valid = await pwdFormRef.value.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    const { data } = await resetUserPassword(pwdTarget.value.id, pwdForm.password);
    ElMessage.success(data.message || '密码重置成功');
    pwdVisible.value = false;
  } catch {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadOverview(), loadRoles(), loadDepts(), loadUsers(), loadPolicy()]);
});

async function loadRoles() {
  try {
    const { data } = await getRoles();
    roles.value = data.list;
  } catch {
    roles.value = [];
  }
}

async function loadDepts() {
  try {
    const { data } = await getDepts();
    depts.value = data.list;
  } catch {
    depts.value = [];
  }
}

async function loadPolicy() {
  try {
    const { data } = await getPolicy();
    policy.value = data;
  } catch {
    policy.value = null;
  }
}
</script>

<style scoped>
.filter-form {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}
.role-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
.form-hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: #8595ad;
}
.user-form :deep(.el-checkbox) {
  margin-right: 16px;
  margin-bottom: 6px;
}
</style>
