const BASE = 'http://127.0.0.1:8082';
let pass = 0, fail = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; fails.push(name + (extra ? ` :: ${extra}` : '')); console.log(`  FAIL ${name} ${extra}`); }
}

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// login with retry (possible rate-limit from dev hot reload)
let token = null, auditor = null;
for (let i = 0; i < 3 && !token; i++) {
  const r = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'Admin@2026' } });
  token = r.json?.data?.token;
  if (!token) { console.log('login retry', r.status, JSON.stringify(r.json)); await sleep(1500); }
}
check('admin login', !!token);
const ar = await call('POST', '/api/auth/login', { body: { username: 'auditor', password: 'Audit@2026' } });
auditor = ar.json?.data?.token;
check('auditor login', !!auditor, `${ar.status} ${JSON.stringify(ar.json).slice(0, 120)}`);

// ---------- overview ----------
const ov = await call('GET', '/api/ops/overview', { token });
check('GET /overview 200', ov.status === 200);
const d = ov.json?.data || {};
check('overview.latest has cpu_usage', typeof d.latest?.cpu_usage === 'number');
check('overview.series 24 points', Array.isArray(d.series) && d.series.length === 24, String(d.series?.length));
check('overview.availability 7 days', Array.isArray(d.availability?.daily) && d.availability.daily.length === 7);
check('overview.alerts counts', typeof d.alerts?.total === 'number');
check('overview.tickets stats', d.tickets?.total >= 22, String(d.tickets?.total));
check('overview.backups stats', d.backups?.total >= 14, String(d.backups?.total));
check('overview.version', d.version === 'V1.0.0', d.version);

// ---------- metrics ----------
const m = await call('GET', '/api/ops/metrics?hours=12', { token });
check('GET /metrics?hours=12 200', m.status === 200);
check('metrics 12 points', Array.isArray(m.json?.data) && m.json.data.length === 12, String(m.json?.data?.length));
const mClamp = await call('GET', '/api/ops/metrics?hours=9999', { token });
const m168 = await call('GET', '/api/ops/metrics?hours=168', { token });
check('metrics clamped hours ==168', mClamp.json?.data?.length === m168.json?.data?.length && mClamp.json?.data?.length <= 168, `${mClamp.json?.data?.length}/${m168.json?.data?.length}`);
check('metrics hours=1', (await call('GET', '/api/ops/metrics?hours=1', { token })).json?.data?.length === 1);
check('metrics default 24', (await call('GET', '/api/ops/metrics', { token })).json?.data?.length === 24);

// ---------- alerts ----------
const al = await call('GET', '/api/ops/alerts', { token });
check('GET /alerts 200', al.status === 200);
check('alerts array non-empty', Array.isArray(al.json?.data) && al.json.data.length > 0, String(al.json?.data?.length));
const bkAlert = (al.json?.data || []).find((a) => a.source === 'backup');
check('alert contains failed backup', !!bkAlert);
check('alert contains overdue ticket', (al.json?.data || []).some((a) => a.source === 'ticket'));
check('alert fields contract', !!al.json?.data?.[0] && 'level' in al.json.data[0] && 'metric' in al.json.data[0] && 'threshold' in al.json.data[0] && 'occurredAt' in al.json.data[0]);

// ---------- tickets ----------
const t1 = await call('GET', '/api/ops/tickets?page=1&pageSize=5', { token });
check('GET /tickets 200 paginated', t1.status === 200 && t1.json?.data?.length === 5 && t1.json?.meta?.total >= 22);
const tPending = await call('GET', '/api/ops/tickets?status=' + encodeURIComponent('待受理'), { token });
check('tickets filter status', tPending.json?.data?.every((t) => t.status === '待受理'), JSON.stringify(tPending.json?.meta));
const tHigh = await call('GET', '/api/ops/tickets?priority=' + encodeURIComponent('高'), { token });
check('tickets filter priority', tHigh.json?.data?.every((t) => t.priority === '高'));
const tKw = await call('GET', '/api/ops/tickets?keyword=TK-', { token });
check('tickets keyword filter', tKw.json?.data?.length > 0 && tKw.json.data.every((t) => (t.ticket_no || '').includes('TK-')));
const tid = t1.json.data[0].id;
const tDetail = await call('GET', `/api/ops/tickets/${tid}`, { token });
check('GET /tickets/:id has traces', tDetail.status === 200 && Array.isArray(tDetail.json?.data?.traces) && tDetail.json.data.traces.length >= 1);
check('GET /tickets/999999 404', (await call('GET', '/api/ops/tickets/999999', { token })).status === 404);
check('tickets page clamp pageSize 100', (await call('GET', '/api/ops/tickets?pageSize=1000', { token })).json?.meta?.pageSize === 100);

// full flow: create -> accept -> verify -> close
const cr = await call('POST', '/api/ops/tickets', {
  token,
  body: { title: 'E2E 压测工单 - 接口联调', category: '故障处理', priority: '高', description: '自动化测试创建：验证工单状态机全流程', contact: '13800000000', sla_hours: 8 },
});
check('POST /tickets 200', cr.status === 200 || cr.status === 201, String(cr.status));
const nt = cr.json?.data;
check('new ticket_no format', /^TK-\d{8}-\d{3}$/.test(nt?.ticket_no || ''), nt?.ticket_no);
check('new ticket status 待受理', nt?.status === '待受理');
check('new ticket has create trace', nt?.traces?.[0]?.action === '创建');

// illegal transition: 待受理 -> 已关闭 must be 400
const bad = await call('PUT', `/api/ops/tickets/${nt.id}/status`, { token, body: { status: '已关闭', note: '非法跳转测试' } });
check('illegal transition 400', bad.status === 400, `${bad.status} ${JSON.stringify(bad.json)}`);

const st1 = await call('PUT', `/api/ops/tickets/${nt.id}/status`, { token, body: { status: '处理中', note: '已受理，开始处理', assignee: 'ops-admin' } });
check('accept -> 处理中', st1.status === 200 && st1.json?.data?.status === '处理中');
check('accepted_at set', !!st1.json?.data?.accepted_at, JSON.stringify(st1.json?.data?.accepted_at));
const st2 = await call('PUT', `/api/ops/tickets/${nt.id}/status`, { token, body: { status: '待验证', note: '修复完成，等待验证' } });
check('process -> 待验证', st2.status === 200 && st2.json?.data?.status === '待验证');
const st3 = await call('PUT', `/api/ops/tickets/${nt.id}/status`, { token, body: { status: '已关闭', note: '验证通过，关闭工单', resolution: '已修复' } });
check('verify -> 已关闭', st3.status === 200 && st3.json?.data?.status === '已关闭');
check('closed_at set', !!st3.json?.data?.closed_at, JSON.stringify(st3.json?.data?.closed_at));
const traceActions = (st3.json?.data?.traces || []).map((x) => x.action);
check('trace timeline 4 entries 创建/受理/处理/关闭', traceActions.length === 4 && traceActions.join(',') === '创建,受理,处理,关闭', traceActions.join(','));
const again = await call('PUT', `/api/ops/tickets/${nt.id}/status`, { token, body: { status: '处理中', note: 'reopen' } });
check('closed ticket cannot transition 400', again.status === 400, String(again.status));
check('ticket validation 400 (bad category)', (await call('POST', '/api/ops/tickets', { token, body: { title: 'x', category: '非法' } })).status === 400);

// ---------- backups ----------
const bl = await call('GET', '/api/ops/backups?page=1&pageSize=5', { token });
check('GET /backups 200', bl.status === 200 && bl.json?.data?.length === 5 && bl.json?.meta?.total >= 14);
check('backups meta successRate', typeof bl.json?.meta?.summary?.successRate === 'number', JSON.stringify(bl.json?.meta?.summary));
const bf = await call('GET', '/api/ops/backups?status=' + encodeURIComponent('失败'), { token });
check('backups filter 失败', bf.json?.data?.length >= 1 && bf.json.data.every((b) => b.status === '失败'));
const pb = await call('POST', '/api/ops/backups', { token, body: { backup_type: '全量', scope: '全库', operator: 'admin' } });
check('POST /backups 200', pb.status === 200 || pb.status === 201, String(pb.status));
check('new backup_no format', /^BK-\d{8}-\d{2}$/.test(pb.json?.data?.backup_no || ''), pb.json?.data?.backup_no);
check('backup sha256 checksum', /^sha256:[0-9a-f]{32}/.test(pb.json?.data?.checksum || ''), pb.json?.data?.checksum);
check('backup status 成功', pb.json?.data?.status === '成功');
const pb2 = await call('POST', '/api/ops/backups', { token, body: { backup_type: '增量', scope: '增量数据' } });
check('second backup seq increments', pb2.json?.data?.backup_no !== pb.json?.data?.backup_no, `${pb.json?.data?.backup_no} vs ${pb2.json?.data?.backup_no}`);

// ---------- configs ----------
const cf = await call('GET', '/api/ops/configs', { token });
check('GET /configs 200 grouped', cf.status === 200 && Array.isArray(cf.json?.data));
const groups = cf.json?.data || [];
const allItems = groups.flatMap((g) => g.items || []);
check('configs 12 items', allItems.length === 12, String(allItems.length));
check('configs groups include 安全策略', groups.some((g) => g.group === '安全策略'));
const pvKey = allItems.find((i) => i.config_key === 'platform.version');
check('platform.version exists', pvKey?.config_value === 'V1.0.0');
const putC = await call('PUT', '/api/ops/configs/login.max_fail', { token, body: { value: '5' } });
check('PUT /configs/:key 200', putC.status === 200 && putC.json?.data?.config_value === '5', `${putC.status} ${JSON.stringify(putC.json).slice(0, 200)}`);
check('PUT config not found 404', (await call('PUT', '/api/ops/configs/no.such.key', { token, body: { value: 'x' } })).status === 404);
check('PUT config empty value 400', (await call('PUT', '/api/ops/configs/login.max_fail', { token, body: { value: '' } })).status === 400);

// ---------- versions ----------
const v = await call('GET', '/api/ops/versions', { token });
check('GET /versions 200', v.status === 200);
check('versions current', v.json?.data?.current?.version === 'V1.0.0', JSON.stringify(v.json?.data?.current?.version));
check('versions history 3-5', Array.isArray(v.json?.data?.history) && v.json.data.history.length >= 3 && v.json.data.history.length <= 5);

// ---------- permissions (auditor read-only) ----------
const auditOv = await call('GET', '/api/ops/overview', { token: auditor });
check('auditor GET overview 200', auditOv.status === 200, String(auditOv.status));
const auditPost = await call('POST', '/api/ops/backups', { token: auditor, body: { backup_type: '全量' } });
check('auditor POST backups 403', auditPost.status === 403, String(auditPost.status));
const auditTicket = await call('POST', '/api/ops/tickets', { token: auditor, body: { title: 'x', category: '故障处理', description: '12345' } });
check('auditor POST tickets 403', auditTicket.status === 403, String(auditTicket.status));
check('no token GET 401', (await call('GET', '/api/ops/overview')).status === 401);

console.log(`\n=== RESULT: pass=${pass} fail=${fail} ===`);
if (fails.length) { console.log('FAILURES:'); fails.forEach((f) => console.log(' - ' + f)); process.exitCode = 1; }
