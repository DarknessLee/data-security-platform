// 演示态校验：结构完整性 / 种子计数 / 关联一致性 / 演示规范
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 13306),
  user: process.env.DB_USER || 'datasec',
  password: process.env.DB_PASSWORD || 'DataSec_2026',
  database: process.env.DB_NAME || 'datasec',
  charset: 'utf8mb4',
};

let passed = 0;
let failed = 0;
const startedAt = Date.now();

function check(name, ok, actual) {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} ${actual}`);
  }
}

async function count(conn, sql, params = []) {
  const [[row]] = await conn.query(sql, params);
  return Number(row.c ?? Object.values(row)[0]);
}

async function main() {
  const conn = await mysql.createConnection(cfg);
  try {
    const tables = ['sys_dept', 'sys_user', 'sys_role', 'sys_user_role', 'sys_menu', 'sys_role_menu', 'sys_api_permission', 'sys_role_api',
      'sys_config', 'notification', 'asset_category', 'data_asset', 'asset_tag', 'asset_lifecycle', 'compliance_rule', 'compliance_check',
      'compliance_rectify', 'masking_rule', 'share_approval', 'risk_rule', 'risk_event', 'audit_log', 'audit_report', 'service_ticket',
      'ticket_trace', 'backup_record', 'ops_metric'];
    for (const t of tables) {
      const c = await count(conn, `SELECT COUNT(*) AS c FROM ${t}`);
      check(`表 ${t} 已就绪（${c} 行）`, c >= 0, c);
    }

    check('部门数量为 6', (await count(conn, 'SELECT COUNT(*) AS c FROM sys_dept')) === 6);
    check('用户数量为 9', (await count(conn, 'SELECT COUNT(*) AS c FROM sys_user')) === 9);
    check('角色数量为 8', (await count(conn, 'SELECT COUNT(*) AS c FROM sys_role')) === 8);
    check('菜单数量为 30', (await count(conn, 'SELECT COUNT(*) AS c FROM sys_menu')) === 30);
    check('接口权限点不少于 40', (await count(conn, 'SELECT COUNT(*) AS c FROM sys_api_permission')) >= 40);
    check('角色菜单授权不少于 40 条', (await count(conn, 'SELECT COUNT(*) AS c FROM sys_role_menu')) >= 40);
    check('数据资产数量为 64', (await count(conn, 'SELECT COUNT(*) AS c FROM data_asset')) === 64);
    check('资产分类数量为 8', (await count(conn, 'SELECT COUNT(*) AS c FROM asset_category')) === 8);

    const [levels] = await conn.query('SELECT data_level, COUNT(*) AS c FROM data_asset GROUP BY data_level');
    const levelMap = Object.fromEntries(levels.map((r) => [r.data_level, Number(r.c)]));
    check('四级分类分级齐全（公开/内部/机密/绝密）', ['公开', '内部', '机密', '绝密'].every((l) => levelMap[l] > 0), JSON.stringify(levelMap));

    const [stages] = await conn.query('SELECT lifecycle_stage, COUNT(*) AS c FROM data_asset GROUP BY lifecycle_stage');
    check('资产生命周期阶段不少于 3 类', stages.length >= 3, stages.map((s) => s.lifecycle_stage).join(','));

    check('资产标签数量不少于 128', (await count(conn, 'SELECT COUNT(*) AS c FROM asset_tag')) >= 128);
    check('生命周期记录不少于 250', (await count(conn, 'SELECT COUNT(*) AS c FROM asset_lifecycle')) >= 250);
    check('合规规则数量为 20', (await count(conn, 'SELECT COUNT(*) AS c FROM compliance_rule')) === 20);
    check('合规检查结果为 100 条', (await count(conn, 'SELECT COUNT(*) AS c FROM compliance_check')) === 100);
    check('整改单数量为 22', (await count(conn, 'SELECT COUNT(*) AS c FROM compliance_rectify')) === 22);
    check('脱敏规则数量为 10', (await count(conn, 'SELECT COUNT(*) AS c FROM masking_rule')) === 10);
    check('共享审批数量为 18', (await count(conn, 'SELECT COUNT(*) AS c FROM share_approval')) === 18);
    check('风险监测规则数量为 10', (await count(conn, 'SELECT COUNT(*) AS c FROM risk_rule')) === 10);
    check('风险事件数量为 48', (await count(conn, 'SELECT COUNT(*) AS c FROM risk_event')) === 48);
    check('审计日志不少于 280 条', (await count(conn, 'SELECT COUNT(*) AS c FROM audit_log')) >= 280);
    check('审计报表数量为 5', (await count(conn, 'SELECT COUNT(*) AS c FROM audit_report')) === 5);
    check('运维工单数量为 22', (await count(conn, 'SELECT COUNT(*) AS c FROM service_ticket')) === 22);
    check('工单轨迹不少于 70 条', (await count(conn, 'SELECT COUNT(*) AS c FROM ticket_trace')) >= 70);
    check('备份记录数量为 14', (await count(conn, 'SELECT COUNT(*) AS c FROM backup_record')) === 14);
    check('监控指标数量不少于 150', (await count(conn, 'SELECT COUNT(*) AS c FROM ops_metric')) >= 150);

    // 关联一致性
    check('资产分类关联完整', (await count(conn, 'SELECT COUNT(*) AS c FROM data_asset a LEFT JOIN asset_category c ON c.id = a.category_id WHERE c.id IS NULL')) === 0);
    check('资产责任部门关联完整', (await count(conn, 'SELECT COUNT(*) AS c FROM data_asset a LEFT JOIN sys_dept d ON d.id = a.dept_id WHERE d.id IS NULL')) === 0);
    check('检查结果关联规则完整', (await count(conn, 'SELECT COUNT(*) AS c FROM compliance_check c LEFT JOIN compliance_rule r ON r.id = c.rule_id WHERE r.id IS NULL')) === 0);
    check('整改单关联检查完整', (await count(conn, 'SELECT COUNT(*) AS c FROM compliance_rectify c LEFT JOIN compliance_check k ON k.id = c.check_id WHERE k.id IS NULL')) === 0);
    check('共享审批关联资产完整', (await count(conn, 'SELECT COUNT(*) AS c FROM share_approval s LEFT JOIN data_asset a ON a.id = s.asset_id WHERE a.id IS NULL')) === 0);
    check('风险事件关联规则完整', (await count(conn, 'SELECT COUNT(*) AS c FROM risk_event e LEFT JOIN risk_rule r ON r.id = e.rule_id WHERE r.id IS NULL')) === 0);
    check('风险事件关联资产完整', (await count(conn, 'SELECT COUNT(*) AS c FROM risk_event e LEFT JOIN data_asset a ON a.id = e.asset_id WHERE a.id IS NULL')) === 0);
    check('工单轨迹关联工单完整', (await count(conn, 'SELECT COUNT(*) AS c FROM ticket_trace t LEFT JOIN service_ticket s ON s.id = t.ticket_id WHERE s.id IS NULL')) === 0);

    // 演示规范
    check('用户密码均为哈希存储', (await count(conn, "SELECT COUNT(*) AS c FROM sys_user WHERE password_hash NOT LIKE '$2%'")) === 0);
    check('风险等级覆盖低/中/高/紧急', (await count(conn, 'SELECT COUNT(DISTINCT level) AS c FROM risk_event')) === 4);
    check('工单状态覆盖不少于 4 种', (await count(conn, 'SELECT COUNT(DISTINCT status) AS c FROM service_ticket')) >= 4);
    check('审计日志覆盖 7 个自然日', (await count(conn, 'SELECT COUNT(DISTINCT DATE(created_at)) AS c FROM audit_log')) >= 7);
    check('日志无未来时间', (await count(conn, "SELECT COUNT(*) AS c FROM audit_log WHERE created_at > NOW()")) === 0);
    check('资产名称无演示占位词', (await count(conn, "SELECT COUNT(*) AS c FROM data_asset WHERE asset_name LIKE '%test%' OR asset_name LIKE '%演示%' OR asset_name LIKE '%示例%'")) === 0);
    check('每个角色至少 1 条菜单授权', (await count(conn, 'SELECT COUNT(*) AS c FROM sys_role r LEFT JOIN sys_role_menu rm ON rm.role_id = r.id WHERE rm.role_id IS NULL')) === 0);
    check('已授权模块均包含二级菜单（侧边栏可进入子页面）', (await count(conn, `SELECT COUNT(*) AS c FROM sys_role_menu rm
      JOIN sys_menu m ON m.id = rm.menu_id AND m.menu_type = '目录'
      WHERE EXISTS (SELECT 1 FROM sys_menu c WHERE c.parent_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM sys_role_menu rc JOIN sys_menu c2 ON c2.id = rc.menu_id WHERE rc.role_id = rm.role_id AND c2.parent_id = m.id)`)) === 0);
    check('每个角色至少 1 条接口授权', (await count(conn, 'SELECT COUNT(*) AS c FROM sys_role r LEFT JOIN sys_role_api ra ON ra.role_id = r.id WHERE ra.role_id IS NULL')) === 0);
  } finally {
    await conn.end();
  }

  const secs = ((Date.now() - startedAt) / 1000).toFixed(2);
  const result = failed === 0 ? 'PASS' : 'FAIL';
  console.log(`\nRESULT=${result} passed=${passed} failed=${failed} 用时=${secs}s`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[db:validate] 执行异常:', err.message);
  console.log('RESULT=FAIL passed=0 failed=1');
  process.exit(1);
});
