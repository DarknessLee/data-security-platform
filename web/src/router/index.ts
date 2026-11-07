import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/views/auth/LoginView.vue'), meta: { title: '登录', public: true } },
  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/dashboard/DashboardHome.vue'), meta: { title: '平台总览', module: 'dashboard' } },

      { path: 'asset/list', name: 'asset-list', component: () => import('@/views/asset/AssetList.vue'), meta: { title: '资产台账', module: 'asset' } },
      { path: 'asset/categories', name: 'asset-categories', component: () => import('@/views/asset/AssetCategories.vue'), meta: { title: '分类分级', module: 'asset' } },
      { path: 'asset/lifecycle', name: 'asset-lifecycle', component: () => import('@/views/asset/AssetLifecycle.vue'), meta: { title: '生命周期', module: 'asset' } },

      { path: 'compliance/rules', name: 'compliance-rules', component: () => import('@/views/compliance/RuleLibrary.vue'), meta: { title: '合规规则库', module: 'compliance' } },
      { path: 'compliance/checks', name: 'compliance-checks', component: () => import('@/views/compliance/ComplianceChecks.vue'), meta: { title: '合规检查', module: 'compliance' } },
      { path: 'compliance/rectify', name: 'compliance-rectify', component: () => import('@/views/compliance/RectifyTracking.vue'), meta: { title: '整改跟踪', module: 'compliance' } },
      { path: 'compliance/masking', name: 'compliance-masking', component: () => import('@/views/compliance/MaskingManage.vue'), meta: { title: '脱敏管理', module: 'compliance' } },
      { path: 'compliance/approvals', name: 'compliance-approvals', component: () => import('@/views/compliance/ShareApprovals.vue'), meta: { title: '共享审批', module: 'compliance' } },
      { path: 'compliance/report', name: 'compliance-report', component: () => import('@/views/compliance/ComplianceReport.vue'), meta: { title: '合规报告', module: 'compliance' } },

      { path: 'risk/events', name: 'risk-events', component: () => import('@/views/risk/RiskEvents.vue'), meta: { title: '风险事件', module: 'risk' } },
      { path: 'risk/rules', name: 'risk-rules', component: () => import('@/views/risk/RiskRules.vue'), meta: { title: '监测规则', module: 'risk' } },
      { path: 'risk/realtime', name: 'risk-realtime', component: () => import('@/views/risk/RiskRealtime.vue'), meta: { title: '实时监控', module: 'risk' } },

      { path: 'rbac/users', name: 'rbac-users', component: () => import('@/views/rbac/UserManage.vue'), meta: { title: '用户管理', module: 'rbac' } },
      { path: 'rbac/roles', name: 'rbac-roles', component: () => import('@/views/rbac/RoleManage.vue'), meta: { title: '角色管理', module: 'rbac' } },
      { path: 'rbac/menus', name: 'rbac-menus', component: () => import('@/views/rbac/MenuPermission.vue'), meta: { title: '菜单权限', module: 'rbac' } },
      { path: 'rbac/apis', name: 'rbac-apis', component: () => import('@/views/rbac/ApiPermission.vue'), meta: { title: '接口权限', module: 'rbac' } },

      { path: 'audit/logs', name: 'audit-logs', component: () => import('@/views/audit/AuditLogs.vue'), meta: { title: '审计日志', module: 'audit' } },
      { path: 'audit/reports', name: 'audit-reports', component: () => import('@/views/audit/AuditReports.vue'), meta: { title: '审计报表', module: 'audit' } },

      { path: 'ops/monitor', name: 'ops-monitor', component: () => import('@/views/ops/OpsMonitor.vue'), meta: { title: '运行监控', module: 'ops' } },
      { path: 'ops/tickets', name: 'ops-tickets', component: () => import('@/views/ops/OpsTickets.vue'), meta: { title: '运维工单', module: 'ops' } },
      { path: 'ops/backups', name: 'ops-backups', component: () => import('@/views/ops/BackupManage.vue'), meta: { title: '数据备份', module: 'ops' } },
      { path: 'ops/configs', name: 'ops-configs', component: () => import('@/views/ops/PlatformConfig.vue'), meta: { title: '平台配置', module: 'ops' } },
      { path: 'ops/versions', name: 'ops-versions', component: () => import('@/views/ops/VersionManage.vue'), meta: { title: '版本管理', module: 'ops' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) return true;
  if (!auth.isLogged) return { path: '/login', query: { redirect: to.fullPath } };
  if (!auth.user) {
    try {
      await auth.fetchProfile();
    } catch {
      return { path: '/login' };
    }
  }
  const moduleCode = to.meta.module as string | undefined;
  if (moduleCode && !auth.canRead(moduleCode)) {
    ElMessage.warning('当前角色无权访问该模块');
    return { path: '/dashboard' };
  }
  return true;
});

router.afterEach((to) => {
  const title = (to.meta.title as string | undefined) ?? '';
  document.title = title ? `${title} - 大数据安全治理与服务保障平台` : '大数据安全治理与服务保障平台';
});

export default router;
