// 演示态初始化：建库建表 → 重放种子 → 打印计数
// 用法：node db/init.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { seedAll } from './seed/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 13306),
  user: process.env.DB_USER || 'datasec',
  password: process.env.DB_PASSWORD || 'DataSec_2026',
  database: process.env.DB_NAME || 'datasec',
  multipleStatements: true,
  charset: 'utf8mb4',
};

const startedAt = Date.now();

async function main() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const conn = await mysql.createConnection(cfg);
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const clean = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = clean
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await conn.query(stmt);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`[db] 结构已重建，共执行 ${statements.length} 条语句`);

    await seedAll(conn);

    const tables = ['sys_user', 'sys_role', 'sys_menu', 'sys_api_permission', 'asset_category', 'data_asset', 'asset_tag', 'asset_lifecycle',
      'compliance_rule', 'compliance_check', 'compliance_rectify', 'masking_rule', 'share_approval', 'risk_rule', 'risk_event',
      'audit_log', 'audit_report', 'service_ticket', 'ticket_trace', 'backup_record', 'ops_metric', 'notification', 'sys_config'];
    console.log('[db] 演示态重建完成：');
    for (const t of tables) {
      const [[row]] = await conn.query(`SELECT COUNT(*) AS c FROM ${t}`);
      console.log(`  - ${t}: ${row.c}`);
    }
    const secs = ((Date.now() - startedAt) / 1000).toFixed(2);
    console.log(`RESULT=PASS 用时=${secs}s`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[db] 初始化失败:', err.message);
  if (err.sql) console.error('[db] SQL:', err.sql.slice(0, 500));
  console.log('RESULT=FAIL');
  process.exit(1);
});
