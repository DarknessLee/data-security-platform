import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config/env.ts';
import { execute, query, queryOne } from '../../db/pool.ts';
import { invalidate, isRedisReady, redis } from '../../db/redis.ts';
import { ApiError, ok } from '../../lib/http.ts';
import { fmtDateTime, now } from '../../lib/time.ts';
import { authenticate, currentUser, signToken } from '../../middleware/auth.ts';
import type { AuthUser } from '../../types.ts';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '请输入原密码'),
  newPassword: z.string().min(1, '请输入新密码'),
});

async function getConfig(key: string, fallback: string): Promise<string> {
  const row = await queryOne<{ config_value: string }>('SELECT config_value FROM sys_config WHERE config_key = ?', [key]);
  return row?.config_value ?? fallback;
}

async function buildMenuTree(userId: number): Promise<unknown[]> {
  const rows = await query<{
    id: number; parent_id: number; menu_name: string; path: string | null; icon: string | null;
    permission_code: string | null; menu_type: string; sort: number;
  }>(
    `SELECT DISTINCT m.id, m.parent_id, m.menu_name, m.path, m.icon, m.permission_code, m.menu_type, m.sort
       FROM sys_menu m
       JOIN sys_role_menu rm ON rm.menu_id = m.id
       JOIN sys_user_role ur ON ur.role_id = rm.role_id
      WHERE ur.user_id = ? AND m.visible = 1
      ORDER BY m.sort, m.id`,
    [userId],
  );
  const byId = new Map<number, Record<string, unknown>>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id, name: r.menu_name, path: r.path, icon: r.icon,
      permission: r.permission_code, type: r.menu_type, sort: r.sort, children: [] as unknown[],
    });
  }
  const roots: unknown[] = [];
  for (const r of rows) {
    const node = byId.get(r.id)!;
    if (r.parent_id && byId.has(r.parent_id)) (byId.get(r.parent_id)!.children as unknown[]).push(node);
    else roots.push(node);
  }
  return roots;
}

function profileOf(user: AuthUser): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    realName: user.realName,
    deptId: user.deptId,
    deptName: user.deptName,
    jobTitle: user.jobTitle,
    roleCodes: user.roleCodes,
    roleNames: user.roleNames,
    dataScope: user.dataScope,
    permissions: user.perms,
    platformName: config.platformName,
    version: config.version,
  };
}

/** 登录：账号密码 + 失败锁定 + 登录日志 */
authRouter.post('/login', async (req, res) => {
  const { username, password } = loginSchema.parse(req.body);
  const lockKey = `login:lock:${username}`;
  if (isRedisReady()) {
    const locked = await redis.get(lockKey).catch(() => null);
    if (locked) {
      const ttl = await redis.ttl(lockKey).catch(() => 0);
      throw new ApiError(429, `连续登录失败次数过多，账号已锁定，请 ${Math.max(1, Math.ceil(ttl / 60))} 分钟后再试`);
    }
  }

  const user = await queryOne<{ id: number; username: string; password_hash: string; real_name: string; status: number; dept_id: number | null }>(
    'SELECT id, username, password_hash, real_name, status, dept_id FROM sys_user WHERE username = ?',
    [username],
  );

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 250);

  const failLogin = async (reason: string, status: number): Promise<never> => {
    const maxFail = Number(await getConfig('security.login.max_fail', '5'));
    const lockMinutes = Number(await getConfig('security.login.lock_minutes', '30'));
    if (isRedisReady()) {
      const key = `login:fail:${username}`;
      const count = await redis.incr(key).catch(() => 0);
      if (count === 1) await redis.expire(key, lockMinutes * 60).catch(() => 0);
      if (count >= maxFail) await redis.set(lockKey, '1', 'EX', lockMinutes * 60).catch(() => 0);
    }
    await execute(
      `INSERT INTO audit_log (log_type, user_id, username, action, resource, method, path, ip, user_agent, status_code, result, detail, created_at)
       VALUES ('登录日志', ?, ?, '账号登录', '身份认证', 'POST', '/api/auth/login', ?, ?, ?, '失败', ?, ?)`,
      [user?.id ?? null, username, ip.slice(0, 45), ua, status, reason, fmtDateTime(new Date())],
    );
    throw new ApiError(status, reason);
  };

  if (!user) return failLogin('用户名或密码错误', 401);
  if (user.status !== 1) return failLogin('账号已被停用，请联系管理员', 403);
  const matched = await bcrypt.compare(password, user.password_hash);
  if (!matched) return failLogin('用户名或密码错误', 401);

  if (isRedisReady()) await redis.del(`login:fail:${username}`).catch(() => 0);

  const token = signToken({ sub: user.id, username: user.username });
  await execute(
    `INSERT INTO audit_log (log_type, user_id, username, action, resource, method, path, ip, user_agent, status_code, result, detail, created_at)
     VALUES ('登录日志', ?, ?, '账号登录', '身份认证', 'POST', '/api/auth/login', ?, ?, 200, '成功', '登录成功，已建立安全会话', ?)`,
    [user.id, user.username, ip.slice(0, 45), ua, fmtDateTime(new Date())],
  );

  const auth = await buildAuthUser(user.id);
  const menus = await buildMenuTree(user.id);
  const unread = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM notification WHERE (user_id = ? OR user_id IS NULL) AND read_flag = 0',
    [user.id],
  );
  ok(res, { token, expiresIn: config.jwt.expiresIn, user: profileOf(auth), menus, unreadCount: Number(unread?.c ?? 0) });
});

async function buildAuthUser(userId: number): Promise<AuthUser> {
  const row = await queryOne<{
    id: number; username: string; real_name: string; dept_id: number | null; dept_name: string | null; job_title: string | null;
  }>(
    `SELECT u.id, u.username, u.real_name, u.dept_id, d.dept_name, u.job_title
       FROM sys_user u LEFT JOIN sys_dept d ON d.id = u.dept_id WHERE u.id = ?`,
    [userId],
  );
  if (!row) throw new ApiError(401, '账号不存在');
  const roles = await query<{ role_code: string; role_name: string; data_scope: string }>(
    `SELECT r.role_code, r.role_name, r.data_scope FROM sys_role r JOIN sys_user_role ur ON ur.role_id = r.id WHERE ur.user_id = ?`,
    [userId],
  );
  const menuPerms = await query<{ permission_code: string; perm_read: number; perm_write: number }>(
    `SELECT m.permission_code, rm.perm_read, rm.perm_write FROM sys_role_menu rm
       JOIN sys_menu m ON m.id = rm.menu_id JOIN sys_user_role ur ON ur.role_id = rm.role_id
      WHERE ur.user_id = ? AND m.permission_code IS NOT NULL`,
    [userId],
  );
  const perms: Record<string, { read: boolean; write: boolean }> = {};
  for (const p of menuPerms) {
    const cur = perms[p.permission_code] ?? { read: false, write: false };
    cur.read = cur.read || Boolean(p.perm_read);
    cur.write = cur.write || Boolean(p.perm_write);
    perms[p.permission_code] = cur;
  }
  const scopeOrder = ['ALL', 'CUSTOM', 'DEPT', 'SELF'];
  const scope = roles.map((r) => r.data_scope).sort((a, b) => scopeOrder.indexOf(a) - scopeOrder.indexOf(b))[0];
  return {
    id: row.id,
    username: row.username,
    realName: row.real_name,
    deptId: row.dept_id,
    deptName: row.dept_name,
    jobTitle: row.job_title,
    roleCodes: roles.map((r) => r.role_code),
    roleNames: roles.map((r) => r.role_name),
    dataScope: (scope ?? 'SELF') as AuthUser['dataScope'],
    perms,
  };
}

/** 当前登录用户信息 + 菜单树 + 权限 */
authRouter.get('/profile', authenticate, async (req, res) => {
  const user = currentUser(req);
  const menus = await buildMenuTree(user.id);
  const unread = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM notification WHERE (user_id = ? OR user_id IS NULL) AND read_flag = 0',
    [user.id],
  );
  ok(res, { user: profileOf(user), menus, unreadCount: Number(unread?.c ?? 0), serverTime: now() });
});

/** 注销：清理会话缓存 */
authRouter.post('/logout', authenticate, async (req, res) => {
  const user = currentUser(req);
  await invalidate(`auth:user:${user.id}`);
  req.auditAction = '退出登录';
  req.auditResource = '身份认证';
  ok(res, { message: '已安全退出登录' });
});

/** 修改本人密码，需符合平台密码策略 */
authRouter.put('/password', authenticate, async (req, res) => {
  const user = currentUser(req);
  const { oldPassword, newPassword } = changePasswordSchema.parse(req.body);
  const minLength = Number(await getConfig('security.password.min_length', '10'));

  const row = await queryOne<{ password_hash: string }>('SELECT password_hash FROM sys_user WHERE id = ?', [user.id]);
  if (!row) throw new ApiError(404, '账号不存在');
  if (!(await bcrypt.compare(oldPassword, row.password_hash))) throw new ApiError(400, '原密码不正确');

  if (newPassword.length < minLength) throw new ApiError(400, `新密码长度不得少于 ${minLength} 位`);
  const strong = /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword) && /[^A-Za-z0-9]/.test(newPassword);
  if (!strong) throw new ApiError(400, '新密码需同时包含大写字母、小写字母、数字与特殊字符');
  if (newPassword === oldPassword) throw new ApiError(400, '新密码不能与原密码相同');

  await execute('UPDATE sys_user SET password_hash = ?, updated_at = NOW() WHERE id = ?', [await bcrypt.hash(newPassword, 10), user.id]);
  await invalidate(`auth:user:${user.id}`);
  req.auditAction = '修改登录密码';
  req.auditResource = '身份认证';
  req.auditDetail = '用户自助修改登录密码，符合密码强度策略';
  ok(res, { message: '密码修改成功，请重新登录' });
});

/** 站内通知：当前用户 + 全员公告 */
authRouter.get('/notifications', authenticate, async (req, res) => {
  const user = currentUser(req);
  const rows = await query(
    `SELECT id, title, content, level, read_flag, biz_type, biz_id, created_at
       FROM notification WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC LIMIT 20`,
    [user.id],
  );
  ok(res, { list: rows, unread: rows.filter((r) => Number((r as { read_flag: number }).read_flag) === 0).length });
});

authRouter.put('/notifications/:id/read', authenticate, async (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  await execute('UPDATE notification SET read_flag = 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)', [id, user.id]);
  ok(res, { message: '已标记为已读' });
});
