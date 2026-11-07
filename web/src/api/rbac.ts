import { http } from '@/api/client';

/* ============================ 通用类型 ============================ */

export type DataScope = 'ALL' | 'DEPT' | 'SELF';

export interface RoleBrief {
  id: number;
  role_code: string;
  role_name: string;
  data_scope: DataScope;
}

export interface ModulePermCell {
  read: boolean;
  write: boolean;
}

export interface RbacModule {
  code: string;
  name: string;
}

/* ============================ 概览 ============================ */

export interface RbacOverview {
  userTotal: number;
  userActive: number;
  userDisabled: number;
  lockedCount: number;
  roleTotal: number;
  deptTotal: number;
  menuTotal: number;
  topMenuTotal: number;
  apiTotal: number;
  loginFail7d: number;
  loginFailToday: number;
  lastLoginFailAt: string | null;
  generatedAt: string;
}

/* ============================ 用户管理 ============================ */

export interface RbacUser {
  id: number;
  username: string;
  real_name: string;
  dept_id: number | null;
  dept_name: string | null;
  job_title: string | null;
  phone: string | null;
  email: string | null;
  avatar_color: string | null;
  status: number;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string | null;
  roles: RoleBrief[];
}

export interface UserQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  deptId?: number | string;
  status?: number | string;
  roleCode?: string;
}

export interface UserCreatePayload {
  username: string;
  real_name: string;
  password: string;
  dept_id: number | null;
  job_title?: string | null;
  phone?: string | null;
  email?: string | null;
  roleCodes: string[];
}

export interface UserUpdatePayload {
  real_name: string;
  dept_id: number | null;
  job_title?: string | null;
  phone?: string | null;
  email?: string | null;
  roleCodes?: string[];
}

/* ============================ 角色与权限 ============================ */

export interface RbacRole {
  id: number;
  role_code: string;
  role_name: string;
  description: string | null;
  data_scope: DataScope;
  status: number;
  is_super_admin: boolean;
  created_at: string;
  userCount: number;
  menuCount: number;
  apiCount: number;
  perms: Record<string, ModulePermCell>;
}

export interface RoleListResult {
  list: RbacRole[];
  modules: RbacModule[];
  generatedAt?: string;
}

export interface MenuPermNode {
  id: number;
  parent_id: number;
  menu_name: string;
  path: string | null;
  icon: string | null;
  permission_code: string | null;
  menu_type: string;
  sort: number;
  visible: number;
  checked: boolean;
  perm_read: boolean;
  perm_write: boolean;
  children: MenuPermNode[];
}

export interface ApiPermissionRow {
  id: number;
  api_code: string;
  api_name: string;
  api_group: string;
  method: string;
  path: string;
}

export interface ApiPermissionWithCheck extends ApiPermissionRow {
  checked: boolean;
}

export interface RolePermissionDetail {
  role: {
    id: number;
    role_code: string;
    role_name: string;
    description: string | null;
    data_scope: DataScope;
    status: number;
  };
  menus: MenuPermNode[];
  apis: ApiPermissionWithCheck[];
  menuCount: number;
  apiCount: number;
}

export interface RoleMenuGrant {
  menu_id: number;
  perm_read: boolean;
  perm_write: boolean;
}

export interface RolePermissionPayload {
  menus: RoleMenuGrant[];
  apiIds: number[];
}

/* ============================ 菜单权限 ============================ */

export interface MenuTreeNode {
  id: number;
  parent_id: number;
  menu_name: string;
  path: string | null;
  icon: string | null;
  permission_code: string | null;
  menu_type: string;
  sort: number;
  visible: number;
  children: MenuTreeNode[];
}

export interface MenuFlatRow extends Omit<MenuTreeNode, 'children'> {
  label?: string;
}

export interface RoleBriefSimple {
  id: number;
  role_code: string;
  role_name: string;
}

export interface MenuGrantRow {
  role_id: number;
  role_code: string;
  role_name: string;
  menuIds: number[];
}

export interface MenuPermissionData {
  list: MenuTreeNode[];
  flat: MenuFlatRow[];
  roles: RoleBriefSimple[];
  grants: MenuGrantRow[];
}

/* ============================ 接口权限 ============================ */

export interface ApiGroupInfo {
  code: string;
  name: string;
  count: number;
}

export interface ApiGrantRow {
  role_id: number;
  role_code: string;
  role_name: string;
  apiIds: number[];
}

export interface ApiPermissionData {
  list: ApiPermissionRow[];
  roles: RoleBriefSimple[];
  groups: ApiGroupInfo[];
  grants: ApiGrantRow[];
  total: number;
}

/* ============================ 部门 ============================ */

export interface RbacDept {
  id: number;
  dept_code: string;
  dept_name: string;
  parent_id: number;
  leader: string | null;
  description: string | null;
  sort: number;
  status: number;
  created_at: string;
  userCount: number;
  assetCount: number;
}

export interface DeptListResult {
  list: RbacDept[];
  total: number;
}

/* ============================ 安全策略 ============================ */

export type PolicyType = 'number' | 'text';

export interface PolicyItem {
  key: string;
  label: string;
  value: string;
  type: PolicyType;
  unit: string | null;
  min: number | null;
  max: number | null;
  placeholder: string | null;
  description: string;
  updated_at: string | null;
  editable: boolean;
}

export interface PolicyGroup {
  code: string;
  name: string;
  count: number;
}

export interface PolicyData {
  items: PolicyItem[];
  groups: PolicyGroup[];
  passwordRule: string;
  updatedAt: string | null;
  note: string;
}

export interface PolicySaveItem {
  key: string;
  value: string;
}

/* ============================ 接口函数 ============================ */

export function getRbacOverview() {
  return http.get<RbacOverview>('/rbac/overview');
}

export function getUsers(params: UserQuery) {
  return http.get<RbacUser[]>('/rbac/users', { ...params });
}

export function createUser(payload: UserCreatePayload) {
  return http.post<RbacUser & { roles: RoleBrief[]; message: string }>('/rbac/users', payload);
}

export function updateUser(id: number, payload: UserUpdatePayload) {
  return http.put<{ id: number; message: string; roles: RoleBrief[] }>(`/rbac/users/${id}`, payload);
}

export function updateUserStatus(id: number, status: number) {
  return http.put<{ id: number; username: string; status: number; message: string }>(`/rbac/users/${id}/status`, {
    status,
  });
}

export function resetUserPassword(id: number, password: string) {
  return http.post<{ id: number; username: string; message: string }>(`/rbac/users/${id}/reset-password`, { password });
}

export function getRoles() {
  return http.get<RoleListResult>('/rbac/roles');
}

export function getRolePermissions(id: number) {
  return http.get<RolePermissionDetail>(`/rbac/roles/${id}/permissions`);
}

export function saveRolePermissions(id: number, payload: RolePermissionPayload) {
  return http.put<{
    role_id: number;
    role_code: string;
    role_name: string;
    menuCount: number;
    apiCount: number;
    affectedUsers: number;
    message: string;
  }>(`/rbac/roles/${id}/permissions`, payload);
}

export function getMenus() {
  return http.get<MenuPermissionData>('/rbac/menus');
}

export function getApis() {
  return http.get<ApiPermissionData>('/rbac/apis');
}

export function getDepts() {
  return http.get<DeptListResult>('/rbac/depts');
}

export function getPolicy() {
  return http.get<PolicyData>('/rbac/policy');
}

export function savePolicy(items: PolicySaveItem[]) {
  return http.put<{ items: PolicyItem[]; updatedAt: string | null; message: string }>('/rbac/policy', { items });
}
