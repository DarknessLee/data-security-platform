import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.ts';
import { query, queryOne } from '../db/pool.ts';
import { cached } from '../db/redis.ts';
import { ApiError } from '../lib/http.ts';
import type { AuthUser, ModulePerm } from '../types.ts';

interface TokenPayload {
  sub: number;
  username: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] });
}

function parseBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

async function loadAuthUser(userId: number): Promise<AuthUser | null> {
  return cached<AuthUser | null>(`auth:user:${userId}`, 60, async () => {
    const row = await queryOne<{
      id: number; username: string; real_name: string; dept_id: number | null; dept_name: string | null;
      job_title: string | null; status: number;
    }>(
      `SELECT u.id, u.username, u.real_name, u.dept_id, d.dept_name, u.job_title, u.status
         FROM sys_user u LEFT JOIN sys_dept d ON d.id = u.dept_id WHERE u.id = ?`,
      [userId],
    );
    if (!row || row.status !== 1) return null;

    const roles = await query<{ role_code: string; role_name: string; data_scope: string }>(
      `SELECT r.role_code, r.role_name, r.data_scope FROM sys_role r
         JOIN sys_user_role ur ON ur.role_id = r.id WHERE ur.user_id = ? AND r.status = 1`,
      [userId],
    );
    const menuPerms = await query<{ permission_code: string; perm_read: number; perm_write: number }>(
      `SELECT m.permission_code, rm.perm_read, rm.perm_write
         FROM sys_role_menu rm
         JOIN sys_menu m ON m.id = rm.menu_id
         JOIN sys_user_role ur ON ur.role_id = rm.role_id
        WHERE ur.user_id = ? AND m.permission_code IS NOT NULL`,
      [userId],
    );

    const perms: Record<string, ModulePerm> = {};
    for (const p of menuPerms) {
      const current = perms[p.permission_code] ?? { read: false, write: false };
      if (p.perm_read) current.read = true;
      if (p.perm_write) current.write = true;
      perms[p.permission_code] = current;
    }

    const scopeOrder = ['ALL', 'CUSTOM', 'DEPT', 'SELF'];
    const scopeValue = roles.map((r) => r.data_scope).sort((a, b) => scopeOrder.indexOf(a) - scopeOrder.indexOf(b))[0];
    const dataScope = (scopeValue ?? 'SELF') as AuthUser['dataScope'];

    return {
      id: row.id,
      username: row.username,
      realName: row.real_name,
      deptId: row.dept_id,
      deptName: row.dept_name,
      jobTitle: row.job_title,
      roleCodes: roles.map((r) => r.role_code),
      roleNames: roles.map((r) => r.role_name),
      dataScope,
      perms,
    };
  });
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = parseBearer(req);
    if (!token) throw new ApiError(401, '未登录或登录已过期，请重新登录');
    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, config.jwt.secret) as unknown as TokenPayload;
    } catch {
      throw new ApiError(401, '登录凭证无效或已过期，请重新登录');
    }
    const user = await loadAuthUser(Number(payload.sub));
    if (!user) throw new ApiError(401, '账号不存在或已被停用');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** 模块级权限校验：读接口要求 read，写接口要求 write */
export function requirePerm(moduleCode: string, level: 'read' | 'write' = 'read') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      next(new ApiError(401, '未登录'));
      return;
    }
    if (user.roleCodes.includes('SUPER_ADMIN')) {
      next();
      return;
    }
    const perm = user.perms[moduleCode];
    const allowed = level === 'write' ? Boolean(perm?.write) : Boolean(perm?.read || perm?.write);
    if (!allowed) {
      next(new ApiError(403, `当前角色无权${level === 'write' ? '操作' : '查看'}该模块（${moduleCode}）`));
      return;
    }
    next();
  };
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new ApiError(401, '未登录');
  return req.user;
}

/** 数据级权限：按 ALL/DEPT/SELF 追加过滤条件（返回 SQL 片段与参数） */
export function dataScopeFilter(user: AuthUser, alias: string, deptColumn = 'dept_id', selfColumn = 'username'): { sql: string; params: unknown[] } {
  if (user.roleCodes.includes('SUPER_ADMIN') || user.dataScope === 'ALL') return { sql: '', params: [] };
  if (user.dataScope === 'DEPT') return { sql: `AND ${alias}.${deptColumn} = ?`, params: [user.deptId] };
  return { sql: `AND ${alias}.${selfColumn} = ?`, params: [user.username] };
}
