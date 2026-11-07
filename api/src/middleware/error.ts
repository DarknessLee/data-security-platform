import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../lib/http.ts';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ code: 404, message: '接口不存在' });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const message = first ? `${first.path.join('.') || '参数'}：${first.message}` : '参数校验失败';
    res.status(400).json({ code: 400, message });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json({ code: err.status, message: err.message });
    return;
  }
  const e = err as { message?: string; sql?: string };
  console.error(`[api] 未处理异常 ${req.method} ${req.originalUrl}:`, e?.message);
  res.status(500).json({ code: 500, message: '服务内部异常，请稍后重试或联系运维' });
}
