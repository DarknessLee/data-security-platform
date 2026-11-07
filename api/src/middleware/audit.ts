import type { NextFunction, Request, Response } from 'express';
import { execute } from '../db/pool.ts';
import { fmtDateTime } from '../lib/time.ts';

const MODULE_BY_PREFIX: Array<[string, string]> = [
  ['/api/assets', '数据资产'],
  ['/api/compliance', '合规检查'],
  ['/api/risk', '风险事件'],
  ['/api/rbac', '用户权限'],
  ['/api/audit', '审计日志'],
  ['/api/ops', '运维保障'],
  ['/api/auth', '身份认证'],
];

function resolveResource(req: Request): string {
  const full = `${req.baseUrl}${req.path}`;
  for (const [prefix, name] of MODULE_BY_PREFIX) {
    if (full.startsWith(prefix)) return name;
  }
  return '平台';
}

/** 自动审计：认证用户的写操作在响应结束后落库（失败不影响业务） */
export function auditWriter(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    if (!req.user) return;
    if (req.method === 'GET' || req.method === 'OPTIONS') return;
    const action = req.auditAction ?? `${req.method} ${req.baseUrl}${req.path}`;
    const resource = req.auditResource ?? resolveResource(req);
    const result = res.statusCode < 400 ? '成功' : '失败';
    const detail = req.auditDetail ?? (result === '成功' ? '操作执行成功，已记录审计留痕' : '操作未通过校验或执行失败');
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
    execute(
      `INSERT INTO audit_log (log_type, user_id, username, action, resource, method, path, ip, user_agent, status_code, result, detail, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['操作日志', req.user.id, req.user.username, action, resource, req.method, `${req.baseUrl}${req.path}`.slice(0, 120),
        ip.slice(0, 45), String(req.headers['user-agent'] ?? '').slice(0, 250), res.statusCode, result, detail, fmtDateTime(new Date())],
    ).catch(() => {
      /* 审计落库失败不阻断业务 */
    });
  });
  next();
}
