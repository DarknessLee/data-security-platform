// 安全审计种子：全量审计日志、审计报表
import { createRng, pick, randInt, fmtDateTime, daysAgo, fmtDate, plusDays, BASE_TIME } from './lib.mjs';

const LOG_ACTIONS = {
  登录日志: [
    ['登录平台', '成功'], ['登录平台', '成功'], ['登录平台', '失败'], ['退出登录', '成功'],
  ],
  访问日志: [
    ['查看数据资产台账', '成功'], ['查看风险事件详情', '成功'], ['查看审计日志', '成功'], ['查看合规检查结果', '成功'],
    ['查看用户权限配置', '成功'], ['查看运维监控指标', '成功'],
  ],
  操作日志: [
    ['新增数据资产', '成功'], ['更新资产分类分级', '成功'], ['处理风险事件', '成功'], ['提交合规整改', '成功'],
    ['审批数据共享申请', '成功'], ['重置用户密码', '成功'], ['导出资产清单', '成功'], ['更新脱敏规则', '成功'],
    ['关闭运维工单', '成功'], ['修改平台配置', '成功'],
  ],
  接口日志: [
    ['调用 /api/assets', '成功'], ['调用 /api/risk/events', '成功'], ['调用 /api/audit/logs', '成功'], ['调用 /api/compliance/checks', '成功'],
    ['调用 /api/ops/metrics', '成功'], ['调用 /api/rbac/users', '成功'],
  ],
};

const RESOURCES = ['数据资产', '风险事件', '合规检查', '审计日志', '用户', '角色', '工单', '备份记录', '平台配置', '共享审批'];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edge/130.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 15) Chrome/130.0.0.0 Mobile',
];

export async function seedAudit(conn, ref, users) {
  const rng = createRng(20261110);
  const types = Object.keys(LOG_ACTIONS);
  const accounts = users.map((u) => ({ id: u.id, username: u.username, realName: u.realName }));

  for (let day = 6; day >= 0; day -= 1) {
    const perDay = randInt(rng, 40, 52);
    for (let i = 0; i < perDay; i += 1) {
      const user = pick(rng, accounts);
      const type = pick(rng, types);
      const [action, baseResult] = pick(rng, LOG_ACTIONS[type]);
      const fail = baseResult === '失败' || (type !== '登录' && rng() < 0.06);
      const result = fail ? '失败' : '成功';
      const at = new Date(daysAgo(day, 8, 0).getTime() + randInt(rng, 0, 11 * 60) * 60000);
      const occurred = at > BASE_TIME ? new Date(BASE_TIME.getTime() - randInt(rng, 5, 240) * 60000) : at;
      const method = type === '登录日志' ? 'POST' : type === '接口日志' ? pick(rng, ['GET', 'POST']) : pick(rng, ['GET', 'POST', 'PUT']);
      const path = type === '登录日志' ? '/api/auth/login' : `/api/${pick(rng, ['assets', 'risk/events', 'audit/logs', 'compliance/checks', 'ops/metrics', 'rbac/users', 'ops/tickets'])}`;
      await conn.query(
        `INSERT INTO audit_log (log_type, user_id, username, action, resource, method, path, ip, user_agent, status_code, result, detail, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [type, user.id, user.username, action, type === '登录日志' ? '身份认证' : pick(rng, RESOURCES), method, path,
          `10.10.${randInt(rng, 1, 30)}.${randInt(rng, 2, 250)}`, pick(rng, USER_AGENTS), fail ? pick(rng, [401, 403, 500]) : 200, result,
          fail ? pick(rng, ['登录凭证已过期，请重新登录', '当前角色无权执行该操作', '服务内部异常，请联系管理员', '数据校验未通过']) : '操作执行成功，已记录审计留痕',
          fmtDateTime(occurred)],
      );
    }
  }

  const reportDefs = [
    ['日报', 1, '数据安全审计日报', 320, 6, 96.2],
    ['日报', 2, '数据安全审计日报', 286, 4, 95.8],
    ['周报', 7, '数据安全审计周报', 1986, 27, 94.6],
    ['月报', 30, '数据安全审计月报', 8624, 118, 93.8],
    ['年报', 365, '数据安全审计年报（2025 年度）', 98642, 1426, 92.4],
  ];
  let seq = 0;
  for (const [type, days, name, total, risks, rate] of reportDefs) {
    seq += 1;
    const end = daysAgo(days === 1 ? 1 : 0);
    const start = new Date(end);
    start.setDate(start.getDate() - (type === '日报' ? 0 : days - 1));
    await conn.query(
      'INSERT INTO audit_report (report_no, report_name, report_type, period_start, period_end, total_events, risk_events, compliance_rate, generated_by, content, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [`AR-2026-${String(seq).padStart(4, '0')}`, `${name}（${fmtDate(start)} 至 ${fmtDate(end)}）`, type, fmtDate(start), fmtDate(end), total, risks, rate,
        pick(rng, ['赵晓东', '王慧敏']),
        `本${type}共记录审计事件 ${total.toLocaleString('zh-CN')} 条，其中安全风险事件 ${risks} 条，风险处置率 ${randInt(rng, 92, 100)}%，合规检查通过率 ${rate}%，未发现数据泄露事件。`,
        fmtDateTime(plusDays(end, 1))],
    );
  }

  return {};
}
