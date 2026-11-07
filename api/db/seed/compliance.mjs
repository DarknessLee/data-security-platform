// 安全合规种子：合规规则库、检查批次结果、整改单、脱敏规则、共享审批
import { createRng, pick, randInt, fmtDate, fmtDateTime, daysAgo, plusDays, cnName } from './lib.mjs';

// [规则编号, 标题, 依据, 分类, 要求, 风险级别, 检查方式]
export const RULES = [
  ['CR-001', '个人信息采集需获得明确授权', '个人信息保护法', '合规管理', '收集个人信息应当取得个人同意，并保留同意记录备查', '高', '自动'],
  ['CR-002', '敏感个人信息单独告知', '个人信息保护法', '合规管理', '处理敏感个人信息应取得单独同意，并告知必要性与对个人权益的影响', '高', '自动'],
  ['CR-003', '重要数据出境需安全评估', '数据安全法', '跨境传输', '重要数据向境外提供前应申报数据出境安全评估并取得批准', '紧急', '人工'],
  ['CR-004', '数据分类分级标识完整', '数据安全法', '分类分级', '所有数据资产应完成分类分级并标注数据级别，无遗漏', '中', '自动'],
  ['CR-005', '核心数据访问双人复核', '等保2.0', '访问控制', '核心数据及绝密级数据的访问操作应双人在场复核', '高', '人工'],
  ['CR-006', '账号权限最小化', '等保2.0', '访问控制', '账号权限应遵循最小必要原则，每季度复核一次', '中', '自动'],
  ['CR-007', '默认口令与弱口令禁止', '等保2.0', '访问控制', '禁止使用默认口令与弱口令，密码策略需满足复杂度要求', '高', '自动'],
  ['CR-008', '登录失败锁定策略', '等保2.0', '访问控制', '连续登录失败达到阈值应锁定账号并告警', '中', '自动'],
  ['CR-009', '审计日志留存不少于六个月', '数据安全法', '审计留痕', '网络日志留存不少于六个月，且不可篡改', '高', '自动'],
  ['CR-010', '数据导出需审批留痕', '数据安全法', '审计留痕', '批量数据导出需经审批，导出行为应完整留痕', '高', '自动'],
  ['CR-011', '共享数据脱敏处理', '个人信息保护法', '加密脱敏', '对外共享的数据应进行去标识化或脱敏处理', '高', '自动'],
  ['CR-012', '数据副本定期清理', '数据安全法', '合规管理', '临时副本、测试数据应在使用后及时清理', '低', '人工'],
  ['CR-013', '第三方供应商安全评估', '数据安全法', '合规管理', '引入第三方服务前应完成数据安全评估并签署协议', '中', '人工'],
  ['CR-014', '数据销毁流程合规', '数据安全法', '合规管理', '数据销毁应履行审批并留存销毁记录', '中', '人工'],
  ['CR-015', '接口访问鉴权全覆盖', '等保2.0', '访问控制', '对外接口必须实施身份鉴别与访问控制', '高', '自动'],
  ['CR-016', '异常登录行为监测', '等保2.0', '审计留痕', '应监测异地登录、非工作时间登录等异常行为', '中', '自动'],
  ['CR-017', '数据库备份可用性验证', '等保2.0', '合规管理', '应定期验证备份数据可恢复性并记录', '中', '自动'],
  ['CR-018', '安全事件应急响应预案', '数据安全法', '合规管理', '应制定数据安全事件应急预案并定期演练', '中', '人工'],
  ['CR-019', '数据安全责任人明确', '数据安全法', '合规管理', '应明确数据安全负责人及岗位职责', '低', '人工'],
  ['CR-020', '员工数据安全培训每年一次', '等保2.0', '合规管理', '每年至少组织一次全员数据安全培训并留档', '低', '人工'],
];

const FAIL_ISSUES = [
  ['资产未标注数据级别，存在 3 项资产分类分级缺失', '数据资产管理平台'],
  ['共享数据未执行脱敏处理，对外提供报告中含完整身份证号', '数据共享交换平台'],
  ['审计日志留存周期为 90 天，低于六个月要求', '审计日志库'],
  ['5 个账号存在长期未使用的管理权限', '统一身份认证平台'],
  ['2 个账号使用弱口令，未满足密码复杂度要求', '统一身份认证平台'],
  ['3 个对外接口未启用鉴权，可匿名访问', 'API 网关'],
  ['近半年未开展备份恢复演练', '备份系统'],
  ['2 家第三方供应商未签署数据安全协议', '合同管理系统'],
  ['测试环境使用生产数据且未脱敏', '数据资产管理平台'],
  ['连续登录失败 5 次未触发账号锁定', '统一身份认证平台'],
];

const MASKING_RULES = [
  ['身份证号脱敏', 'id_card|身份证号', '掩码', '静态', '对外共享、报表导出', '启用', '110101199003124567', '110101********4567'],
  ['手机号脱敏', 'phone|mobile|手机号', '掩码', '静态', '数据共享、工单展示', '启用', '13812345678', '138****5678'],
  ['姓名脱敏', 'real_name|name|姓名', '掩码', '动态', '分析报表、审计视图', '启用', '张建国', '张**'],
  ['银行卡号脱敏', 'bank_card|银行卡号', '掩码', '静态', '对外提供、数据导出', '启用', '6222021234567890123', '***************0123'],
  ['地址泛化', 'address|地址', '泛化', '动态', '统计分析、热力图', '启用', '北京市海淀区中关村大街 27 号', '北京市海淀区'],
  ['邮箱部分遮蔽', 'email|邮箱', '掩码', '静态', '通知与工单展示', '停用', 'zhangjianguo@datasec.gov.cn', 'z***@datasec.gov.cn'],
  ['生物特征哈希', 'face_feature|fingerprint', '哈希', '静态', '身份核验、特征比对', '启用', '人脸特征向量 512 维', 'SHA-256 加盐哈希值'],
  ['医疗诊断遮蔽', 'diagnosis|诊断结论', '加密', '动态', '科研数据共享', '启用', '2 型糖尿病伴并发症', '诊断信息已脱敏'],
  ['动态脱敏策略', 'sensitive_fields', '掩码', '动态', '按角色动态展示原始值', '启用', '按角色展示', '按角色判定'],
  ['测试数据仿真', 'production_copy', '泛化', '静态', '测试环境数据准备', '启用', '生产数据副本', '仿真数据'],
];

export async function seedCompliance(conn, ref, assets, users) {
  const rng = createRng(20261108);
  const ruleIds = [];
  for (const [code, title, basis, category, requirement, level, method] of RULES) {
    const [r] = await conn.query(
      'INSERT INTO compliance_rule (rule_code, rule_title, basis, category, requirement, risk_level, check_method, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [code, title, basis, category, requirement, level, method, '启用', fmtDateTime(daysAgo(randInt(rng, 30, 200)))],
    );
    ruleIds.push(r.insertId);
  }

  // 近 5 周、每周一批检查，每批覆盖全部 20 条规则
  const batches = [];
  for (let b = 4; b >= 0; b -= 1) {
    const d = daysAgo(b * 7, 3, 10);
    batches.push({ no: `CHK-2026-${String(5 - b).padStart(3, '0')}`, date: d });
  }
  const failedChecks = [];
  for (let bi = 0; bi < batches.length; bi += 1) {
    const batch = batches[bi];
    const failIdx = new Set([(bi * 3) % 20, (bi * 3 + 5) % 20, (bi * 3 + 11) % 20]);
    const warnIdx = new Set([(bi * 3 + 2) % 20, (bi * 3 + 8) % 20, (bi * 3 + 15) % 20]);
    for (let i = 0; i < RULES.length; i += 1) {
      const rule = RULES[i];
      const result = failIdx.has(i) ? '不通过' : warnIdx.has(i) ? '警告' : '通过';
      const issue = result === '通过' ? null : pick(rng, FAIL_ISSUES);
      const score = result === '通过' ? 100 : result === '警告' ? randInt(rng, 70, 89) : randInt(rng, 40, 69);
      const [r] = await conn.query(
        'INSERT INTO compliance_check (rule_id, batch_no, target, result, score, evidence, duration_ms, checked_at) VALUES (?,?,?,?,?,?,?,?)',
        [ruleIds[i], batch.no, issue ? issue[1] : pick(rng, ['数据资产台账', '共享交换平台', '统一身份认证', '审计日志库', '备份系统']), result, score,
          issue ? issue[0] : '检查项符合合规要求，未发现违规情况', randInt(rng, 120, 2400), fmtDateTime(batch.date)],
      );
      if (result !== '通过') failedChecks.push({ id: r.insertId, ruleTitle: rule[1], level: rule[5], checkedAt: batch.date, deptId: ref.deptIdByCode[pick(rng, ['D001', 'D002', 'D003', 'D005'])] });
    }
  }

  // 整改单：由不通过项生成，部分闭环、部分逾期
  let seq = 0;
  for (const f of failedChecks.slice(0, 22)) {
    seq += 1;
    const created = plusDays(f.checkedAt, 1);
    const deadline = plusDays(created, 15);
    const overdue = deadline < new Date('2026-11-07') && rng() > 0.6;
    const closed = !overdue && rng() > 0.4;
    const status = closed ? '已闭环' : overdue ? '已逾期' : rng() > 0.5 ? '整改中' : '待整改';
    const progress = closed ? 100 : status === '整改中' ? randInt(rng, 30, 80) : status === '已逾期' ? randInt(rng, 10, 60) : 0;
    await conn.query(
      'INSERT INTO compliance_rectify (rectify_no, check_id, title, owner, dept_id, due_date, status, progress, measure, closed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [`ZG-2026-${String(seq).padStart(3, '0')}`, f.id, `${f.ruleTitle}整改`, cnName(rng), f.deptId, fmtDate(deadline), status, progress,
        '补充分类分级标识、完善脱敏策略、调整权限配置并复核', closed ? fmtDateTime(plusDays(created, randInt(rng, 2, 12))) : null, fmtDateTime(created)],
    );
  }

  for (const [name, pattern, algorithm, maskType, scene, status, before, after] of MASKING_RULES) {
    await conn.query(
      'INSERT INTO masking_rule (rule_name, field_pattern, algorithm, mask_type, scene, status, sample_before, sample_after) VALUES (?,?,?,?,?,?,?,?)',
      [name, pattern, algorithm, maskType, scene, status, before, after],
    );
  }

  const purposes = ['政务数据共享交换', '业务统计分析', '联合监管执法', '科研数据分析', '公共服务能力提升', '跨部门业务协同', '城市运行态势分析'];
  const receivers = ['省政务服务局', '市大数据局', '市统计局', '市卫生健康委', '第三方科研机构', '区县政务服务中心', '市交通运输局'];
  const applicants = users.slice(0, 8);
  for (let i = 0; i < 18; i += 1) {
    const asset = pick(rng, assets);
    const applicant = pick(rng, applicants);
    const status = i < 5 ? '待审批' : pick(rng, ['已通过', '已通过', '已通过', '已驳回', '已撤回']);
    const applyAt = daysAgo(randInt(rng, 0, 25), randInt(rng, 9, 18), randInt(rng, 0, 59));
    await conn.query(
      `INSERT INTO share_approval (approval_no, asset_id, applicant_id, applicant_name, receiver, purpose, share_way, risk_level, status, approver, approved_at, comment, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`SQ-2026-${String(i + 1).padStart(3, '0')}`, asset.id, applicant.id, applicant.realName, pick(rng, receivers), pick(rng, purposes),
        pick(rng, ['接口', '文件', '数据库直连']), pick(rng, ['低', '中', '中', '高']), status,
        status.startsWith('已') && status !== '已撤回' ? '王慧敏' : null,
        status.startsWith('已') && status !== '已撤回' ? fmtDateTime(plusDays(applyAt, randInt(rng, 0, 3))) : null,
        status === '已通过' ? '材料齐全，用途合规，同意共享并落实脱敏要求' : status === '已驳回' ? '用途说明不充分，请补充材料后重新提交' : null,
        fmtDateTime(applyAt)],
    );
  }

  return { ruleIds };
}
