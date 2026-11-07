// 主数据种子：部门、角色、用户、菜单、接口权限、参数、通知
import bcrypt from 'bcryptjs';
import { BASE_TIME, fmtDateTime, hoursAgo } from './lib.mjs';

export const DEPTS = [
  { code: 'D001', name: '数据管理中心', leader: '张建国', desc: '负责数据资产盘点、分类分级与数据质量管理', sort: 1 },
  { code: 'D002', name: '安全合规部', leader: '王慧敏', desc: '负责数据安全合规检查、风险评估与整改跟踪', sort: 2 },
  { code: 'D003', name: '运维保障部', leader: '李志强', desc: '负责平台运行监控、备份恢复与工单处理', sort: 3 },
  { code: 'D004', name: '审计监察部', leader: '赵晓东', desc: '负责安全审计、日志核查与责任追溯', sort: 4 },
  { code: 'D005', name: '业务运营部', leader: '陈雪梅', desc: '负责数据共享申请、业务数据使用与需求对接', sort: 5 },
  { code: 'D006', name: '技术研发部', leader: '刘文博', desc: '负责平台研发、接口集成与版本迭代', sort: 6 },
];

export const ROLES = [
  { code: 'SUPER_ADMIN', name: '超级管理员', desc: '平台最高权限，负责全局配置与账号管理', scope: 'ALL' },
  { code: 'SEC_ADMIN', name: '安全管理员', desc: '负责安全策略、风险处置与合规管理', scope: 'ALL' },
  { code: 'COMPLIANCE_OFFICER', name: '合规专员', desc: '负责合规检查、整改跟踪与共享审批', scope: 'DEPT' },
  { code: 'DATA_STEWARD', name: '数据管理员', desc: '负责数据资产台账、分类分级与生命周期维护', scope: 'DEPT' },
  { code: 'AUDITOR', name: '审计员', desc: '负责审计日志核查与报表审阅，只读权限', scope: 'ALL' },
  { code: 'OPS', name: '运维工程师', desc: '负责运行监控、备份恢复与运维工单', scope: 'DEPT' },
  { code: 'DEPT_HEAD', name: '部门主管', desc: '负责本部门数据使用审批与风险确认', scope: 'DEPT' },
  { code: 'ANALYST', name: '数据分析师', desc: '按需使用授权数据，仅可查看本人相关数据', scope: 'SELF' },
];

/** 六大模块顶级菜单 + 子页面；perm_code 对应模块读写权限 */
export const MENUS = [
  { name: '平台总览', path: '/dashboard', icon: 'Odometer', code: 'dashboard', sort: 1, children: [] },
  {
    name: '数据资产治理', path: '/asset', icon: 'Coin', code: 'asset', sort: 2, children: [
      { name: '资产台账', path: '/asset/list', icon: 'Files', sort: 1 },
      { name: '分类分级', path: '/asset/categories', icon: 'Grid', sort: 2 },
      { name: '生命周期', path: '/asset/lifecycle', icon: 'Refresh', sort: 3 },
    ],
  },
  {
    name: '安全合规管理', path: '/compliance', icon: 'DocumentChecked', code: 'compliance', sort: 3, children: [
      { name: '合规规则库', path: '/compliance/rules', icon: 'Notebook', sort: 1 },
      { name: '合规检查', path: '/compliance/checks', icon: 'Finished', sort: 2 },
      { name: '整改跟踪', path: '/compliance/rectify', icon: 'EditPen', sort: 3 },
      { name: '脱敏管理', path: '/compliance/masking', icon: 'Hide', sort: 4 },
      { name: '共享审批', path: '/compliance/approvals', icon: 'Stamp', sort: 5 },
      { name: '合规报告', path: '/compliance/report', icon: 'DataAnalysis', sort: 6 },
    ],
  },
  {
    name: '智能风险监测', path: '/risk', icon: 'Warning', code: 'risk', sort: 4, children: [
      { name: '风险事件', path: '/risk/events', icon: 'Bell', sort: 1 },
      { name: '监测规则', path: '/risk/rules', icon: 'SetUp', sort: 2 },
      { name: '实时监控', path: '/risk/realtime', icon: 'Histogram', sort: 3 },
    ],
  },
  {
    name: '权限安全管控', path: '/rbac', icon: 'UserFilled', code: 'rbac', sort: 5, children: [
      { name: '用户管理', path: '/rbac/users', icon: 'User', sort: 1 },
      { name: '角色管理', path: '/rbac/roles', icon: 'Avatar', sort: 2 },
      { name: '菜单权限', path: '/rbac/menus', icon: 'Menu', sort: 3 },
      { name: '接口权限', path: '/rbac/apis', icon: 'Connection', sort: 4 },
    ],
  },
  {
    name: '安全审计追溯', path: '/audit', icon: 'Tickets', code: 'audit', sort: 6, children: [
      { name: '审计日志', path: '/audit/logs', icon: 'List', sort: 1 },
      { name: '审计报表', path: '/audit/reports', icon: 'TrendCharts', sort: 2 },
    ],
  },
  {
    name: '服务保障运维', path: '/ops', icon: 'Monitor', code: 'ops', sort: 7, children: [
      { name: '运行监控', path: '/ops/monitor', icon: 'Cpu', sort: 1 },
      { name: '运维工单', path: '/ops/tickets', icon: 'Service', sort: 2 },
      { name: '数据备份', path: '/ops/backups', icon: 'FolderOpened', sort: 3 },
      { name: '平台配置', path: '/ops/configs', icon: 'Setting', sort: 4 },
      { name: '版本管理', path: '/ops/versions', icon: 'Box', sort: 5 },
    ],
  },
];

/** 角色 × 模块权限：r=读 w=写 */
export const ROLE_PERMS = {
  SUPER_ADMIN: { dashboard: 'rw', asset: 'rw', compliance: 'rw', risk: 'rw', rbac: 'rw', audit: 'rw', ops: 'rw' },
  SEC_ADMIN: { dashboard: 'rw', asset: 'rw', compliance: 'rw', risk: 'rw', rbac: 'r', audit: 'r', ops: 'r' },
  COMPLIANCE_OFFICER: { dashboard: 'r', asset: 'rw', compliance: 'rw', risk: 'rw', rbac: 'r', audit: 'r', ops: 'r' },
  DATA_STEWARD: { dashboard: 'r', asset: 'rw', compliance: 'rw', risk: 'r', rbac: 'r', audit: 'r', ops: 'r' },
  AUDITOR: { dashboard: 'r', asset: 'r', compliance: 'r', risk: 'r', rbac: 'r', audit: 'r', ops: 'r' },
  OPS: { dashboard: 'r', asset: 'r', compliance: 'r', risk: 'r', rbac: 'r', audit: 'r', ops: 'rw' },
  DEPT_HEAD: { dashboard: 'r', asset: 'r', compliance: 'r', risk: 'r', rbac: 'r', audit: 'r', ops: 'r' },
  ANALYST: { dashboard: 'r', asset: 'r', compliance: 'r', risk: 'r', ops: 'r' },
};

export const USERS = [
  { username: 'admin', password: 'Admin@2026', realName: '张建国', dept: 'D001', title: '平台管理员', role: 'SUPER_ADMIN', color: '#1f6feb', phone: '13800010101' },
  { username: 'secadmin', password: 'Sec@2026', realName: '王慧敏', dept: 'D002', title: '安全管理员', role: 'SEC_ADMIN', color: '#e8590c', phone: '13800010202' },
  { username: 'compliance', password: 'Comp@2026', realName: '周雅琴', dept: 'D002', title: '数据合规专员', role: 'COMPLIANCE_OFFICER', color: '#0b7285', phone: '13800010303' },
  { username: 'steward', password: 'Steward@2026', realName: '李志强', dept: 'D001', title: '数据资产管理员', role: 'DATA_STEWARD', color: '#2b8a3e', phone: '13800010404' },
  { username: 'auditor', password: 'Audit@2026', realName: '赵晓东', dept: 'D004', title: '安全审计员', role: 'AUDITOR', color: '#6741d9', phone: '13800010505' },
  { username: 'ops', password: 'Ops@2026', realName: '刘文博', dept: 'D003', title: '运维工程师', role: 'OPS', color: '#c92a2a', phone: '13800010606' },
  { username: 'depthead', password: 'Dept@2026', realName: '陈雪梅', dept: 'D005', title: '业务运营部主管', role: 'DEPT_HEAD', color: '#1864ab', phone: '13800010707' },
  { username: 'analyst', password: 'Analyst@2026', realName: '孙静怡', dept: 'D005', title: '数据分析师', role: 'ANALYST', color: '#5f3dc4', phone: '13800010808' },
  { username: 'guest', password: 'Guest@2026', realName: '黄海涛', dept: 'D004', title: '外部协作审计', role: 'AUDITOR', color: '#495057', phone: '13800010909' },
];

/** 接口权限清单（四级权限中的“接口权限”一列） */
export const API_PERMS = [
  ['auth', '登录认证', 'POST', '/api/auth/login'],
  ['auth', '退出登录', 'POST', '/api/auth/logout'],
  ['auth', '读取当前用户', 'GET', '/api/auth/profile'],
  ['auth', '读取可见菜单', 'GET', '/api/auth/menus'],
  ['dashboard', '平台总览', 'GET', '/api/dashboard/overview'],
  ['dashboard', '趋势分析', 'GET', '/api/dashboard/trend'],
  ['asset', '资产列表', 'GET', '/api/assets'],
  ['asset', '资产详情', 'GET', '/api/assets/:id'],
  ['asset', '新增资产', 'POST', '/api/assets'],
  ['asset', '编辑资产', 'PUT', '/api/assets/:id'],
  ['asset', '资产扫描', 'POST', '/api/assets/scan'],
  ['asset', '资产统计', 'GET', '/api/assets/stats'],
  ['asset', '生命周期记录', 'GET', '/api/assets/:id/lifecycle'],
  ['compliance', '规则库列表', 'GET', '/api/compliance/rules'],
  ['compliance', '规则维护', 'POST', '/api/compliance/rules'],
  ['compliance', '执行合规检查', 'POST', '/api/compliance/checks/run'],
  ['compliance', '检查结果', 'GET', '/api/compliance/checks'],
  ['compliance', '整改单更新', 'PUT', '/api/compliance/rectifications/:id'],
  ['compliance', '脱敏规则维护', 'PUT', '/api/compliance/masking-rules/:id'],
  ['compliance', '共享审批处理', 'POST', '/api/compliance/approvals/:id/decide'],
  ['compliance', '合规报告', 'GET', '/api/compliance/report'],
  ['risk', '风险事件列表', 'GET', '/api/risk/events'],
  ['risk', '风险事件处置', 'POST', '/api/risk/events/:id/handle'],
  ['risk', '监测规则维护', 'POST', '/api/risk/rules'],
  ['risk', '风险统计', 'GET', '/api/risk/stats'],
  ['rbac', '用户列表', 'GET', '/api/rbac/users'],
  ['rbac', '新增用户', 'POST', '/api/rbac/users'],
  ['rbac', '编辑用户', 'PUT', '/api/rbac/users/:id'],
  ['rbac', '重置密码', 'POST', '/api/rbac/users/:id/reset-password'],
  ['rbac', '角色维护', 'PUT', '/api/rbac/roles/:id'],
  ['rbac', '角色菜单授权', 'PUT', '/api/rbac/roles/:id/menus'],
  ['rbac', '菜单列表', 'GET', '/api/rbac/menus'],
  ['audit', '审计日志查询', 'GET', '/api/audit/logs'],
  ['audit', '审计日志导出', 'GET', '/api/audit/logs/export'],
  ['audit', '审计统计', 'GET', '/api/audit/stats'],
  ['audit', '审计报表生成', 'POST', '/api/audit/reports/generate'],
  ['ops', '系统健康度', 'GET', '/api/ops/health'],
  ['ops', '监控指标', 'GET', '/api/ops/metrics'],
  ['ops', '工单列表', 'GET', '/api/ops/tickets'],
  ['ops', '工单处理', 'PUT', '/api/ops/tickets/:id'],
  ['ops', '备份执行', 'POST', '/api/ops/backups'],
  ['ops', '配置维护', 'PUT', '/api/ops/configs/:key'],
  ['ops', '通知已读', 'PUT', '/api/ops/notifications/:id/read'],
];

export const CONFIGS = [
  ['platform.name', '大数据安全治理与服务保障平台', '基础信息', '平台显示名称'],
  ['platform.version', 'V1.0.0', '基础信息', '当前发布版本'],
  ['security.password.min_length', '10', '安全策略', '密码最小长度'],
  ['security.password.expire_days', '90', '安全策略', '密码有效期（天）'],
  ['security.login.max_fail', '5', '安全策略', '连续登录失败锁定阈值'],
  ['security.login.lock_minutes', '30', '安全策略', '账号锁定时长（分钟）'],
  ['security.session.expire_hours', '12', '安全策略', '登录会话有效期（小时）'],
  ['security.ip.whitelist', '10.10.0.0/16,172.16.8.0/24', '安全策略', '后台登录 IP 白名单'],
  ['asset.scan.schedule', '每日 02:00', '数据治理', '资产自动扫描计划'],
  ['compliance.check.schedule', '每周一 03:00', '数据治理', '合规自动检查计划'],
  ['risk.alert.channels', '站内消息,邮件', '风险监测', '风险预警通知渠道'],
  ['ops.backup.schedule', '每日 01:30', '运维保障', '全量备份计划'],
];

export async function seedReference(conn) {
  const rng = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return (a - 1) / 2147483646; }; })();
  const roleIdByCode = {};
  const deptIdByCode = {};
  const userIdByUsername = {};

  for (const d of DEPTS) {
    const [r] = await conn.query(
      'INSERT INTO sys_dept (dept_code, dept_name, parent_id, leader, description, sort) VALUES (?,?,?,?,?,?)',
      [d.code, d.name, 0, d.leader, d.desc, d.sort],
    );
    deptIdByCode[d.code] = r.insertId;
  }

  for (const role of ROLES) {
    const [r] = await conn.query('INSERT INTO sys_role (role_code, role_name, description, data_scope) VALUES (?,?,?,?)', [role.code, role.name, role.desc, role.scope]);
    roleIdByCode[role.code] = r.insertId;
  }

  const hash = (pwd) => bcrypt.hashSync(pwd, 10);
  for (const u of USERS) {
    const loginAt = hoursAgo(2 + Math.floor(rng() * 40));
    const [r] = await conn.query(
      `INSERT INTO sys_user (username, password_hash, real_name, dept_id, job_title, phone, email, avatar_color, status, last_login_at, last_login_ip, pwd_updated_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?)`,
      [u.username, hash(u.password), u.realName, deptIdByCode[u.dept], u.title, u.phone, `${u.username}@datasec.gov.cn`, u.color, fmtDateTime(loginAt), `10.10.${Math.floor(rng() * 30) + 1}.${Math.floor(rng() * 200) + 10}`, fmtDateTime(new Date(BASE_TIME.getTime() - 40 * 864e5)), fmtDateTime(new Date(BASE_TIME.getTime() - 90 * 864e5))],
    );
    userIdByUsername[u.username] = r.insertId;
    await conn.query('INSERT INTO sys_user_role (user_id, role_id) VALUES (?,?)', [r.insertId, roleIdByCode[u.role]]);
  }

  // 菜单树 + 角色菜单授权
  let menuSort = 0;
  const moduleMenuIds = {};
  for (const m of MENUS) {
    menuSort += 1;
    const parentId = 0;
    const [r] = await conn.query(
      'INSERT INTO sys_menu (parent_id, menu_name, path, icon, permission_code, menu_type, sort, visible) VALUES (?,?,?,?,?,?,?,1)',
      [parentId, m.name, m.path, m.icon, m.code || null, '目录', menuSort * 10],
    );
    moduleMenuIds[m.code || m.name] = r.insertId;
    let childSort = 0;
    for (const c of m.children) {
      childSort += 1;
      await conn.query(
        'INSERT INTO sys_menu (parent_id, menu_name, path, icon, permission_code, menu_type, sort, visible) VALUES (?,?,?,?,?,?,?,1)',
        [r.insertId, c.name, c.path, c.icon || 'Menu', null, '菜单', childSort],
      );
    }
  }

  for (const [roleCode, perms] of Object.entries(ROLE_PERMS)) {
    for (const [moduleCode, flags] of Object.entries(perms)) {
      const menuId = moduleMenuIds[moduleCode];
      if (!menuId) continue;
      await conn.query('INSERT INTO sys_role_menu (role_id, menu_id, perm_read, perm_write) VALUES (?,?,?,?)', [
        roleIdByCode[roleCode], menuId, flags.includes('r') ? 1 : 0, flags.includes('w') ? 1 : 0,
      ]);
    }
  }

  // 接口权限清单 + 角色接口授权（写权限角色才授予写接口）
  const apiIdByModule = {};
  for (const [moduleCode, name, method, path] of API_PERMS) {
    const [r] = await conn.query(
      'INSERT INTO sys_api_permission (api_code, api_name, api_group, method, path) VALUES (?,?,?,?,?)',
      [`${moduleCode}:${method.toLowerCase()}:${path.replace(/^\/api\//, '').replace(/[/:]/g, '_')}`, name, moduleCode, method, path],
    );
    (apiIdByModule[moduleCode] ||= []).push({ id: r.insertId, method });
  }
  for (const [roleCode, perms] of Object.entries(ROLE_PERMS)) {
    for (const [moduleCode, flags] of Object.entries(perms)) {
      for (const api of apiIdByModule[moduleCode] || []) {
        const isWrite = api.method !== 'GET';
        if (isWrite && !flags.includes('w')) continue;
        await conn.query('INSERT INTO sys_role_api (role_id, api_permission_id) VALUES (?,?)', [roleIdByCode[roleCode], api.id]);
      }
    }
  }

  for (const [key, value, group, desc] of CONFIGS) {
    await conn.query('INSERT INTO sys_config (config_key, config_value, config_group, description) VALUES (?,?,?,?)', [key, value, group, desc]);
  }

  const notis = [
    ['紧急', '高危风险事件待处置', '监测到“批量导出客户身份信息”高危行为，请安全管理员在 2 小时内完成处置。', 'risk', 1, null],
    ['警告', '合规检查发现 3 项不通过', '2026 年 11 月第一批合规检查已完成，共 3 项不通过，需在 11 月 20 日前完成整改。', 'compliance', 1, null],
    ['信息', '平台版本 V1.0.0 已发布', '本次发布包含数据资产台账、风险监测与审计报表增强，详见版本管理。', 'system', 0, null],
    ['警告', '全量备份任务已完成', '2026-11-07 01:30 全量备份完成，备份大小 18.4 GB，校验值已核验。', 'backup', 7, 'ops'],
    ['信息', '数据共享审批待处理', '业务运营部提交的“人口基础信息库共享申请”等待您的审批。', 'compliance', 0, 'secadmin'],
    ['紧急', '账号异地登录拦截', '账号 analyst 于 11-07 03:12 在异地尝试登录，已被平台拦截。', 'risk', 0, 'secadmin'],
    ['信息', '数据资产扫描完成', '本次自动扫描发现新增资产 6 项、待治理资产 3 项。', 'asset', 0, 'steward'],
    ['警告', '数据库连接数接近阈值', '主库当前连接数 168/200，请运维工程师关注并优化慢查询。', 'system', 0, 'ops'],
    ['信息', '运维工单待受理', '工单 TK-20261107-001“报表导出超时”等待运维工程师受理。', 'ticket', 0, 'ops'],
    ['信息', '月度安全审计报告已生成', '《2026 年 10 月数据安全审计报告》已归档，可下载查阅。', 'audit', 0, 'auditor'],
  ];
  let ni = 0;
  for (const [level, title, content, bizType, readFlag, username] of notis) {
    await conn.query(
      'INSERT INTO notification (user_id, title, content, level, read_flag, biz_type, created_at) VALUES (?,?,?,?,?,?,?)',
      [username ? userIdByUsername[username] : null, title, content, level, readFlag, bizType, fmtDateTime(hoursAgo(3 + ni * 5))],
    );
    ni += 1;
  }

  return { roleIdByCode, deptIdByCode, userIdByUsername, moduleMenuIds };
}
