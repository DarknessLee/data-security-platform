import mysql from '../node_modules/mysql2/promise.js';
const c = await mysql.createConnection({host:'127.0.0.1',port:13306,user:'datasec',password:'DataSec_2026',database:'datasec',charset:'utf8mb4'});
const [r] = await c.query("SELECT COUNT(1) AS overdue FROM service_ticket WHERE status <> '已关闭' AND DATE_ADD(created_at, INTERVAL sla_hours HOUR) < NOW()");
const [r2] = await c.query("SELECT COUNT(1) AS urgent FROM risk_event WHERE level='紧急' AND status IN ('待处置','处置中')");
const [r3] = await c.query('SELECT COUNT(1) AS failbk FROM backup_record WHERE status=?',['失败']);
const [r4] = await c.query("SELECT DATE_FORMAT(MAX(metric_time),'%Y-%m-%d %H:%i:%s') AS latest FROM ops_metric");
console.log(JSON.stringify({overdue:r[0].overdue, urgent:r2[0].urgent, failbk:r3[0].failbk, latest:r4[0].latest}));
await c.end();
