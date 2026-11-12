// 数据基线种子总入口：按依赖顺序重放，保证可重复、计数稳定
import { seedReference } from './reference.mjs';
import { seedAssets } from './assets.mjs';
import { seedCompliance } from './compliance.mjs';
import { seedRisk } from './risk.mjs';
import { seedAudit } from './audit.mjs';
import { seedOps } from './ops.mjs';

export async function seedAll(conn) {
  const ref = await seedReference(conn);
  const users = await loadUsers(conn, ref);
  const assetSeed = await seedAssets(conn, ref);
  await seedCompliance(conn, ref, assetSeed.assets, users);
  await seedRisk(conn, ref, assetSeed.assets);
  await seedAudit(conn, ref, users);
  await seedOps(conn, ref, users);
  return { ref };
}

async function loadUsers(conn, ref) {
  const [rows] = await conn.query(
    `SELECT u.id, u.username, u.real_name AS realName, u.dept_id AS deptId, r.role_code AS roleCode, r.data_scope AS dataScope, r.role_name AS roleName
       FROM sys_user u
       JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id
      ORDER BY u.id`,
  );
  return rows;
}
