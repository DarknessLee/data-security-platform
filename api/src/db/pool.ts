import mysql from 'mysql2/promise';
import { config } from '../config/env.ts';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 12,
  queueLimit: 0,
  timezone: 'local',
  dateStrings: ['DATE'],
});

/** 查询多行 */
export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

/** 查询单行 */
export async function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** 执行写入，返回 insertId / affectedRows */
export async function execute(sql: string, params: unknown[] = []): Promise<{ insertId: number; affectedRows: number }> {
  const [result] = await pool.execute(sql, params as never);
  const r = result as mysql.ResultSetHeader;
  return { insertId: r.insertId, affectedRows: r.affectedRows };
}

export async function ping(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
