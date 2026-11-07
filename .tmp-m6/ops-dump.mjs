import mysql from '../node_modules/mysql2/promise.js';

const c = await mysql.createConnection({ host: '127.0.0.1', port: 13306, user: 'datasec', password: 'DataSec_2026', database: 'datasec', charset: 'utf8mb4' });
const q = async (s) => { const [r] = await c.query(s); return r; };
console.log('CONFIGS', JSON.stringify(await q('SELECT * FROM sys_config ORDER BY id'), null, 1));
console.log('TICKETS', JSON.stringify(await q('SELECT id,ticket_no,title,category,priority,status,reporter,assignee,sla_hours,created_at,accepted_at,closed_at FROM service_ticket ORDER BY id LIMIT 5'), null, 1));
console.log('TRACES', JSON.stringify(await q('SELECT * FROM ticket_trace ORDER BY id LIMIT 6'), null, 1));
console.log('BACKUPS', JSON.stringify(await q('SELECT * FROM backup_record ORDER BY id'), null, 1));
console.log('RISK', JSON.stringify(await q('SELECT level,status,COUNT(1) c FROM risk_event GROUP BY level,status')));
console.log('NOTI', JSON.stringify(await q('SELECT * FROM notification ORDER BY id DESC LIMIT 3'), null, 1));
console.log('METRIC', JSON.stringify(await q('SELECT * FROM ops_metric ORDER BY metric_time DESC LIMIT 2'), null, 1));
await c.end();
