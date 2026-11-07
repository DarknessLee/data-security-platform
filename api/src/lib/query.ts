export interface PageParams {
  page: number;
  pageSize: number;
  offset: number;
}

export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
}

export function parsePagination(query: Record<string, unknown>, defaultSize = 10, maxSize = 100): PageParams {
  const rawPage = Number(query.page ?? 1);
  const rawSize = Number(query.pageSize ?? defaultSize);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize > 0 ? Math.min(Math.floor(rawSize), maxSize) : defaultSize;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageMeta(total: number, p: PageParams): PageMeta {
  return { total, page: p.page, pageSize: p.pageSize };
}

/** 安全解析查询串中的数字（缺省返回 undefined） */
export function numOrUndef(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function strOrUndef(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

/** 拼装 WHERE 子句的小工具，避免各模块重复拼接注入风险 */
export class WhereBuilder {
  private clauses: string[] = [];
  private values: unknown[] = [];

  add(sql: string, value?: unknown): this {
    if (value === undefined) return this;
    this.clauses.push(sql);
    if (value !== undefined) this.values.push(value);
    return this;
  }

  addRaw(sql: string): this {
    this.clauses.push(sql);
    return this;
  }

  /** like 查询：field LIKE ? */
  like(field: string, value?: string): this {
    if (!value) return this;
    this.clauses.push(`${field} LIKE ?`);
    this.values.push(`%${value}%`);
    return this;
  }

  eq(field: string, value?: string | number): this {
    if (value === undefined || value === null || value === '') return this;
    this.clauses.push(`${field} = ?`);
    this.values.push(value);
    return this;
  }

  gte(field: string, value?: string): this {
    if (!value) return this;
    this.clauses.push(`${field} >= ?`);
    this.values.push(value);
    return this;
  }

  lte(field: string, value?: string): this {
    if (!value) return this;
    this.clauses.push(`${field} <= ?`);
    this.values.push(value);
    return this;
  }

  get where(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }

  get params(): unknown[] {
    return this.values;
  }
}
