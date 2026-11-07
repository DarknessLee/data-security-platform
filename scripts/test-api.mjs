#!/usr/bin/env node
/**
 * API 门禁：健康检查、认证、六大模块读写与权限拒绝、导出与完整性校验。
 * 前置：API 已启动（http://127.0.0.1:8081）、数据库已初始化。
 * 末行固定输出：RESULT=PASS|FAIL passed=N failed=M 用时=S
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8081/api';
const started = Date.now();
let passed = 0;
let failed = 0;
const failures = [];

function log(line) {
  console.log(line);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function request(method, path, { token, body, raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json, headers: res.headers };
}

async function t(name, fn) {
  try {
    await fn();
    passed += 1;
    log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, message: err.message });
    log(`FAIL ${name} ${err.message}`);
  }
}

function ok(res, status = 200) {
  assert(res.status === status, `HTTP ${res.status}${res.body?.message ? ` ${res.body.message}` : ''}`);
  if (res.body) assert(res.body.code === 0, `业务码 ${res.body.code} ${res.body.message ?? ''}`);
  return res.body?.data;
}

function err(res, status) {
  assert(res.status === status, `期望 HTTP ${status}，实际 ${res.status}`);
}

async function login(username, password) {
  const res = await request('POST', '/auth/login', { body: { username, password } });
  const data = ok(res);
  assert(data.token, '登录未返回 token');
  return data;
}

const TOKENS = {};

async function main() {
  log('=== 大数据安全治理与服务保障平台 API 门禁 ===');

  await t('健康检查返回 UP 且依赖就绪', async () => {
    const res = await request('GET', '/health');
    const data = ok(res);
    assert(data.status === 'UP', `状态为 ${data.status}`);
    assert(data.mysql === 'UP', 'MySQL 未就绪');
    assert(data.redis === 'UP', 'Redis 未就绪');
  });

  await t('未携带令牌访问受保护接口返回 401', async () => {
    err(await request('GET', '/dashboard/overview'), 401);
  });

  await t('错误密码登录返回 401', async () => {
    err(await request('POST', '/auth/login', { body: { username: 'admin', password: 'wrong-password' } }), 401);
  });

  await t('管理员登录成功并返回菜单与权限', async () => {
    const data = await login('admin', 'Admin@2026');
    TOKENS.admin = data.token;
    assert(data.user.roleCodes.includes('SUPER_ADMIN'), '角色不正确');
    assert(Array.isArray(data.menus) && data.menus.length >= 7, `菜单数为 ${data.menus?.length}`);
  });

  for (const [key, username, password] of [
    ['auditor', 'auditor', 'Audit@2026'],
    ['analyst', 'analyst', 'Analyst@2026'],
    ['ops', 'ops', 'Ops@2026'],
    ['compliance', 'compliance', 'Comp@2026'],
  ]) {
    await t(`账号 ${username} 可正常登录`, async () => {
      const data = await login(username, password);
      TOKENS[key] = data.token;
    });
  }

  await t('当前用户信息包含部门、角色与权限位', async () => {
    const data = ok(await request('GET', '/auth/profile', { token: TOKENS.admin }));
    assert(data.user.username === 'admin', '用户名不匹配');
    assert(data.user.deptName, '缺少部门信息');
    assert(data.menus.length >= 7, '菜单树不完整');
  });

  await t('平台元信息返回 7 个模块', async () => {
    const data = ok(await request('GET', '/meta', { token: TOKENS.admin }));
    assert(data.modules.length === 7, `模块数为 ${data.modules.length}`);
  });

  await t('看板总览返回卡片与图表数据', async () => {
    const data = ok(await request('GET', '/dashboard/overview', { token: TOKENS.admin }));
    assert(data.cards.totalAssets === 64, `资产数为 ${data.cards.totalAssets}`);
    assert(data.riskTrend.length === 7, '风险趋势不是 7 天');
    assert(data.assetLevel.length === 4, '资产分级不是 4 级');
    assert(data.recentEvents.length > 0, '重点风险事件为空');
  });

  // ============ 数据资产治理 ============
  let assetId = null;
  await t('资产列表分页返回 64 条', async () => {
    const res = await request('GET', '/assets?page=1&pageSize=10', { token: TOKENS.admin });
    const data = ok(res);
    assert(Array.isArray(data), '返回不是数组');
    assert(data.length === 10, `本页 ${data.length} 条`);
    assert(res.body.meta.total === 64, `总数为 ${res.body.meta?.total}`);
    assetId = data[0].id;
  });

  await t('资产按级别筛选结果全部匹配', async () => {
    const data = ok(await request('GET', '/assets?level=机密&pageSize=50', { token: TOKENS.admin }));
    assert(data.length > 0, '筛选结果为空');
    assert(data.every((a) => a.data_level === '机密'), '存在不匹配记录');
  });

  await t('资产分类统计返回 8 个分类', async () => {
    const data = ok(await request('GET', '/assets/categories', { token: TOKENS.admin }));
    assert(data.length === 8, `分类数为 ${data.length}`);
  });

  await t('资产统计接口字段完整', async () => {
    const data = ok(await request('GET', '/assets/stats', { token: TOKENS.admin }));
    assert(Number(data.total) === 64, `总量 ${data.total}`);
    assert(Array.isArray(data.byLevel), '缺少分级分布');
    assert(Array.isArray(data.bySource), '缺少来源系统分布');
  });

  await t('资产详情返回标签与生命周期', async () => {
    const data = ok(await request('GET', `/assets/${assetId}`, { token: TOKENS.admin }));
    assert(data.asset_name, '缺少资产名称');
    assert(Array.isArray(data.lifecycle), '缺少生命周期');
  });

  await t('资产标签云返回数据', async () => {
    const data = ok(await request('GET', '/assets/tags', { token: TOKENS.admin }));
    assert(Array.isArray(data) && data.length > 0, '标签为空');
  });

  let newAssetId = null;
  await t('登记新资产成功并写入生命周期', async () => {
    const base = ok(await request('GET', `/assets/${assetId}`, { token: TOKENS.admin }));
    const res = await request('POST', '/assets', {
      token: TOKENS.admin,
      body: {
        asset_name: '新增演示资产台账A',
        category_id: base.category_id,
        dept_id: base.dept_id,
        source_system: '数据共享交换平台',
        data_type: '结构化',
        data_level: '内部',
        owner: '王慧敏',
        description: '门禁用例自动登记，用于验证资产新增链路',
      },
    });
    const data = ok(res);
    newAssetId = data.id;
    assert(newAssetId, '未返回新资产 id');
    assert(/^DA-2026-\d{4}$/.test(data.asset_code), `资产编号 ${data.asset_code} 不符合规范`);
  });

  await t('调整资产分级写入变更轨迹', async () => {
    const data = ok(await request('PUT', `/assets/${newAssetId}/level`, { token: TOKENS.admin, body: { data_level: '机密', reason: '门禁用例：升级为机密级' } }));
    assert(data.message || data.data_level === '机密', '未返回调整结果');
    const detail = ok(await request('GET', `/assets/${newAssetId}`, { token: TOKENS.admin }));
    assert(detail.data_level === '机密', `当前级别 ${detail.data_level}`);
  });

  await t('单资产扫描复核返回敏感度评分', async () => {
    const data = ok(await request('POST', `/assets/${newAssetId}/scan`, { token: TOKENS.admin, body: {} }));
    assert(typeof data.sensitivity_score === 'number', '缺少敏感度评分');
  });

  await t('全局资产扫描任务返回统计', async () => {
    const data = ok(await request('POST', '/assets/scan', { token: TOKENS.admin, body: {} }));
    assert(data.scanned > 0, '扫描数量为 0');
  });

  await t('资产台账导出 CSV', async () => {
    const res = await request('GET', '/assets/export', { token: TOKENS.admin, raw: true });
    assert(res.status === 200, `HTTP ${res.status}`);
    assert(res.headers.get('content-type')?.includes('csv'), '响应不是 CSV');
    assert(res.text.includes('资产编号') || res.text.includes('DA-2026'), 'CSV 内容缺少表头或数据');
  });

  // ============ 安全合规管理 ============
  await t('合规总览返回规则数与通过率', async () => {
    const data = ok(await request('GET', '/compliance/overview', { token: TOKENS.admin }));
    assert(data.ruleCount === 20, `规则数 ${data.ruleCount}`);
    assert(typeof data.passRate === 'number', '缺少通过率');
  });

  await t('合规规则库返回 20 条规则', async () => {
    const res = await request('GET', '/compliance/rules?page=1&pageSize=20', { token: TOKENS.admin });
    const data = ok(res);
    assert(res.body.meta.total === 20, `总数 ${res.body.meta?.total}`);
    assert(data[0].rule_code, '缺少规则编号');
  });

  await t('合规检查结果支持批次筛选', async () => {
    const res = await request('GET', '/compliance/checks?batchNo=CHK-2026-005&page=1&pageSize=30', { token: TOKENS.admin });
    const data = ok(res);
    assert(data.length === 20, `本批 ${data.length} 条`);
    assert(data.every((c) => c.batch_no === 'CHK-2026-005'), '批次筛选失效');
  });

  await t('执行合规检查生成新批次结果', async () => {
    const data = ok(await request('POST', '/compliance/checks/run', { token: TOKENS.admin, body: {} }));
    assert(/^CHK-\d{4}-\d{3}$/.test(data.batchNo), `批次号 ${data.batchNo}`);
    assert(data.total > 0, '检查条数为 0');
  });

  await t('合规批次列表返回历史批次', async () => {
    const data = ok(await request('GET', '/compliance/batches', { token: TOKENS.admin }));
    assert(Array.isArray(data) && data.length >= 5, `批次数 ${data.length}`);
  });

  let rectifyId = null;
  await t('整改跟踪列表返回待整改记录', async () => {
    const res = await request('GET', '/compliance/rectify?page=1&pageSize=20', { token: TOKENS.admin });
    const data = ok(res);
    assert(data.length > 0, '整改列表为空');
    rectifyId = data[0].id;
  });

  await t('更新整改单进度', async () => {
    const data = ok(await request('PUT', `/compliance/rectify/${rectifyId}`, { token: TOKENS.admin, body: { status: '整改中', progress: 60, measure: '门禁用例：已补充脱敏配置，待复核' } }));
    assert(data.message || data.status === '整改中', '更新失败');
  });

  await t('脱敏规则列表返回 10 条', async () => {
    const data = ok(await request('GET', '/compliance/masking', { token: TOKENS.admin }));
    assert(data.length === 10, `脱敏规则 ${data.length} 条`);
  });

  await t('脱敏试运行返回脱敏前后样例', async () => {
    const rules = ok(await request('GET', '/compliance/masking', { token: TOKENS.admin }));
    const data = ok(await request('POST', `/compliance/masking/${rules[0].id}/test`, { token: TOKENS.admin, body: { sample: '13812345678' } }));
    assert(data.before && data.after, '缺少脱敏前后样例');
    assert(data.after !== data.before, '脱敏后与原值相同');
  });

  let approvalId = null;
  await t('共享审批列表含待审批记录', async () => {
    const res = await request('GET', '/compliance/approvals?status=待审批&page=1&pageSize=20', { token: TOKENS.admin });
    const data = ok(res);
    assert(data.length > 0, '待审批为空');
    approvalId = data[0].id;
  });

  await t('共享审批通过写入审批意见', async () => {
    const data = ok(await request('PUT', `/compliance/approvals/${approvalId}/approve`, { token: TOKENS.admin, body: { approved: true, comment: '门禁用例：材料齐全，同意共享' } }));
    assert(data.message || data.status === '已通过', '审批未生效');
  });

  await t('合规报告按批次聚合', async () => {
    const data = ok(await request('GET', '/compliance/report?batchNo=CHK-2026-005', { token: TOKENS.admin }));
    assert(data.summary, '缺少报告摘要');
  });

  // ============ 智能风险监测 ============
  await t('风险总览返回待处置与趋势', async () => {
    const data = ok(await request('GET', '/risk/overview', { token: TOKENS.admin }));
    assert(typeof data.pending === 'number', '缺少待处置数量');
    assert(Array.isArray(data.ruleTop), '缺少规则命中排行');
  });

  await t('监测规则返回 10 条', async () => {
    const data = ok(await request('GET', '/risk/rules', { token: TOKENS.admin }));
    assert(data.length === 10, `规则 ${data.length} 条`);
  });

  await t('风险事件列表共 48 条且支持级别筛选', async () => {
    const res = await request('GET', '/risk/events?page=1&pageSize=10', { token: TOKENS.admin });
    ok(res);
    assert(res.body.meta.total === 48, `总数 ${res.body.meta?.total}`);
    const filtered = await request('GET', '/risk/events?level=紧急&pageSize=50', { token: TOKENS.admin });
    const data = ok(filtered);
    assert(data.length > 0 && data.every((e) => e.level === '紧急'), '级别筛选失效');
  });

  let eventId = null;
  await t('风险事件详情与溯源链路可查', async () => {
    const list = ok(await request('GET', '/risk/events?pageSize=5', { token: TOKENS.admin }));
    eventId = list[0].id;
    const detail = ok(await request('GET', `/risk/events/${eventId}`, { token: TOKENS.admin }));
    assert(detail.event_no, '缺少事件编号');
    const trace = ok(await request('GET', `/risk/trace?eventId=${eventId}`, { token: TOKENS.admin }));
    assert(trace.event, '缺少溯源事件');
  });

  await t('风险事件处置写入处置人与意见', async () => {
    const pending = ok(await request('GET', '/risk/events?status=待处置&pageSize=5', { token: TOKENS.admin }));
    const target = pending[0] ?? { id: eventId };
    const data = ok(await request('POST', `/risk/events/${target.id}/handle`, { token: TOKENS.admin, body: { status: '已处置', note: '门禁用例：已确认账号异常并封禁' } }));
    assert(data.message || data.status === '已处置', '处置未生效');
  });

  await t('风险趋势返回 7 天分级统计', async () => {
    const data = ok(await request('GET', '/risk/trend?days=7', { token: TOKENS.admin }));
    assert(data.length === 7, `趋势 ${data.length} 天`);
    assert('urgent' in data[0], '缺少紧急级别字段');
  });

  await t('实时监控返回最新事件与 IP 排行', async () => {
    const data = ok(await request('GET', '/risk/realtime', { token: TOKENS.admin }));
    assert(Array.isArray(data.latest), '缺少最新事件');
    assert(Array.isArray(data.ipTop), '缺少 IP 排行');
  });

  // ============ 权限安全管控 ============
  await t('权限总览返回用户与角色统计', async () => {
    const data = ok(await request('GET', '/rbac/overview', { token: TOKENS.admin }));
    assert(data.userCount >= 9, `用户数 ${data.userCount}`);
    assert(data.roleCount === 8, `角色数 ${data.roleCount}`);
  });

  await t('用户列表返回 9 个账号及角色', async () => {
    const res = await request('GET', '/rbac/users?page=1&pageSize=20', { token: TOKENS.admin });
    const data = ok(res);
    assert(res.body.meta.total >= 9, `总数 ${res.body.meta?.total}`);
    assert(Array.isArray(data[0].roles), '缺少角色信息');
  });

  await t('角色列表返回 8 个角色与权限矩阵', async () => {
    const data = ok(await request('GET', '/rbac/roles', { token: TOKENS.admin }));
    assert(data.length === 8, `角色 ${data.length} 个`);
    assert(Array.isArray(data[0].perms), '缺少权限位');
  });

  await t('角色权限配置含菜单树与接口清单', async () => {
    const roles = ok(await request('GET', '/rbac/roles', { token: TOKENS.admin }));
    const data = ok(await request('GET', `/rbac/roles/${roles[0].id}/permissions`, { token: TOKENS.admin }));
    assert(Array.isArray(data.menus), '缺少菜单权限');
    assert(Array.isArray(data.apis), '缺少接口权限');
  });

  await t('菜单权限全量为 30 条', async () => {
    const data = ok(await request('GET', '/rbac/menus', { token: TOKENS.admin }));
    const flat = (nodes) => nodes.flatMap((n) => [n, ...(n.children ?? [])]);
    assert(flat(data).length === 30, `菜单 ${flat(data).length} 条`);
  });

  await t('接口权限清单为 43 条', async () => {
    const data = ok(await request('GET', '/rbac/apis', { token: TOKENS.admin }));
    assert(data.length === 43, `接口权限 ${data.length} 条`);
  });

  await t('部门列表返回 6 个部门', async () => {
    const data = ok(await request('GET', '/rbac/depts', { token: TOKENS.admin }));
    assert(data.length === 6, `部门 ${data.length} 个`);
  });

  await t('安全策略读取密码与锁定配置', async () => {
    const data = ok(await request('GET', '/rbac/policy', { token: TOKENS.admin }));
    const keys = (data.items ?? data).map?.((i) => i.config_key) ?? [];
    assert(keys.includes('security.password.min_length'), '缺少密码策略');
  });

  let tempUserId = null;
  await t('新增用户成功并绑定角色', async () => {
    const res = await request('POST', '/rbac/users', {
      token: TOKENS.admin,
      body: {
        username: `demo_${Date.now().toString().slice(-6)}`,
        real_name: '验证账号',
        password: 'Demo@2026user',
        dept_id: 1,
        job_title: '数据运营专员',
        roleCodes: ['ANALYST'],
      },
    });
    const data = ok(res);
    tempUserId = data.id;
    assert(tempUserId, '未返回用户 id');
  });

  await t('停用用户成功', async () => {
    const data = ok(await request('PUT', `/rbac/users/${tempUserId}/status`, { token: TOKENS.admin, body: { status: 0 } }));
    assert(data.message || data.status === 0, '停用未生效');
  });

  await t('只读角色写接口被拒绝（审计员新增用户 403）', async () => {
    err(await request('POST', '/rbac/users', { token: TOKENS.auditor, body: { username: 'x', real_name: 'x', password: 'Xx@20261234', dept_id: 1, roleCodes: [] } }), 403);
  });

  await t('无权限角色访问权限模块被拒绝（数据分析师 403）', async () => {
    err(await request('GET', '/rbac/users', { token: TOKENS.analyst }), 403);
  });

  await t('运维角色可读权限模块但不可写（200/403）', async () => {
    ok(await request('GET', '/rbac/users?page=1&pageSize=5', { token: TOKENS.ops }));
    err(await request('POST', '/rbac/users', { token: TOKENS.ops, body: { username: 'y', real_name: 'y', password: 'Yy@20261234', dept_id: 1, roleCodes: [] } }), 403);
  });

  // ============ 安全审计追溯 ============
  await t('审计总览返回日志量与类型分布', async () => {
    const data = ok(await request('GET', '/audit/overview', { token: TOKENS.admin }));
    assert(data.todayLogs > 0, '今日日志为 0');
    assert(Array.isArray(data.byType), '缺少类型分布');
  });

  await t('审计日志分页与类型筛选', async () => {
    const res = await request('GET', '/audit/logs?page=1&pageSize=10&logType=登录日志', { token: TOKENS.admin });
    const data = ok(res);
    assert(data.length > 0 && data.every((l) => l.log_type === '登录日志'), '类型筛选失效');
  });

  await t('审计日志详情返回哈希校验结果', async () => {
    const list = ok(await request('GET', '/audit/logs?pageSize=1', { token: TOKENS.admin }));
    const data = ok(await request('GET', `/audit/logs/${list[0].id}`, { token: TOKENS.admin }));
    assert(data.hash, '缺少哈希');
    assert(typeof data.verified === 'boolean', '缺少校验结果');
  });

  await t('审计日志完整性链式校验通过', async () => {
    const data = ok(await request('GET', '/audit/integrity', { token: TOKENS.admin }));
    assert(data.chainValid === true, `链校验未通过，破损 ${data.broken?.length ?? 0} 条`);
    assert(data.total > 300, `日志总量 ${data.total}`);
  });

  await t('审计日志导出 CSV', async () => {
    const res = await request('GET', '/audit/export?logType=登录日志', { token: TOKENS.admin, raw: true });
    assert(res.status === 200, `HTTP ${res.status}`);
    assert(res.headers.get('content-type')?.includes('csv'), '响应不是 CSV');
  });

  await t('审计报表列表返回 5 份报表', async () => {
    const res = await request('GET', '/audit/reports?page=1&pageSize=20', { token: TOKENS.admin });
    const data = ok(res);
    assert(res.body.meta.total >= 5, `报表数 ${res.body.meta?.total}`);
    assert(data[0].report_type, '缺少报表类型');
  });

  await t('生成日报成功并写入报表库', async () => {
    const data = ok(await request('POST', '/audit/reports', { token: TOKENS.admin, body: { reportType: '日报' } }));
    assert(data.report_no, '缺少报表编号');
  });

  // ============ 服务保障运维 ============
  await t('运维总览返回实时指标与工单统计', async () => {
    const data = ok(await request('GET', '/ops/overview', { token: TOKENS.admin }));
    assert(data.latest, '缺少实时指标');
    assert(typeof data.availability === 'number', '缺少可用率');
  });

  await t('监控指标时序数据可查', async () => {
    const data = ok(await request('GET', '/ops/metrics?hours=24', { token: TOKENS.admin }));
    assert(Array.isArray(data) && data.length > 10, `指标点 ${data.length}`);
    assert('cpu_usage' in data[0], '缺少 CPU 字段');
  });

  await t('运维告警按阈值计算', async () => {
    const data = ok(await request('GET', '/ops/alerts', { token: TOKENS.admin }));
    assert(Array.isArray(data), '返回不是数组');
  });

  await t('工单列表返回 22 条记录', async () => {
    const res = await request('GET', '/ops/tickets?page=1&pageSize=10', { token: TOKENS.admin });
    const data = ok(res);
    assert(res.body.meta.total === 22, `工单总数 ${res.body.meta?.total}`);
    assert(Array.isArray(data), '返回不是数组');
  });

  let ticketId = null;
  await t('新建工单生成编号与流转轨迹', async () => {
    const data = ok(await request('POST', '/ops/tickets', {
      token: TOKENS.admin,
      body: { title: '门禁用例：数据备份任务告警核查', category: '故障处理', priority: '中', description: '夜间全量备份任务失败，需核查存储空间与备份脚本', contact: '13800010202', sla_hours: 24 },
    }));
    ticketId = data.id;
    assert(/^TK-\d{8}-\d{3}$/.test(data.ticket_no), `工单号 ${data.ticket_no}`);
  });

  await t('工单状态流转：处理中 → 待验证 → 已关闭', async () => {
    ok(await request('PUT', `/ops/tickets/${ticketId}/status`, { token: TOKENS.admin, body: { status: '处理中', note: '门禁用例：已受理，开始排查' } }));
    ok(await request('PUT', `/ops/tickets/${ticketId}/status`, { token: TOKENS.admin, body: { status: '待验证', note: '门禁用例：已扩容存储并重跑备份' } }));
    ok(await request('PUT', `/ops/tickets/${ticketId}/status`, { token: TOKENS.admin, body: { status: '已关闭', note: '门禁用例：验证通过，备份恢复成功' } }));
    const detail = ok(await request('GET', `/ops/tickets/${ticketId}`, { token: TOKENS.admin }));
    assert(detail.status === '已关闭', `最终状态 ${detail.status}`);
    assert(detail.traces.length >= 4, `轨迹 ${detail.traces.length} 条`);
  });

  await t('备份记录列表返回 14 条', async () => {
    const res = await request('GET', '/ops/backups?page=1&pageSize=20', { token: TOKENS.admin });
    assert(res.body.meta.total >= 14, `备份记录 ${res.body.meta?.total}`);
  });

  await t('手动触发备份生成记录与校验值', async () => {
    const data = ok(await request('POST', '/ops/backups', { token: TOKENS.admin, body: {} }));
    assert(/^BK-\d{8}-\d{2}$/.test(data.backup_no), `备份号 ${data.backup_no}`);
    assert(data.checksum, '缺少校验值');
  });

  await t('平台配置分组读取 12 项', async () => {
    const data = ok(await request('GET', '/ops/configs', { token: TOKENS.admin }));
    const items = Array.isArray(data) ? data : (data.items ?? []);
    assert(items.length >= 12, `配置项 ${items.length}`);
  });

  await t('更新平台配置并回读一致', async () => {
    ok(await request('PUT', '/ops/configs/risk.alert.channels', { token: TOKENS.admin, body: { value: '站内消息,邮件,短信' } }));
    const data = ok(await request('GET', '/ops/configs', { token: TOKENS.admin }));
    const items = Array.isArray(data) ? data : (data.items ?? []);
    const hit = items.find((i) => (i.config_key ?? i.key) === 'risk.alert.channels');
    assert(hit && String(hit.config_value ?? hit.value).includes('短信'), '配置未生效');
  });

  await t('版本管理返回当前版本与历史版本', async () => {
    const data = ok(await request('GET', '/ops/versions', { token: TOKENS.admin }));
    assert(data.current, '缺少当前版本');
    assert(Array.isArray(data.history) && data.history.length > 0, '缺少历史版本');
  });

  // ============ 数据范围与注销 ============
  await t('部门范围账号仅能看到本部门数据（数据管理员）', async () => {
    const data = ok(await request('GET', '/assets?pageSize=100', { token: TOKENS.compliance }));
    assert(data.length > 0, '资产为空');
    const depts = new Set(data.map((a) => a.dept_id));
    assert(depts.size <= 1, `跨部门数据 ${depts.size} 个部门`);
  });

  await t('注销接口返回成功', async () => {
    const data = ok(await request('POST', '/auth/logout', { token: TOKENS.admin }));
    assert(data.message, '缺少提示信息');
  });

  log('');
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (failed === 0) {
    log(`RESULT=PASS passed=${passed} failed=0 用时=${seconds}s`);
    process.exit(0);
  } else {
    log(`RESULT=FAIL passed=${passed} failed=${failed} 用时=${seconds}s`);
    for (const f of failures) log(`  - ${f.name}: ${f.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[test-api] 执行异常:', err);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`RESULT=FAIL passed=${passed} failed=${failed + 1} 用时=${seconds}s`);
  process.exit(1);
});
