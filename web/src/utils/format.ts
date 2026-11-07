/** 数值千分位 */
export function fmtNumber(n: number | string | null | undefined, digits = 0): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtWan(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (v >= 100000000) return `${(v / 100000000).toFixed(2)} 亿`;
  if (v >= 10000) return `${(v / 10000).toFixed(1)} 万`;
  return fmtNumber(v);
}

export function fmtSizeGb(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (v >= 1024) return `${(v / 1024).toFixed(2)} TB`;
  return `${v.toFixed(v >= 10 ? 1 : 2)} GB`;
}

export function fmtPercent(n: number | string | null | undefined, digits = 1): string {
  const v = Number(n ?? 0);
  return `${v.toFixed(digits)}%`;
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtDate(value: string | Date | null | undefined): string {
  const text = fmtDateTime(value);
  return text === '-' ? '-' : text.slice(0, 10);
}

export function fmtRelative(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(value);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return fmtDate(d);
}
