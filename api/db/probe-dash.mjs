import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: '127.0.0.1', port: 13306, user: 'datasec', password: 'DataSec_2026', database: 'datasec',
  dateStrings: ['DATE'],
});

const deptId = 3;
const plain = 'AND dept_id = ?';
const aliased = 'AND e.dept_id = ?';
const queries = [
  ['openRisk', `SELECT COUNT(*) AS c FROM risk_event WHERE status IN ('待处置','处置中') ${plain}`, [deptId]],
  ['riskLevel', `SELECT level, COUNT(*) AS c FROM risk_event WHERE 1 = 1 ${plain} GROUP BY level`, [deptId]],
  ['trend', `SELECT DATE_FORMAT(occurred_at, '%Y-%m-%d') AS d, COUNT(*) AS total FROM risk_event WHERE occurred_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) ${plain} GROUP BY DATE_FORMAT(occurred_at, '%Y-%m-%d') ORDER BY d`, [deptId]],
  ['recent', `SELECT e.id, e.event_no, e.level, e.occurred_at, a.asset_name FROM risk_event e LEFT JOIN data_asset a ON a.id = e.asset_id WHERE 1 = 1 ${aliased} ORDER BY FIELD(e.level, '紧急','高','中','低'), e.occurred_at DESC LIMIT 6`, [deptId]],
];
for (const [name, sql, params] of queries) {
  try {
    const [rows] = await conn.query(sql, params);
    console.log(name, 'OK rows=', rows.length);
  } catch (error) {
    console.log(name, 'ERR', error.message);
  }
}
await conn.end();
