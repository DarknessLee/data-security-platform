import type { Response } from 'express';

/** 统一响应包：成功 code=0，失败 code=HTTP 状态码 */
export interface ApiMeta {
  total?: number;
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function ok<T>(res: Response, data: T, meta?: ApiMeta, status = 200): void {
  res.status(status).json({ code: 0, message: 'ok', data, ...(meta ? { meta } : {}) });
}

export function created<T>(res: Response, data: T): void {
  ok(res, data, undefined, 201);
}
