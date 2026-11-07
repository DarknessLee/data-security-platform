import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { ResultSetHeader } from 'mysql2';
import { z } from 'zod';
import { pool, query, queryOne } from '../../db/pool.ts';
import { invalidate, isRedisReady, redis } from '../../db/redis.ts';
import { ApiError, ok } from '../../lib/http.ts';
import { numOrUndef, pageMeta, parsePagination, strOrUndef } from '../../lib/query.ts';
import { fmtDateTime } from '../../lib/time.ts';
import { authenticate, currentUser, requirePerm } from '../../middleware/auth.ts';

/**
 * 权限安全管控（module: rbac）
 * 覆盖：用户管理 / 角色管理 / 菜单权限 / 接口权限 / 安全策略。
 * 读接口 requirePerm('rbac')，写接口 requirePerm('rbac','write')；
 * 所有写操作均落 audit_log（app 级 auditWriter 自动写入），并在权限变更后清理 auth:user:<id> 缓存保证立即生效。
 */
export const rbacRouter = Router();
rbacRouter.use(authenticate);

const SUPER_ADMIN_CODE = 'SUPER_ADMIN';
const SECURITY_GROUP = '安全策略';

/* ------------------------------------------------------------------ */
/* 通用工具                                                             */
/* ------------------------------------------------------------------ */

async function getConfig(key: string, fallback: string): Promise<string> {
  const row = await queryOne<{ config_value: string }>('SELECT config_value FROM sys_config WHERE config_key = ?', [key]);
  return row?.config_value ?? fallback;
}

/** DATETIME 统一格式化为 YYYY-MM-DD HH:mm:ss（mysql2 返回 Date / DATE 列返回字符串） */
function dt(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : fmtDateTime(d);
}

function idParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, '无效的资源 ID');
  return id;
}

/** 统一把 boolean / 0|1 归一化为布尔值 */
function bit(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}

/** 密码策略校验：长度取 sys_config，复杂度要求大小写+数字+特殊字符 */
async function assertPasswordPolicy(password: string): Promise<number> {
  const minLength = Number(await getConfig('security.password.min_length', '10'));
  if (!Number.isFinite(minLength) || minLength <= 0) return 0;
  if (password.length < minLength) throw new ApiError(400, `密码长度不得少于 ${minLength} 位`);
  const strong = /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
  if (!strong) throw new ApiError(400, '密码需同时包含大写字母、小写字母、数字与特殊字符');
  return minLength;
}

/** 清理登录失败/锁定计数（Redis 不可用时静默降级） */
async function clearLoginLock(username: string): Promise<void> {
  if (!isRedisReady()) return;
  try {
    await redis.del(`login:fail:${username}`, `login:lock:${username}`);
  } catch {
    /* 降级 */
  }
}

/** Redis 中处于登录锁定状态的账号名（用于 overview 锁定账号数） */
async function redisLockedUsernames(): Promise<string[]> {
  if (!isRedisReady()) return [];
  const names: string[] = [];
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'login:lock:*', 'COUNT', 100);
      cursor = next;
      for (const key of keys) names.push(key.slice('login:lock:'.length));
    } while (cursor !== '0');
  } catch {
    /* 降级 */
  }
  return names;
}

async function assertDept(deptId: number | null | undefined): Promise<void> {
  if (deptId === null || deptId === undefined) return;
  const row = await queryOne<{ id: number }>('SELECT id FROM sys_dept WHERE id = ?', [deptId]);
  if (!row) throw new ApiError(400, '所属部门不存在');
}

interface RoleBrief {
  id: number;
  role_code: string;
  role_name: string;
  data_scope: string;
}

/** 按角色编码解析角色，任一编码不存在即报错 */
async function resolveRoles(codes: string[]): Promise<RoleBrief[]> {
  const unique = [...new Set(codes.filter((c) => Boolean(c)))];
  if (!unique.length) throw new ApiError(400, '请至少选择一个角色');
  const placeholders = unique.map(() => '?').join(',');
  const rows = await query<RoleBrief>(
    `SELECT id, role_code, role_name, data_scope FROM sys_role WHERE role_code IN (${placeholders}) ORDER BY id`,
    unique,
  );
  const found = new Set(rows.map((r) => r.role_code));
  const missing = unique.filter((c) => !found.has(c));
  if (missing.length) throw new ApiError(400, `角色不存在：${missing.join('、')}`);
  return rows;
}

interface MenuRow {
  id: number;
  parent_id: number;
  menu_name: string;
  path: string | null;
  icon: string | null;
  permission_code: string | null;
  menu_type: string;
  sort: number;
  visible: number;
}

interface MenuNode extends MenuRow {
  checked?: boolean;
  perm_read?: boolean;
  perm_write?: boolean;
  children: MenuNode[];
}

/** 由扁平菜单行构建树（行需按 sort,id 排序；父节点缺失时提升为根） */
function buildMenuTree(rows: MenuRow[], decorate?: (row: MenuRow) => Partial<MenuNode>): MenuNode[] {
  const nodes = new Map<number, MenuNode>();
  for (const row of rows) {
    nodes.set(row.id, { ...row, ...(decorate?.(row) ?? {}), children: [] });
  }
  const roots: MenuNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (!node) continue;
    const parent = row.parent_id ? nodes.get(row.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

async function loadAllMenus(): Promise<MenuRow[]> {
  return query<MenuRow>(
    `SELECT id, parent_id, menu_name, path, icon, permission_code, menu_type, sort, visible
       FROM sys_menu ORDER BY sort, id`,
  );
}

function menuLabel(row: MenuRow): string {
  return row.menu_type === '目录' || row.menu_type === '菜单' ? row.menu_name : `${row.menu_name}`;
}

/** 清空指定角色下全部用户的权限缓存，使授权立即生效 */
async function invalidateRoleUsers(roleId: number): Promise<void> {
  const users = await query<{ user_id: number }>('SELECT user_id FROM sys_user_role WHERE role_id = ?', [roleId]);
  await Promise.all(users.map((u) => invalidate(`auth:user:${u.user_id}`)));
}

/* ------------------------------------------------------------------ */
/* 1. 权限总览                                                          */
/* ------------------------------------------------------------------ */

rbacRouter.get('/overview', requirePerm('rbac'), async (_req, res) => {
  const [userTotal, userActive, userDisabled, roleTotal, deptTotal, apiTotal, menuTotal, loginFail7d, loginFailToday] =
    await Promise.all([
      queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM sys_user'),
      queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM sys_user WHERE status = 1'),
      queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM sys_user WHERE status = 0'),
      queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM sys_role'),
      queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM sys_dept'),
      queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM sys_api_permission'),
      queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM sys_menu'),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM audit_log WHERE log_type = '登录日志' AND result = '失败'
           AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      ),
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM audit_log WHERE log_type = '登录日志' AND result = '失败' AND DATE(created_at) = CURDATE()`,
      ),
    ]);

  const statusLocked = await query<{ username: string }>('SELECT username FROM sys_user WHERE status = 2');
  const lockedSet = new Set(statusLocked.map((r) => r.username));
  for (const name of await redisLockedUsernames()) lockedSet.add(name);

  const menus = await loadAllMenus();
  const topMenus = menus.filter((m) => m.parent_id === 0);

  ok(res, {
    userTotal: Number(userTotal?.c ?? 0),
    userActive: Number(userActive?.c ?? 0),
    userDisabled: Number(userDisabled?.c ?? 0),
    lockedCount: lockedSet.size,
    roleTotal: Number(roleTotal?.c ?? 0),
    deptTotal: Number(deptTotal?.c ?? 0),
    menuTotal: Number(menuTotal?.c ?? 0),
    topMenuTotal: topMenus.length,
    apiTotal: Number(apiTotal?.c ?? 0),
    loginFail7d: Number(loginFail7d?.c ?? 0),
    loginFailToday: Number(loginFailToday?.c ?? 0),
    lastLoginFailAt: dt(
      (await queryOne<{ t: string | null }>(
        `SELECT MAX(created_at) AS t FROM audit_log WHERE log_type = '登录日志' AND result = '失败'`,
      ))?.t,
    ),
    generatedAt: fmtDateTime(new Date()),
  });
});

/* ------------------------------------------------------------------ */
/* 2. 用户管理                                                          */
/* ------------------------------------------------------------------ */

interface UserRow {
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
}

async function attachRoles<T extends { id: number }>(rows: T[]): Promise<Array<T & { roles: RoleBrief[] }>> {
  if (!rows.length) return rows.map((r) => ({ ...r, roles: [] as RoleBrief[] }));
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const roleRows = await query<RoleBrief & { user_id: number }>(
    `SELECT ur.user_id, r.id, r.role_code, r.role_name, r.data_scope
       FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
      WHERE ur.user_id IN (${placeholders})
      ORDER BY r.id`,
    ids,
  );
  const map = new Map<number, RoleBrief[]>();
  for (const row of roleRows) {
    const list = map.get(row.user_id) ?? [];
    list.push({ id: row.id, role_code: row.role_code, role_name: row.role_name, data_scope: row.data_scope });
    map.set(row.user_id, list);
  }
  return rows.map((r) => ({ ...r, roles: map.get(r.id) ?? [] }));
}

function mapUser(row: UserRow): Record<string, unknown> {
  return {
    id: row.id,
    username: row.username,
    real_name: row.real_name,
    dept_id: row.dept_id,
    dept_name: row.dept_name,
    job_title: row.job_title,
    phone: row.phone,
    email: row.email,
    avatar_color: row.avatar_color,
    status: row.status,
    last_login_at: dt(row.last_login_at),
    last_login_ip: row.last_login_ip,
    created_at: dt(row.created_at),
  };
}

rbacRouter.get('/users', requirePerm('rbac'), async (req, res) => {
  const p = parsePagination(req.query);
  const clauses: string[] = ['1 = 1'];
  const params: unknown[] = [];

  const keyword = strOrUndef(req.query.keyword);
  if (keyword) {
    clauses.push('(u.username LIKE ? OR u.real_name LIKE ? OR u.phone LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const deptId = numOrUndef(req.query.deptId);
  if (deptId !== undefined) {
    clauses.push('u.dept_id = ?');
    params.push(deptId);
  }
  const status = numOrUndef(req.query.status);
  if (status !== undefined) {
    clauses.push('u.status = ?');
    params.push(status);
  }
  const roleCode = strOrUndef(req.query.roleCode);
  if (roleCode) {
    clauses.push(`EXISTS (SELECT 1 FROM sys_user_role ur2 JOIN sys_role r2 ON r2.id = ur2.role_id
                          WHERE ur2.user_id = u.id AND r2.role_code = ?)`);
    params.push(roleCode);
  }
  const whereSql = `WHERE ${clauses.join(' AND ')}`;

  const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM sys_user u ${whereSql}`, params);
  const rows = await query<UserRow>(
    `SELECT u.id, u.username, u.real_name, u.dept_id, d.dept_name, u.job_title, u.phone, u.email,
            u.avatar_color, u.status, u.last_login_at, u.last_login_ip, u.created_at
       FROM sys_user u LEFT JOIN sys_dept d ON d.id = u.dept_id
       ${whereSql}
      ORDER BY u.id
      LIMIT ? OFFSET ?`,
    [...params, p.pageSize, p.offset],
  );

  const withRoles = await attachRoles(rows.map(mapUser) as Array<Record<string, unknown> & { id: number }>);
  ok(res, withRoles, { total: Number(totalRow?.c ?? 0), page: p.page, pageSize: p.pageSize });
});

const userCreateSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, '账号长度不得少于 3 位')
    .max(32, '账号长度不得超过 32 位')
    .regex(/^[A-Za-z][A-Za-z0-9_]{2,31}$/, '账号需以字母开头，仅可包含字母、数字与下划线'),
  real_name: z.string().trim().min(1, '请输入姓名').max(32, '姓名长度不得超过 32 位'),
  password: z.string().min(1, '请输入初始密码').max(64, '密码长度不得超过 64 位'),
  dept_id: z.number().int().positive().nullable().optional(),
  job_title: z.string().trim().max(64).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  email: z
    .string()
    .trim()
    .max(64)
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), '邮箱格式不正确')
    .nullable()
    .optional(),
  roleCodes: z.array(z.string().trim().min(1)).min(1, '请至少选择一个角色'),
});

rbacRouter.post('/users', requirePerm('rbac', 'write'), async (req, res) => {
  const payload = userCreateSchema.parse(req.body);
  await assertPasswordPolicy(payload.password);
  await assertDept(payload.dept_id);
  const exists = await queryOne<{ id: number }>('SELECT id FROM sys_user WHERE username = ?', [payload.username]);
  if (exists) throw new ApiError(400, `登录账号「${payload.username}」已存在，请更换`);
  const roles = await resolveRoles(payload.roleCodes);
  const passwordHash = await bcrypt.hash(payload.password, 10);

  const conn = await pool.getConnection();
  let userId = 0;
  try {
    await conn.beginTransaction();
    const [ins] = await conn.query(
      `INSERT INTO sys_user (username, password_hash, real_name, dept_id, job_title, phone, email, status, pwd_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [
        payload.username,
        passwordHash,
        payload.real_name,
        payload.dept_id ?? null,
        payload.job_title ?? null,
        payload.phone ?? null,
        payload.email || null,
      ],
    );
    userId = Number((ins as ResultSetHeader).insertId);
    for (const role of roles) {
      await conn.query('INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [userId, role.id]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await invalidate(`auth:user:${userId}`);
  req.auditAction = '新增用户';
  req.auditResource = '用户权限';
  req.auditDetail = `新增用户 ${payload.username}（${payload.real_name}），初始角色：${roles.map((r) => r.role_name).join('、')}`;

  const created = await queryOne<UserRow>(
    `SELECT u.id, u.username, u.real_name, u.dept_id, d.dept_name, u.job_title, u.phone, u.email,
            u.avatar_color, u.status, u.last_login_at, u.last_login_ip, u.created_at
       FROM sys_user u LEFT JOIN sys_dept d ON d.id = u.dept_id WHERE u.id = ?`,
    [userId],
  );
  const data = created ? mapUser(created) : { id: userId, username: payload.username };
  ok(res, { ...data, roles, message: '用户创建成功' });
});

const userUpdateSchema = z.object({
  real_name: z.string().trim().min(1, '请输入姓名').max(32).optional(),
  dept_id: z.number().int().positive().nullable().optional(),
  job_title: z.string().trim().max(64).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  email: z
    .string()
    .trim()
    .max(64)
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), '邮箱格式不正确')
    .nullable()
    .optional(),
  roleCodes: z.array(z.string().trim().min(1)).min(1, '请至少选择一个角色').optional(),
});

rbacRouter.put('/users/:id', requirePerm('rbac', 'write'), async (req, res) => {
  const id = idParam(req.params.id);
  const payload = userUpdateSchema.parse(req.body);
  const me = currentUser(req);
  const target = await queryOne<{ id: number; username: string; real_name: string }>(
    'SELECT id, username, real_name FROM sys_user WHERE id = ?',
    [id],
  );
  if (!target) throw new ApiError(404, '用户不存在');
  await assertDept(payload.dept_id);

  const targetRoles = await query<RoleBrief>(
    `SELECT r.id, r.role_code, r.role_name, r.data_scope FROM sys_role r
       JOIN sys_user_role ur ON ur.role_id = r.id WHERE ur.user_id = ?`,
    [id],
  );
  const isSuperAdmin = targetRoles.some((r) => r.role_code === SUPER_ADMIN_CODE);
  let roles: RoleBrief[] | null = null;

  if (payload.roleCodes) {
    if (id === me.id) throw new ApiError(400, '不能修改当前登录账号自身的角色绑定');
    roles = await resolveRoles(payload.roleCodes);
    if (isSuperAdmin && !roles.some((r) => r.role_code === SUPER_ADMIN_CODE)) {
      throw new ApiError(400, '不允许移除超级管理员账号的超级管理员角色');
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (payload.real_name !== undefined) {
    sets.push('real_name = ?');
    params.push(payload.real_name);
  }
  if (payload.dept_id !== undefined) {
    sets.push('dept_id = ?');
    params.push(payload.dept_id);
  }
  if (payload.job_title !== undefined) {
    sets.push('job_title = ?');
    params.push(payload.job_title);
  }
  if (payload.phone !== undefined) {
    sets.push('phone = ?');
    params.push(payload.phone);
  }
  if (payload.email !== undefined) {
    sets.push('email = ?');
    params.push(payload.email || null);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (sets.length) {
      await conn.query(`UPDATE sys_user SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, [...params, id]);
    }
    if (roles) {
      await conn.query('DELETE FROM sys_user_role WHERE user_id = ?', [id]);
      for (const role of roles) {
        await conn.query('INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [id, role.id]);
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // 角色或部门变化后必须清缓存，保证下一次请求立即使用新权限
  await invalidate(`auth:user:${id}`);
  req.auditAction = '编辑用户';
  req.auditResource = '用户权限';
  req.auditDetail = `编辑用户 ${target.username}（${target.real_name}）${roles ? `，角色调整为：${roles.map((r) => r.role_name).join('、')}` : ''}`;
  ok(res, { id, message: '用户信息已更新', roles });
});

const userStatusSchema = z.object({
  status: z
    .union([z.literal(0), z.literal(1)])
    .refine((v) => v === 0 || v === 1, '状态只能为 0（停用）或 1（启用）'),
});

rbacRouter.put('/users/:id/status', requirePerm('rbac', 'write'), async (req, res) => {
  const id = idParam(req.params.id);
  const { status } = userStatusSchema.parse(req.body);
  const me = currentUser(req);
  const target = await queryOne<{ id: number; username: string; real_name: string; status: number }>(
    'SELECT id, username, real_name, status FROM sys_user WHERE id = ?',
    [id],
  );
  if (!target) throw new ApiError(404, '用户不存在');
  if (id === me.id && status === 0) throw new ApiError(400, '不能停用当前登录账号');

  const targetRoles = await query<{ role_code: string }>(
    'SELECT r.role_code FROM sys_role r JOIN sys_user_role ur ON ur.role_id = r.id WHERE ur.user_id = ?',
    [id],
  );
  if (status === 0 && targetRoles.some((r) => r.role_code === SUPER_ADMIN_CODE)) {
    throw new ApiError(400, '不允许停用超级管理员账号');
  }

  await query('UPDATE sys_user SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);
  if (status === 1) await clearLoginLock(target.username);
  await invalidate(`auth:user:${id}`);

  req.auditAction = status === 0 ? '停用账号' : '启用账号';
  req.auditResource = '用户权限';
  req.auditDetail =
    status === 0
      ? `停用账号 ${target.username}（${target.real_name}），并清理其登录会话缓存`
      : `启用账号 ${target.username}（${target.real_name}），同时解除连续登录失败锁定`;
  ok(res, {
    id,
    username: target.username,
    status,
    message: status === 1 ? '账号已启用并解锁' : '账号已停用',
  });
});

const resetPasswordSchema = z.object({
  password: z.string().min(1, '请输入新密码').max(64, '密码长度不得超过 64 位'),
});

rbacRouter.post('/users/:id/reset-password', requirePerm('rbac', 'write'), async (req, res) => {
  const id = idParam(req.params.id);
  const { password } = resetPasswordSchema.parse(req.body);
  const minLength = await assertPasswordPolicy(password);
  const target = await queryOne<{ id: number; username: string; real_name: string }>(
    'SELECT id, username, real_name FROM sys_user WHERE id = ?',
    [id],
  );
  if (!target) throw new ApiError(404, '用户不存在');

  await query('UPDATE sys_user SET password_hash = ?, pwd_updated_at = NOW(), updated_at = NOW() WHERE id = ?', [
    await bcrypt.hash(password, 10),
    id,
  ]);
  await clearLoginLock(target.username);
  await invalidate(`auth:user:${id}`);

  req.auditAction = '重置用户密码';
  req.auditResource = '用户权限';
  req.auditDetail = `管理员重置账号 ${target.username}（${target.real_name}）密码，符合密码策略（≥${minLength} 位）`;
  ok(res, { id, username: target.username, message: '密码重置成功，请通知用户使用新密码登录' });
});

/* ------------------------------------------------------------------ */
/* 3. 角色管理                                                          */
/* ------------------------------------------------------------------ */

rbacRouter.get('/roles', requirePerm('rbac'), async (_req, res) => {
  const roles = await query<{
    id: number;
    role_code: string;
    role_name: string;
    description: string | null;
    data_scope: string;
    status: number;
    created_at: string | null;
  }>(
    `SELECT id, role_code, role_name, description, data_scope, status, created_at
       FROM sys_role ORDER BY id`,
  );
  const userCounts = await query<{ role_id: number; c: number }>('SELECT role_id, COUNT(*) AS c FROM sys_user_role GROUP BY role_id');
  const menuCounts = await query<{ role_id: number; c: number }>('SELECT role_id, COUNT(*) AS c FROM sys_role_menu GROUP BY role_id');
  const apiCounts = await query<{ role_id: number; c: number }>('SELECT role_id, COUNT(*) AS c FROM sys_role_api GROUP BY role_id');
  const modules = await query<{ code: string; name: string }>(
    `SELECT permission_code AS code, menu_name AS name FROM sys_menu
      WHERE parent_id = 0 AND permission_code IS NOT NULL ORDER BY sort, id`,
  );
  const permRows = await query<{ role_id: number; permission_code: string; perm_read: number; perm_write: number }>(
    `SELECT rm.role_id, m.permission_code, MAX(rm.perm_read) AS perm_read, MAX(rm.perm_write) AS perm_write
       FROM sys_role_menu rm JOIN sys_menu m ON m.id = rm.menu_id
      WHERE m.permission_code IS NOT NULL
      GROUP BY rm.role_id, m.permission_code`,
  );

  const numberMap = (rows: Array<{ role_id: number; c: number }>): Map<number, number> =>
    new Map(rows.map((r) => [r.role_id, Number(r.c)]));
  const userMap = numberMap(userCounts);
  const menuMap = numberMap(menuCounts);
  const apiMap = numberMap(apiCounts);

  const list = roles.map((role) => {
    const perms: Record<string, { read: boolean; write: boolean }> = {};
    for (const m of modules) perms[m.code] = { read: false, write: false };
    for (const row of permRows) {
      if (row.role_id !== role.id) continue;
      perms[row.permission_code] = { read: bit(row.perm_read), write: bit(row.perm_write) };
    }
    return {
      id: role.id,
      role_code: role.role_code,
      role_name: role.role_name,
      description: role.description,
      data_scope: role.data_scope,
      status: role.status,
      is_super_admin: role.role_code === SUPER_ADMIN_CODE,
      created_at: dt(role.created_at),
      userCount: userMap.get(role.id) ?? 0,
      menuCount: menuMap.get(role.id) ?? 0,
      apiCount: apiMap.get(role.id) ?? 0,
      perms,
    };
  });

  ok(res, { list, modules });
});

rbacRouter.get('/roles/:id/permissions', requirePerm('rbac'), async (req, res) => {
  const id = idParam(req.params.id);
  const role = await queryOne<{
    id: number;
    role_code: string;
    role_name: string;
    description: string | null;
    data_scope: string;
    status: number;
  }>('SELECT id, role_code, role_name, description, data_scope, status FROM sys_role WHERE id = ?', [id]);
  if (!role) throw new ApiError(404, '角色不存在');

  const roleMenus = await query<{ menu_id: number; perm_read: number; perm_write: number }>(
    'SELECT menu_id, perm_read, perm_write FROM sys_role_menu WHERE role_id = ?',
    [id],
  );
  const menuMap = new Map(roleMenus.map((m) => [m.menu_id, m]));
  const menuRows = await loadAllMenus();
  const menus = buildMenuTree(menuRows, (row) => {
    const grant = menuMap.get(row.id);
    return {
      checked: Boolean(grant),
      perm_read: grant ? bit(grant.perm_read) : false,
      perm_write: grant ? bit(grant.perm_write) : false,
    };
  });

  const apiRows = await query<{
    id: number;
    api_code: string;
    api_name: string;
    api_group: string;
    method: string;
    path: string;
  }>('SELECT id, api_code, api_name, api_group, method, path FROM sys_api_permission ORDER BY id');
  const grantedApis = await query<{ api_permission_id: number }>(
    'SELECT api_permission_id FROM sys_role_api WHERE role_id = ?',
    [id],
  );
  const apiSet = new Set(grantedApis.map((a) => a.api_permission_id));
  const apis = apiRows.map((a) => ({ ...a, checked: apiSet.has(a.id) }));

  ok(res, { role, menus, apis, menuCount: roleMenus.length, apiCount: apiSet.size });
});

const permBool = z.union([z.boolean(), z.number().int()]);
const permissionSaveSchema = z.object({
  menus: z
    .array(
      z.object({
        menu_id: z.number().int().positive(),
        perm_read: permBool.optional(),
        perm_write: permBool.optional(),
      }),
    )
    .default([]),
  apiIds: z.array(z.number().int().positive()).default([]),
});

rbacRouter.put('/roles/:id/permissions', requirePerm('rbac', 'write'), async (req, res) => {
  const id = idParam(req.params.id);
  const payload = permissionSaveSchema.parse(req.body);
  const me = currentUser(req);
  const role = await queryOne<{
    id: number;
    role_code: string;
    role_name: string;
    description: string | null;
    data_scope: string;
    status: number;
  }>('SELECT id, role_code, role_name, description, data_scope, status FROM sys_role WHERE id = ?', [id]);
  if (!role) throw new ApiError(404, '角色不存在');

  const allMenus = await loadAllMenus();
  const menuById = new Map(allMenus.map((m) => [m.id, m]));
  const allApis = await query<{ id: number }>('SELECT id FROM sys_api_permission');
  const apiIdSet = new Set(allApis.map((a) => a.id));

  const unknownMenu = payload.menus.find((m) => !menuById.has(m.menu_id));
  if (unknownMenu) throw new ApiError(400, `菜单不存在：${unknownMenu.menu_id}`);
  const unknownApi = payload.apiIds.find((apiId) => !apiIdSet.has(apiId));
  if (unknownApi) throw new ApiError(400, `接口权限不存在：${unknownApi}`);

  // 覆盖式授权：先按入参归一化，再补全祖先菜单（否则登录菜单树会断链）
  const grants = new Map<number, { menu_id: number; perm_read: boolean; perm_write: boolean }>();
  for (const item of payload.menus) {
    const write = bit(item.perm_write);
    const read = bit(item.perm_read) || write;
    if (!read) continue;
    grants.set(item.menu_id, { menu_id: item.menu_id, perm_read: true, perm_write: write });
  }
  for (const menuId of [...grants.keys()]) {
    const childGrant = grants.get(menuId);
    let current = menuById.get(menuId);
    let depth = 0;
    while (current && current.parent_id && depth < 10) {
      const parent = menuById.get(current.parent_id);
      if (!parent) break;
      const existed = grants.get(parent.id);
      grants.set(parent.id, {
        menu_id: parent.id,
        perm_read: true,
        perm_write: Boolean(existed?.perm_write) || Boolean(childGrant?.perm_write),
      });
      current = parent;
      depth += 1;
    }
  }

  // 保护性校验 1：超级管理员角色不允许被清空
  if (role.role_code === SUPER_ADMIN_CODE && (grants.size === 0 || payload.apiIds.length === 0)) {
    throw new ApiError(400, '不允许清空超级管理员角色的菜单与接口权限，请保留其全部权限');
  }
  // 保护性校验 2：不允许移除当前登录账号所属角色的 rbac 读写权限，避免自我锁权
  const myRoleIds = await query<{ role_id: number }>('SELECT role_id FROM sys_user_role WHERE user_id = ?', [me.id]);
  if (myRoleIds.some((r) => Number(r.role_id) === id) && !me.roleCodes.includes(SUPER_ADMIN_CODE)) {
    const rbacMenu = allMenus.find((m) => m.permission_code === 'rbac');
    const grant = rbacMenu ? grants.get(rbacMenu.id) : undefined;
    if (!grant || !grant.perm_read || !grant.perm_write) {
      throw new ApiError(400, '不允许移除当前登录账号所属角色的「权限安全管控」读写权限，避免自我锁权');
    }
  }

  const menuRows = [...grants.values()];
  const apiIds = [...new Set(payload.apiIds)];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM sys_role_menu WHERE role_id = ?', [id]);
    for (const grant of menuRows) {
      await conn.query('INSERT INTO sys_role_menu (role_id, menu_id, perm_read, perm_write) VALUES (?, ?, ?, ?)', [
        id,
        grant.menu_id,
        grant.perm_read ? 1 : 0,
        grant.perm_write ? 1 : 0,
      ]);
    }
    await conn.query('DELETE FROM sys_role_api WHERE role_id = ?', [id]);
    for (const apiId of apiIds) {
      await conn.query('INSERT INTO sys_role_api (role_id, api_permission_id) VALUES (?, ?)', [id, apiId]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // 立即生效：清空该角色下所有用户的权限缓存
  await invalidateRoleUsers(id);
  const affected = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM sys_user_role WHERE role_id = ?', [id]);

  req.auditAction = '配置角色权限';
  req.auditResource = '用户权限';
  req.auditDetail = `更新角色「${role.role_name}」授权：菜单 ${menuRows.length} 项、接口 ${apiIds.length} 项，已清理 ${Number(affected?.c ?? 0)} 个用户权限缓存`;
  ok(res, {
    role_id: id,
    role_code: role.role_code,
    role_name: role.role_name,
    menuCount: menuRows.length,
    apiCount: apiIds.length,
    affectedUsers: Number(affected?.c ?? 0),
    message: '角色权限已保存并立即生效',
  });
});

/* ------------------------------------------------------------------ */
/* 4. 菜单权限 / 接口权限                                                */
/* ------------------------------------------------------------------ */

rbacRouter.get('/menus', requirePerm('rbac'), async (_req, res) => {
  const menuRows = await loadAllMenus();
  const tree = buildMenuTree(menuRows);
  const roles = await query<{ id: number; role_code: string; role_name: string }>(
    'SELECT id, role_code, role_name FROM sys_role ORDER BY id',
  );
  const grants = await query<{ role_id: number; menu_id: number; perm_read: number; perm_write: number }>(
    'SELECT role_id, menu_id, perm_read, perm_write FROM sys_role_menu ORDER BY role_id, menu_id',
  );
  ok(res, {
    list: tree,
    flat: menuRows.map((m) => ({ ...m, label: menuLabel(m) })),
    roles,
    grants: roles.map((role) => ({
      role_id: role.id,
      role_code: role.role_code,
      role_name: role.role_name,
      menuIds: grants.filter((g) => g.role_id === role.id).map((g) => g.menu_id),
    })),
  });
});

rbacRouter.get('/apis', requirePerm('rbac'), async (_req, res) => {
  const list = await query<{
    id: number;
    api_code: string;
    api_name: string;
    api_group: string;
    method: string;
    path: string;
  }>('SELECT id, api_code, api_name, api_group, method, path FROM sys_api_permission ORDER BY id');
  const roles = await query<{ id: number; role_code: string; role_name: string }>(
    'SELECT id, role_code, role_name FROM sys_role ORDER BY id',
  );
  const grants = await query<{ role_id: number; api_permission_id: number }>(
    'SELECT role_id, api_permission_id FROM sys_role_api ORDER BY role_id, api_permission_id',
  );
  const moduleRows = await query<{ permission_code: string; menu_name: string }>(
    `SELECT permission_code, menu_name FROM sys_menu WHERE parent_id = 0 AND permission_code IS NOT NULL`,
  );
  const labels = new Map(moduleRows.map((m) => [m.permission_code, m.menu_name]));

  const groups: Array<{ code: string; name: string; count: number }> = [];
  for (const api of list) {
    const existed = groups.find((g) => g.code === api.api_group);
    if (existed) existed.count += 1;
    else groups.push({ code: api.api_group, name: labels.get(api.api_group) ?? api.api_group, count: 1 });
  }

  ok(res, {
    list,
    roles,
    groups,
    grants: roles.map((role) => ({
      role_id: role.id,
      role_code: role.role_code,
      role_name: role.role_name,
      apiIds: grants.filter((g) => g.role_id === role.id).map((g) => g.api_permission_id),
    })),
    total: list.length,
  });
});

/* ------------------------------------------------------------------ */
/* 5. 部门                                                              */
/* ------------------------------------------------------------------ */

rbacRouter.get('/depts', requirePerm('rbac'), async (_req, res) => {
  const list = await query<{
    id: number;
    dept_code: string;
    dept_name: string;
    parent_id: number | null;
    leader: string | null;
    description: string | null;
    sort: number;
    status: number;
    created_at: string | null;
    userCount: number;
    assetCount: number;
  }>(
    `SELECT d.id, d.dept_code, d.dept_name, d.parent_id, d.leader, d.description, d.sort, d.status, d.created_at,
            (SELECT COUNT(*) FROM sys_user u WHERE u.dept_id = d.id) AS userCount,
            (SELECT COUNT(*) FROM data_asset a WHERE a.dept_id = d.id) AS assetCount
       FROM sys_dept d ORDER BY d.sort, d.id`,
  );
  ok(res, {
    list: list.map((d) => ({
      ...d,
      userCount: Number(d.userCount),
      assetCount: Number(d.assetCount),
      created_at: dt(d.created_at),
    })),
    total: list.length,
  });
});

/* ------------------------------------------------------------------ */
/* 6. 安全策略                                                          */
/* ------------------------------------------------------------------ */

interface PolicyMeta {
  label: string;
  type: 'number' | 'text';
  unit?: string;
  min?: number;
  max?: number;
  description: string;
  placeholder?: string;
}

const POLICY_META: Record<string, PolicyMeta> = {
  'security.password.min_length': {
    label: '密码最小长度',
    type: 'number',
    unit: '位',
    min: 6,
    max: 32,
    description: '新建账号、重置密码、修改密码时的最小长度校验',
  },
  'security.password.expire_days': {
    label: '密码有效期',
    type: 'number',
    unit: '天',
    min: 1,
    max: 365,
    description: '超过有效期后强制用户修改登录密码',
  },
  'security.login.max_fail': {
    label: '登录失败锁定阈值',
    type: 'number',
    unit: '次',
    min: 3,
    max: 10,
    description: '连续登录失败达到该次数后锁定账号',
  },
  'security.login.lock_minutes': {
    label: '账号锁定时长',
    type: 'number',
    unit: '分钟',
    min: 1,
    max: 1440,
    description: '账号被锁定后的自动解锁等待时长',
  },
  'security.session.expire_hours': {
    label: '会话有效期',
    type: 'number',
    unit: '小时',
    min: 1,
    max: 168,
    description: '登录后 JWT 会话的最长有效时长',
  },
  'security.ip.whitelist': {
    label: 'IP 白名单',
    type: 'text',
    description: '允许访问管理后台的网段，多个用英文逗号分隔（支持 CIDR）',
    placeholder: '10.10.0.0/16,172.16.8.0/24',
  },
};

interface PolicyRow {
  config_key: string;
  config_value: string;
  description: string | null;
  updated_at: string | null;
}

function mapPolicy(row: PolicyRow): Record<string, unknown> {
  const meta = POLICY_META[row.config_key];
  return {
    key: row.config_key,
    label: meta?.label ?? row.config_key,
    value: row.config_value,
    type: meta?.type ?? 'text',
    unit: meta?.unit ?? null,
    min: meta?.min ?? null,
    max: meta?.max ?? null,
    placeholder: meta?.placeholder ?? null,
    description: meta?.description ?? row.description,
    updated_at: dt(row.updated_at),
    editable: Boolean(meta),
  };
}

async function loadSecurityPolicy(): Promise<PolicyRow[]> {
  return query<PolicyRow>(
    `SELECT config_key, config_value, description, updated_at FROM sys_config
      WHERE config_group = ? ORDER BY id`,
    [SECURITY_GROUP],
  );
}

rbacRouter.get('/policy', requirePerm('rbac'), async (_req, res) => {
  const rows = await loadSecurityPolicy();
  const minLength = Number(rows.find((r) => r.config_key === 'security.password.min_length')?.config_value ?? 10);
  ok(res, {
    items: rows.map(mapPolicy),
    groups: [{ code: SECURITY_GROUP, name: SECURITY_GROUP, count: rows.length }],
    passwordRule: `密码长度不少于 ${minLength} 位，且需同时包含大写字母、小写字母、数字与特殊字符`,
    updatedAt: rows
      .map((r) => dt(r.updated_at))
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null,
    note: '策略保存后立即对新建账号、密码重置与登录流程生效',
  });
});

const policySaveSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().trim().min(1, '配置项不能为空').max(64),
        value: z.string().trim().max(512),
      }),
    )
    .min(1, '至少提交一项策略'),
});

const POLICY_NUMERIC: Record<string, { min: number; max: number; label: string }> = {
  'security.password.min_length': { min: 6, max: 32, label: '密码最小长度' },
  'security.password.expire_days': { min: 1, max: 365, label: '密码有效期' },
  'security.login.max_fail': { min: 3, max: 10, label: '登录失败锁定阈值' },
  'security.login.lock_minutes': { min: 1, max: 1440, label: '账号锁定时长' },
  'security.session.expire_hours': { min: 1, max: 168, label: '会话有效期' },
};

/** 安全策略值校验与归一化 */
function normalizePolicyValue(key: string, raw: string): string {
  const numeric = POLICY_NUMERIC[key];
  if (numeric) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < numeric.min || n > numeric.max) {
      throw new ApiError(400, `${numeric.label}需为 ${numeric.min}–${numeric.max} 之间的整数`);
    }
    return String(n);
  }
  if (key === 'security.ip.whitelist') {
    const tokens = raw
      .split(/[,，;；\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!tokens.length) throw new ApiError(400, 'IP 白名单不能为空，多个网段请用英文逗号分隔');
    for (const token of tokens) {
      const [ip, mask] = token.split('/');
      const parts = ip.split('.');
      if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) {
        throw new ApiError(400, `IP 白名单格式不正确：${token}`);
      }
      if (mask !== undefined && !/^\d{1,2}$/.test(mask)) throw new ApiError(400, `IP 白名单掩码不合法：${token}`);
      if (mask !== undefined && Number(mask) > 32) throw new ApiError(400, `IP 白名单掩码不合法：${token}`);
    }
    return tokens.join(',');
  }
  throw new ApiError(400, `不支持的配置项：${key}`);
}

rbacRouter.put('/policy', requirePerm('rbac', 'write'), async (req, res) => {
  const payload = policySaveSchema.parse(req.body);
  const rows = await loadSecurityPolicy();
  const allowed = new Map(rows.map((r) => [r.config_key, r]));
  const normalized = payload.items.map((item) => {
    if (!allowed.has(item.key)) throw new ApiError(400, `未知的安全策略配置项：${item.key}`);
    return { key: item.key, value: normalizePolicyValue(item.key, item.value) };
  });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const item of normalized) {
      await conn.query('UPDATE sys_config SET config_value = ? WHERE config_key = ?', [item.value, item.key]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  req.auditAction = '保存安全策略';
  req.auditResource = '用户权限';
  req.auditDetail = `更新安全策略：${normalized.map((i) => `${POLICY_META[i.key]?.label ?? i.key}=${i.value}`).join('；')}`;

  const fresh = await loadSecurityPolicy();
  ok(res, {
    items: fresh.map(mapPolicy),
    updatedAt: fresh
      .map((r) => dt(r.updated_at))
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null,
    message: '安全策略已保存并生效',
  });
});
