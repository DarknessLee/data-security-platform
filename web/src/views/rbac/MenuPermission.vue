<template>
  <section class="page">
    <PageHeader title="菜单权限" subtitle="查看平台菜单结构与各角色的菜单可见性；菜单级授权在「角色管理」中配置，保存后即时生效">
      <el-button @click="loadAll">刷新</el-button>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="菜单总数" :value="menuData?.flat.length ?? 0" hint="含目录与页面菜单" />
      <StatCard label="顶级目录" :value="topCount" tone="success" hint="对应 7 个业务模块" />
      <StatCard label="子菜单" :value="childCount" tone="info" hint="页面级菜单入口" />
      <StatCard label="授权关系" :value="grantCount" tone="warning" hint="角色 × 菜单 授权条目" />
    </div>

    <div class="grid-2-1">
      <el-card class="content-card" shadow="never">
        <div class="section-title">
          菜单结构
          <span class="sub">仅展示，勾选授权请前往角色管理</span>
        </div>
        <el-tree
          v-loading="loading"
          :data="menuData?.list ?? []"
          node-key="id"
          default-expand-all
          :expand-on-click-node="false"
          :props="treeProps"
          class="menu-tree"
        >
          <template #default="{ data }">
            <div class="tree-node">
              <span class="tree-label">{{ data.menu_name }}</span>
              <span v-if="data.permission_code" class="tree-code mono">{{ data.permission_code }}</span>
              <span v-else class="tree-path muted">{{ data.path }}</span>
              <el-tag v-if="data.menu_type === '目录'" size="small" type="info" effect="plain">目录</el-tag>
              <el-tag v-else size="small" effect="plain">页面</el-tag>
            </div>
          </template>
        </el-tree>
      </el-card>

      <el-card class="content-card" shadow="never">
        <div class="section-title">
          角色菜单授权概况
          <span class="sub">按角色统计已授权菜单数</span>
        </div>
        <div v-for="role in roleSummary" :key="role.id" class="role-line">
          <div class="role-line-head">
            <span class="role-line-name">{{ role.role_name }}</span>
            <span class="muted mono">{{ role.role_code }}</span>
            <b class="role-line-count">{{ role.count }} / {{ menuData?.flat.length ?? 0 }}</b>
          </div>
          <el-progress
            :percentage="menuTotal ? Math.round((role.count / menuTotal) * 100) : 0"
            :stroke-width="8"
            :show-text="false"
            :color="role.role_code === 'SUPER_ADMIN' ? '#dc2626' : '#1f6feb'"
          />
        </div>
        <EmptyState v-if="!roleSummary.length" description="暂无角色数据" />
      </el-card>
    </div>

    <el-card class="content-card" shadow="never">
      <div class="section-title">
        角色 × 菜单 可见性矩阵
        <span class="sub">✓ 表示该角色登录后可见此菜单</span>
      </div>
      <el-form :inline="true" class="filter-form" @submit.prevent>
        <el-form-item label="菜单筛选">
          <el-input v-model="keyword" placeholder="菜单名称 / 权限码 / 路径" clearable style="width: 240px" />
        </el-form-item>
        <el-form-item>
          <span class="muted">共 {{ filteredRows.length }} 个菜单，{{ menuData?.roles.length ?? 0 }} 个角色</span>
        </el-form-item>
      </el-form>
      <el-table v-loading="loading" :data="filteredRows" border stripe size="small" row-key="id" max-height="560">
        <el-table-column label="菜单名称" min-width="260" fixed>
          <template #default="{ row }">
            <div class="matrix-name" :style="{ paddingLeft: `${row.depth * 16}px` }">
              <span class="tree-label">{{ row.menu_name }}</span>
              <span v-if="row.permission_code" class="tree-code mono">{{ row.permission_code }}</span>
              <span v-else class="tree-path muted">{{ row.path }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="70" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.menu_type === '目录' ? 'info' : 'primary'" effect="plain">
              {{ row.menu_type === '目录' ? '目录' : '页面' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          v-for="role in menuData?.roles ?? []"
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
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import EmptyState from '@/components/EmptyState.vue';
import { getMenus, type MenuFlatRow, type MenuPermissionData, type MenuTreeNode } from '@/api/rbac';

const menuData = ref<MenuPermissionData | null>(null);
const loading = ref(false);
const keyword = ref('');
const treeProps = { label: 'menu_name', children: 'children' };

const menuTotal = computed(() => menuData.value?.flat.length ?? 0);
const topCount = computed(() => (menuData.value?.list.length ?? 0));
const childCount = computed(() => menuTotal.value - topCount.value);
const grantCount = computed(() =>
  (menuData.value?.grants ?? []).reduce((sum, g) => sum + g.menuIds.length, 0),
);

const grantMap = computed(() => {
  const map = new Map<number, Set<number>>();
  for (const grant of menuData.value?.grants ?? []) {
    map.set(grant.role_id, new Set(grant.menuIds.map(Number)));
  }
  return map;
});

const roleSummary = computed(() => {
  const roles = menuData.value?.roles ?? [];
  return roles
    .map((role) => ({ ...role, count: grantOf(role.id).size }))
    .sort((a, b) => b.count - a.count);
});

/** 按菜单树层级展开（目录在前、子菜单紧随其后），保证矩阵行顺序与菜单结构一致 */
const orderedRows = computed(() => {
  const rows: Array<MenuFlatRow & { depth: number }> = [];
  const walk = (nodes: MenuTreeNode[], depth: number) => {
    for (const node of nodes) {
      const { children, ...rest } = node;
      rows.push({ ...rest, depth });
      if (children?.length) walk(children, depth + 1);
    }
  };
  walk(menuData.value?.list ?? [], 0);
  return rows;
});

const filteredRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  const rows = orderedRows.value;
  if (!kw) return rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const keep = new Set<number>();
  for (const row of rows) {
    const hit = [row.menu_name, row.permission_code ?? '', row.path ?? '']
      .join(' ')
      .toLowerCase()
      .includes(kw);
    if (!hit) continue;
    keep.add(row.id);
    // 命中子菜单时保留其祖先链路，缩进层级仍然可读
    let parentId = row.parent_id;
    while (parentId && byId.has(parentId) && !keep.has(parentId)) {
      keep.add(parentId);
      parentId = byId.get(parentId)?.parent_id ?? 0;
    }
  }
  return rows.filter((row) => keep.has(row.id));
});

function grantOf(roleId: number): Set<number> {
  return grantMap.value.get(roleId) ?? new Set<number>();
}

async function loadAll() {
  loading.value = true;
  try {
    const { data } = await getMenus();
    menuData.value = data;
  } catch {
    menuData.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadAll();
});
</script>

<style scoped>
.menu-tree {
  max-height: 420px;
  overflow: auto;
  padding: 4px;
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
.role-line {
  margin-bottom: 12px;
}
.role-line-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
  font-size: 12.5px;
}
.role-line-name {
  color: #24364f;
  font-weight: 600;
}
.role-line-count {
  margin-left: auto;
  color: #1f6feb;
  font-variant-numeric: tabular-nums;
}
.filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin-bottom: 10px;
}
.matrix-name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.grant-yes {
  color: #16a34a;
  font-weight: 700;
}
.grant-no {
  color: #cbd5e1;
}
</style>
