<template>
  <section class="page">
    <PageHeader title="角色管理" subtitle="按角色配置菜单可见性与接口调用权限；保存后立即清理相关用户权限缓存并生效">
      <el-button @click="loadAll">刷新</el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="角色总数" :value="overview.roleTotal" hint="含 1 个超级管理员角色" />
      <StatCard label="用户总数" :value="overview.userTotal" tone="success" hint="按角色进行授权" />
      <StatCard label="菜单条目" :value="overview.menuTotal" tone="info" :hint="`其中顶级目录 ${overview.topMenuTotal} 个`" />
      <StatCard label="接口权限" :value="overview.apiTotal" tone="warning" hint="接口级最小授权" />
    </div>

    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" class="filter-form" @submit.prevent>
        <el-form-item label="角色筛选">
          <el-input v-model="keyword" placeholder="角色名称 / 编码" clearable style="width: 240px" />
        </el-form-item>
        <el-form-item label="数据范围">
          <el-select v-model="scopeFilter" placeholder="全部" clearable style="width: 140px">
            <el-option v-for="s in SCOPE_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <span class="muted">共 {{ filteredRoles.length }} 个角色，点击「配置权限」调整菜单与接口授权</span>
        </el-form-item>
      </el-form>
    </el-card>

    <div v-loading="loading" class="role-grid">
      <div v-for="role in filteredRoles" :key="role.id" class="role-card">
        <div class="role-card-head">
          <div class="role-name-wrap">
            <span class="role-name">{{ role.role_name }}</span>
            <span class="role-code mono">{{ role.role_code }}</span>
          </div>
          <el-tag size="small" :type="role.is_super_admin ? 'danger' : 'info'" effect="light">
            {{ scopeLabel(role.data_scope) }}
          </el-tag>
        </div>
        <p class="role-desc">{{ role.description || '暂无角色描述' }}</p>
        <div class="role-counts">
          <span><b>{{ role.userCount }}</b> 用户</span>
          <span><b>{{ role.menuCount }}</b> 菜单</span>
          <span><b>{{ role.apiCount }}</b> 接口</span>
        </div>
        <div class="perm-matrix">
          <div v-for="m in modules" :key="m.code" class="perm-cell" :class="`perm-${permLevel(role, m.code)}`">
            <span class="perm-name">{{ m.name }}</span>
            <span class="perm-flag">{{ permText(role, m.code) }}</span>
          </div>
        </div>
        <div class="role-card-foot">
          <span v-if="role.is_super_admin" class="muted">超管权限为保护项，不允许清空</span>
          <span v-else class="muted">授权变更即时生效</span>
          <el-button type="primary" link @click="openPerm(role)">配置权限</el-button>
        </div>
      </div>
    </div>
    <el-card v-if="!loading && !filteredRoles.length" class="content-card" shadow="never">
      <EmptyState description="未找到符合条件的角色" />
    </el-card>

    <DetailDrawer v-model="drawerVisible" :title="drawerTitle" width="920px">
      <template v-if="detail">
        <div class="drawer-top">
          <div class="drawer-role">
            <span class="role-name">{{ detail.role.role_name }}</span>
            <span class="role-code mono">{{ detail.role.role_code }}</span>
            <el-tag size="small" type="info" effect="light">{{ scopeLabel(detail.role.data_scope) }}</el-tag>
          </div>
          <div class="drawer-counts">
            已授权菜单 <b>{{ detail.menuCount }}</b> 项 / 接口 <b>{{ detail.apiCount }}</b> 项
          </div>
        </div>

        <div class="drawer-section">
          <div class="section-title">
            菜单可见性
            <span class="sub">勾选可见菜单；模块级目录可单独开启「读 / 写」权限</span>
          </div>
          <div class="tree-box">
            <el-tree
              ref="treeRef"
              :data="detail.menus"
              node-key="id"
              show-checkbox
              default-expand-all
              :default-checked-keys="checkedKeys"
              :props="treeProps"
              :expand-on-click-node="false"
            >
              <template #default="{ data }">
                <div class="tree-node">
                  <span class="tree-label">{{ data.menu_name }}</span>
                  <span v-if="data.permission_code" class="tree-code mono">{{ data.permission_code }}</span>
                  <span v-else class="tree-path muted">{{ data.path }}</span>
                  <span v-if="data.permission_code" class="tree-perm" @click.stop>
                    <el-checkbox
                      :model-value="menuPerms[data.id]?.read ?? false"
                      size="small"
                      @change="(v: unknown) => onPermChange(data.id, 'read', Boolean(v))"
                    >
                      读
                    </el-checkbox>
                    <el-checkbox
                      :model-value="menuPerms[data.id]?.write ?? false"
                      size="small"
                      @change="(v: unknown) => onPermChange(data.id, 'write', Boolean(v))"
                    >
                      写
                    </el-checkbox>
                  </span>
                </div>
              </template>
            </el-tree>
          </div>
        </div>

        <div class="drawer-section">
          <div class="section-title">
            接口权限
            <span class="sub">按接口最小授权，接口被调用时即时校验</span>
          </div>
          <el-checkbox-group v-model="apiChecked">
            <div v-for="g in apiGroups" :key="g.code" class="api-group">
              <div class="api-group-head">
                <span>{{ g.name }}</span>
                <span class="muted">{{ g.items.length }} 个接口</span>
              </div>
              <div class="api-list">
                <el-checkbox v-for="api in g.items" :key="api.id" :value="api.id" class="api-item">
                  <span class="method" :class="`method-${(api.method || 'get').toLowerCase()}`">{{ api.method }}</span>
                  <span class="api-name">{{ api.api_name }}</span>
                  <span class="api-path mono">{{ api.path }}</span>
                </el-checkbox>
              </div>
            </div>
          </el-checkbox-group>
        </div>
      </template>
      <template #footer>
        <span class="muted footer-tip">保存后将清理该角色下 {{ detail ? roleUserCount : 0 }} 个用户的权限缓存</span>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitPerm">保存权限</el-button>
      </template>
    </DetailDrawer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElTree } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import EmptyState from '@/components/EmptyState.vue';
import DetailDrawer from '@/components/DetailDrawer.vue';
import {
  getApis,
  getRbacOverview,
  getRolePermissions,
  getRoles,
  saveRolePermissions,
  type ApiPermissionWithCheck,
  type MenuPermNode,
  type RbacModule,
  type RbacOverview,
  type RbacRole,
  type RolePermissionDetail,
  type RoleMenuGrant,
} from '@/api/rbac';

const SCOPE_OPTIONS = [
  { value: 'ALL', label: '全部数据' },
  { value: 'DEPT', label: '本部门数据' },
  { value: 'SELF', label: '本人数据' },
] as const;

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
const roles = ref<RbacRole[]>([]);
const modules = ref<RbacModule[]>([]);
const loading = ref(false);
const keyword = ref('');
const scopeFilter = ref<string | undefined>(undefined);

const drawerVisible = ref(false);
const detail = ref<RolePermissionDetail | null>(null);
const saving = ref(false);
const treeRef = ref<InstanceType<typeof ElTree>>();
const checkedKeys = ref<number[]>([]);
const apiChecked = ref<number[]>([]);
const menuPerms = reactive<Record<number, { read: boolean; write: boolean }>>({});
const apiGroupNames = ref<Record<string, string>>({});
const treeProps = { label: 'menu_name', children: 'children' };

const drawerTitle = computed(() => (detail.value ? `配置角色权限 · ${detail.value.role.role_name}` : '配置角色权限'));
const roleUserCount = computed(() => roles.value.find((r) => r.id === detail.value?.role.id)?.userCount ?? 0);

const filteredRoles = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return roles.value.filter((role) => {
    if (scopeFilter.value && role.data_scope !== scopeFilter.value) return false;
    if (!kw) return true;
    return role.role_name.toLowerCase().includes(kw) || role.role_code.toLowerCase().includes(kw);
  });
});

const apiGroups = computed(() => {
  const list = detail.value?.apis ?? [];
  const order: string[] = [];
  const map = new Map<string, ApiPermissionWithCheck[]>();
  for (const api of list) {
    if (!map.has(api.api_group)) {
      map.set(api.api_group, []);
      order.push(api.api_group);
    }
    map.get(api.api_group)?.push(api);
  }
  return order.map((code) => ({
    code,
    name: apiGroupNames.value[code] ?? code,
    items: map.get(code) ?? [],
  }));
});

function scopeLabel(scope: string) {
  return SCOPE_OPTIONS.find((s) => s.value === scope)?.label ?? scope;
}

function permLevel(role: RbacRole, code: string) {
  const cell = role.perms?.[code];
  if (!cell) return 'none';
  if (cell.write) return 'write';
  if (cell.read) return 'read';
  return 'none';
}

function permText(role: RbacRole, code: string) {
  const level = permLevel(role, code);
  return level === 'write' ? '读写' : level === 'read' ? '只读' : '未授权';
}

async function loadAll() {
  loading.value = true;
  try {
    const [rolesRes, overviewRes] = await Promise.all([getRoles(), getRbacOverview()]);
    roles.value = rolesRes.data.list;
    modules.value = rolesRes.data.modules;
    overview.value = overviewRes.data;
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false;
  }
}

async function ensureGroupNames() {
  if (Object.keys(apiGroupNames.value).length) return;
  try {
    const { data } = await getApis();
    apiGroupNames.value = Object.fromEntries(data.groups.map((g) => [g.code, g.name]));
  } catch {
    apiGroupNames.value = {};
  }
}

function initMenuPerms(nodes: MenuPermNode[]) {
  for (const node of nodes) {
    menuPerms[node.id] = { read: Boolean(node.perm_read), write: Boolean(node.perm_write) };
    if (node.children?.length) initMenuPerms(node.children);
  }
}

async function openPerm(role: RbacRole) {
  drawerVisible.value = true;
  detail.value = null;
  checkedKeys.value = [];
  apiChecked.value = [];
  try {
    await ensureGroupNames();
    const { data } = await getRolePermissions(role.id);
    detail.value = data;
    for (const key of Object.keys(menuPerms)) delete menuPerms[Number(key)];
    initMenuPerms(data.menus);
    checkedKeys.value = flattenMenus(data.menus)
      .filter((m) => m.checked)
      .map((m) => m.id);
    apiChecked.value = data.apis.filter((a) => a.checked).map((a) => a.id);
    await nextTick();
    treeRef.value?.setCheckedKeys(checkedKeys.value);
  } catch {
    drawerVisible.value = false;
  }
}

function flattenMenus(nodes: MenuPermNode[]): MenuPermNode[] {
  const out: MenuPermNode[] = [];
  const walk = (list: MenuPermNode[]) => {
    for (const node of list) {
      out.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

function onPermChange(id: number, field: 'read' | 'write', value: boolean) {
  const state = menuPerms[id] ?? { read: false, write: false };
  if (field === 'write' && value) {
    state.read = true;
    state.write = true;
  } else if (field === 'write') {
    state.write = false;
  } else if (field === 'read' && !value) {
    state.read = false;
    state.write = false;
  } else {
    state.read = true;
  }
  menuPerms[id] = state;
}

async function submitPerm() {
  if (!detail.value) return;
  const keys = (treeRef.value?.getCheckedKeys(false) ?? []).map((k) => Number(k));
  const menus: RoleMenuGrant[] = keys.map((menuId) => {
    const state = menuPerms[menuId] ?? { read: true, write: false };
    const write = Boolean(state.write);
    return { menu_id: menuId, perm_read: Boolean(state.read) || write, perm_write: write };
  });
  saving.value = true;
  try {
    const { data } = await saveRolePermissions(detail.value.role.id, {
      menus,
      apiIds: apiChecked.value,
    });
    ElMessage.success(data.message || '角色权限已保存并立即生效');
    drawerVisible.value = false;
    await loadAll();
  } catch {
    /* 拦截器已提示 */
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
}
.role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 14px;
}
.role-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  background: #fff;
  border: 1px solid #e9eef6;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(19, 35, 60, 0.04);
}
.role-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.role-name-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.role-name {
  font-size: 15px;
  font-weight: 650;
  color: #13233c;
}
.role-code {
  font-size: 12px;
  color: #8595ad;
  letter-spacing: 0.4px;
}
.role-desc {
  margin: 0;
  min-height: 36px;
  font-size: 12.5px;
  line-height: 1.5;
  color: #6b7d96;
}
.role-counts {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: #8595ad;
}
.role-counts b {
  font-size: 15px;
  color: #1f6feb;
  font-variant-numeric: tabular-nums;
}
.perm-matrix {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.perm-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 12px;
  background: #f6f8fb;
  border: 1px solid #eef2f8;
}
.perm-cell .perm-flag {
  color: #94a3b8;
}
.perm-write {
  background: rgba(22, 163, 74, 0.08);
  border-color: rgba(22, 163, 74, 0.2);
}
.perm-write .perm-flag {
  color: #15803d;
  font-weight: 600;
}
.perm-read {
  background: rgba(31, 111, 235, 0.07);
  border-color: rgba(31, 111, 235, 0.18);
}
.perm-read .perm-flag {
  color: #1d4ed8;
  font-weight: 600;
}
.role-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 6px;
  border-top: 1px dashed #eef2f8;
  font-size: 12px;
}
.drawer-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 12px;
  border-bottom: 1px solid #eef2f8;
}
.drawer-role {
  display: flex;
  align-items: center;
  gap: 10px;
}
.drawer-counts {
  font-size: 12px;
  color: #6b7d96;
}
.drawer-counts b {
  color: #1f6feb;
}
.drawer-section {
  margin-top: 16px;
}
.tree-box {
  max-height: 300px;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid #e9eef6;
  border-radius: 8px;
  background: #fbfcfe;
}
.tree-node {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding-right: 8px;
}
.tree-label {
  font-size: 13px;
  color: #24364f;
}
.tree-code {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  color: #1d4ed8;
  background: rgba(31, 111, 235, 0.08);
}
.tree-path {
  font-size: 11px;
}
.tree-perm {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.api-group {
  margin-bottom: 10px;
  padding: 8px 10px;
  border: 1px solid #eef2f8;
  border-radius: 8px;
}
.api-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #24364f;
}
.api-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 12px;
}
.api-item {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 26px;
}
.api-name {
  margin: 0 6px;
  font-size: 12.5px;
  color: #24364f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.api-path {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.method {
  flex-shrink: 0;
  width: 42px;
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 0;
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
.footer-tip {
  margin-right: auto;
  font-size: 12px;
}
</style>
