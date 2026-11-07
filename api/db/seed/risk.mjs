// 智能风险监测种子：监测规则、风险事件
import { createRng, pick, randInt, fmtDateTime, daysAgo, hoursAgo } from './lib.mjs';

// [编码, 名称, 事件类型, 检测表达式, 级别, 是否启用]
export const RISK_RULES = [
  ['RR-001', '越权访问敏感数据', '越权访问', 'role_scope(data_level) AND asset.data_level >= "机密"', '高', 1],
  ['RR-002', '批量导出数据', '批量导出', 'export_rows > 10000 OR export_size_mb > 50', '高', 1],
  ['RR-003', '异常登录行为', '异常登录', 'login.location != user.common_location OR login.hour NOT BETWEEN 6 AND 22', '中', 1],
  ['RR-004', '数据篡改识别', '数据篡改', 'checksum != baseline_checksum AND NOT EXISTS(change_ticket)', '紧急', 1],
  ['RR-005', '非工作时间访问', '越权访问', 'access.hour >= 22 OR access.hour < 6', '低', 1],
  ['RR-006', '敏感数据高频查询', '敏感外传', 'count(query sensitive_field) > 200 WITHIN 10 MINUTES', '中', 1],
  ['RR-007', '共享超范围使用', '敏感外传', 'share.purpose NOT IN approval.purpose', '高', 1],
  ['RR-008', '接口异常调用', '敏感外传', 'api.qps > 1000 OR response_contains(sensitive_field)', '中', 1],
  ['RR-009', '账号共用嫌疑', '异常登录', 'count(distinct device) > 1 WITHIN 5 MINUTES', '中', 0],
  ['RR-010', '离职账号活跃', '异常登录', 'user.status = "离职" AND user.last_login_at > user.left_at', '紧急', 1],
];

export const EVENT_TEMPLATES = [
  { rule: 0, eventType: '越权访问', title: '越权访问电子健康档案数据', detail: (a, u) => `账号 ${u} 以“数据分析师”角色访问电子健康档案数据（绝密级），超出授权数据范围。`, level: '高' },
  { rule: 0, eventType: '越权访问', title: '越权访问反洗钱可疑交易数据', detail: (a, u) => `账号 ${u} 尝试查询反洗钱可疑交易数据，该资源仅对安全管理员开放。`, level: '高' },
  { rule: 1, eventType: '批量导出', title: '批量导出客户身份信息', detail: (a, u) => `账号 ${u} 在 3 分钟内连续导出 ${a} 数据 128,640 条，超过批量导出阈值。`, level: '紧急' },
  { rule: 1, eventType: '批量导出', title: '一次性导出医保结算明细', detail: (a, u) => `账号 ${u} 导出医保结算明细数据 36,200 条，导出行为未关联审批单。`, level: '高' },
  { rule: 2, eventType: '异常登录', title: '账号异地登录', detail: (a, u) => `账号 ${u} 于异地登录，与常用登录地不一致，登录设备为陌生设备。`, level: '中' },
  { rule: 2, eventType: '异常登录', title: '凌晨异常登录尝试', detail: (a, u) => `账号 ${u} 在 03:12 尝试登录平台，连续失败 4 次后成功。`, level: '中' },
  { rule: 3, eventType: '数据篡改', title: '核心数据校验值异常', detail: (a, u) => `${a} 核心表 3 条记录的校验值与基线不一致，未发现对应变更工单。`, level: '紧急' },
  { rule: 3, eventType: '数据篡改', title: '资产元数据被篡改', detail: (a, u) => `${a} 的分类分级标识被修改为“公开”，操作来源为 ${u}，无审批记录。`, level: '高' },
  { rule: 4, eventType: '越权访问', title: '非工作时间访问个人信息', detail: (a, u) => `账号 ${u} 于 23:48 访问 ${a} 中的个人信息字段 42 次。`, level: '低' },
  { rule: 5, eventType: '敏感外传', title: '敏感字段高频查询', detail: (a, u) => `账号 ${u} 在 10 分钟内查询 ${a} 身份证号字段 386 次。`, level: '中' },
  { rule: 6, eventType: '敏感外传', title: '共享数据超范围使用', detail: (a, u) => `${a} 的共享数据被用于“营销分析”场景，超出审批用途“政务数据共享交换”。`, level: '高' },
  { rule: 7, eventType: '敏感外传', title: '开放接口返回敏感字段', detail: (a, u) => `/api/open/data/query 接口返回结果中包含未脱敏手机号，触发 ${a} 脱敏策略缺失告警。`, level: '中' },
  { rule: 9, eventType: '异常登录', title: '离职账号仍可登录', detail: (a, u) => `已办理离职手续的账号 ${u} 仍成功登录并访问 ${a}。`, level: '紧急' },
];

export async function seedRisk(conn, ref, assets) {
  const rng = createRng(20261109);
  const ruleIds = [];
  for (const [code, name, eventType, expression, level, enabled] of RISK_RULES) {
    const [r] = await conn.query(
      'INSERT INTO risk_rule (rule_code, rule_name, event_type, expression, level, enabled, hit_count, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [code, name, eventType, expression, level, enabled, 0, fmtDateTime(daysAgo(randInt(rng, 20, 90)))],
    );
    ruleIds.push(r.insertId);
  }

  const handlers = ['王慧敏', '赵晓东', '周雅琴', '刘文博'];
  const handles = {
    '已处置': '已核实并完成处置，风险已消除，已补充访问控制策略并通知责任人',
    '已忽略': '经核实为业务正常行为，标记误报并优化检测规则',
    '处置中': '正在核查访问来源与数据影响范围，已冻结相关账号会话',
  };
  const hitCount = {};
  for (let i = 0; i < 48; i += 1) {
    const tpl = EVENT_TEMPLATES[Math.floor(rng() * EVENT_TEMPLATES.length)];
    const asset = pick(rng, assets);
    const account = pick(rng, ['analyst', 'depthead', 'steward', 'ops', 'guest', 'compliance', 'auditor']);
    const occurred = hoursAgo(i < 8 ? randInt(rng, 1, 9) : i < 34 ? randInt(rng, 10, 168) : randInt(rng, 169, 24 * 20));
    const status = i < 4 ? '待处置' : i < 9 ? '处置中' : pick(rng, ['已处置', '已处置', '已处置', '已忽略']);
    hitCount[tpl.rule] = (hitCount[tpl.rule] || 0) + 1;
    await conn.query(
      `INSERT INTO risk_event (event_no, rule_id, event_type, level, asset_id, username, dept_id, ip, device, location, detail, status, occurred_at, handled_by, handled_at, handle_note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`RE-2026-${String(i + 1).padStart(4, '0')}`, ruleIds[tpl.rule], tpl.eventType, tpl.level, asset.id, account, ref.deptIdByCode[asset.deptCode],
        `10.20.${randInt(rng, 1, 30)}.${randInt(rng, 2, 240)}`, pick(rng, ['Chrome 131 / Windows 11', 'Edge 130 / Windows 10', 'Safari 18 / macOS 15', '企业微信内置浏览器']),
        pick(rng, ['北京市', '上海市', '广东省深圳市', '浙江省杭州市', '四川省成都市', '湖北省武汉市', '江苏省南京市']),
        tpl.detail(asset.name, account), status, fmtDateTime(occurred),
        status === '待处置' ? null : pick(rng, handlers), status === '待处置' ? null : fmtDateTime(new Date(occurred.getTime() + randInt(rng, 10, 600) * 60000)),
        status === '待处置' ? null : handles[status], fmtDateTime(occurred)],
    );
  }

  for (const [code, ruleId] of Object.entries(hitCount)) {
    await conn.query('UPDATE risk_rule SET hit_count = ? WHERE id = ?', [ruleId, ruleIds[Number(code)]]);
  }

  return { ruleIds };
}
