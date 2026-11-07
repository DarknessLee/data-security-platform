// 服务保障运维种子：运维工单（含轨迹）、备份记录、监控指标
import { createRng, pick, randInt, fmtDateTime, fmtDate, daysAgo, hoursAgo, plusDays, BASE_TIME } from './lib.mjs';

const TICKETS = [
  ['报表导出超时', '故障处理', '高', '数据资产台账页面导出 5 万条记录时请求超时，前端等待 30 秒后报错。', 8],
  ['风险事件列表加载缓慢', '故障处理', '中', '风险事件列表在筛选“近 30 天”后加载时间超过 8 秒。', 24],
  ['用户无法登录平台', '故障处理', '紧急', '安全合规部 3 名用户反馈登录提示“账号已锁定”，但未连续输错密码。', 2],
  ['新增数据资产分类申请', '变更申请', '低', '申请新增“车联网数据”一级分类，用于新接入的车联网数据资产登记。', 48],
  ['共享审批流程节点调整', '变更申请', '中', '申请在共享审批流程中增加“数据安全责任人复核”节点。', 72],
  ['审计日志导出格式异常', '故障处理', '中', '导出的 CSV 文件中中文列名出现乱码，需确认编码规范。', 24],
  ['数据库连接数告警', '故障处理', '高', '主库连接数持续高于 180，触发平台告警，需排查慢查询与连接泄漏。', 4],
  ['脱敏规则未生效', '安全事件', '高', '对外接口返回结果中手机号未按规则脱敏，疑似规则匹配失败。', 4],
  ['监控指标缺失告警', '故障处理', '中', '凌晨 02:00-04:00 监控指标出现断点，需确认采集任务是否正常。', 12],
  ['平台访问白名单配置咨询', '服务咨询', '低', '技术研发部咨询如何申请将办公网段加入平台登录 IP 白名单。', 48],
  ['备份恢复演练申请', '变更申请', '中', '计划在本月开展一次生产库备份恢复演练，申请停机窗口 30 分钟。', 72],
  ['角色权限批量调整', '变更申请', '中', '业务运营部 6 名人员岗位调整，需批量变更角色与数据权限范围。', 24],
  ['风险事件处置记录丢失', '安全事件', '高', '部分已处置风险事件的处置说明为空，需核查审计日志确认原因。', 8],
  ['接口调用频率超限', '故障处理', '中', '开放接口 /api/open/data/query 触发限流，第三方调用方需确认配额。', 24],
  ['平台首页加载 502', '故障处理', '紧急', '上午 09:20 起平台首页间歇性返回 502，影响约 5 分钟。', 1],
  ['日志归档策略调整', '变更申请', '低', '申请将审计日志留存周期由 180 天调整为 365 天。', 96],
  ['工单处理时效统计需求', '服务咨询', '低', '运维保障部希望增加工单 SLA 达标率的统计视图。', 72],
  ['数据库慢查询优化', '故障处理', '高', '资产台账关联查询平均耗时 1.8 秒，需优化索引与查询语句。', 12],
  ['安全基线检查配置', '变更申请', '中', '申请启用等保 2.0 三级安全基线检查项，覆盖 42 个检查点。', 72],
  ['第三方数据接入安全评估', '安全事件', '中', '新增第三方数据源接入，需完成数据安全评估并签署协议。', 24],
  ['监控大屏数据刷新异常', '故障处理', '低', '运行监控大屏数据每 30 秒刷新一次，偶发刷新后图表空白。', 48],
  ['平台版本升级回滚咨询', '服务咨询', '中', '咨询 V1.0.0 版本升级失败时的回滚步骤与数据兼容性影响。', 48],
];

const STATUS_FLOW = {
  待受理: ['创建'],
  处理中: ['创建', '受理', '处理'],
  待验证: ['创建', '受理', '处理', '验证'],
  已关闭: ['创建', '受理', '处理', '验证', '关闭'],
};

export async function seedOps(conn, ref, users) {
  const rng = createRng(20261111);
  const opsUser = users.find((u) => u.username === 'ops') || users[0];
  const assignees = ['刘文博', '李志强', '赵晓东'];

  for (let i = 0; i < TICKETS.length; i += 1) {
    const [title, category, priority, description, sla] = TICKETS[i];
    const created = hoursAgo(randInt(rng, 3, 24 * 18));
    const status = i < 3 ? '待受理' : i < 7 ? '处理中' : i < 9 ? '待验证' : '已关闭';
    const reporter = pick(rng, users.slice(0, 8)).realName;
    const assignee = status === '待受理' ? null : pick(rng, assignees);
    const acceptedAt = status === '待受理' ? null : fmtDateTime(new Date(created.getTime() + randInt(rng, 5, 120) * 60000));
    const closedAt = status === '已关闭' ? fmtDateTime(new Date(created.getTime() + randInt(rng, 6, 96) * 3600000)) : null;
    const ticketNo = `TK-${fmtDate(created).replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`;
    const [r] = await conn.query(
      `INSERT INTO service_ticket (ticket_no, title, category, priority, status, reporter, assignee, contact, description, resolution, sla_hours, created_at, accepted_at, closed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ticketNo, title, category, priority, status, reporter, assignee, `1380001${String(1000 + i).slice(-4)}`, description,
        status === '已关闭' ? pick(rng, ['已完成配置调整并验证通过，问题不再复现', '已优化慢查询并补充索引，接口耗时降至 220ms', '已修复脱敏规则匹配逻辑，全量回归通过']) : null,
        sla, fmtDateTime(created), acceptedAt, closedAt],
    );
    const actions = STATUS_FLOW[status];
    let cursor = created;
    for (const action of actions) {
      await conn.query('INSERT INTO ticket_trace (ticket_id, action, operator, note, created_at) VALUES (?,?,?,?,?)', [
        r.insertId, action,
        action === '创建' ? reporter : action === '关闭' ? reporter : opsUser.realName,
        action === '创建' ? '提交工单并说明故障现象' : action === '受理' ? '已受理，进入处理流程' : action === '处理' ? '已完成初步排查与配置调整' : action === '验证' ? '等待提交人验证处理结果' : '验证通过，工单关闭并归档',
        fmtDateTime(cursor),
      ]);
      cursor = new Date(cursor.getTime() + randInt(rng, 20, 300) * 60000);
    }
  }

  for (let i = 0; i < 14; i += 1) {
    const started = daysAgo(i, 1, 30);
    const full = i % 3 === 0 ? '全量' : '增量';
    const sizeMb = full === '全量' ? randInt(rng, 14000, 22000) : randInt(rng, 800, 3600);
    const failed = i === 6;
    await conn.query(
      'INSERT INTO backup_record (backup_no, backup_type, scope, size_mb, status, storage_path, checksum, started_at, finished_at, operator) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [`BK-${fmtDate(started).replace(/-/g, '')}-${String(i + 1).padStart(2, '0')}`, full, full === '全量' ? '业务库 + 审计库 + 元数据库' : '业务库增量日志', sizeMb,
        failed ? '失败' : '成功', `/data/backup/${fmtDate(started)}/`, failed ? null : `sha256:${randInt(rng, 100000, 999999)}${randInt(rng, 100000, 999999)}`,
        fmtDateTime(started), fmtDateTime(new Date(started.getTime() + randInt(rng, 6, 28) * 60000)), '刘文博'],
    );
  }

  const currentHour = BASE_TIME.getHours();
  for (let day = 6; day >= 0; day -= 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      if (day === 0 && hour > currentHour) continue;
      const d = daysAgo(day, hour, 0);
      const work = hour >= 8 && hour <= 19;
      const cpu = Number((work ? randInt(rng, 38, 68) : randInt(rng, 16, 34)) + rng()).toFixed(2);
      const mem = Number((work ? randInt(rng, 52, 76) : randInt(rng, 42, 58)) + rng()).toFixed(2);
      const disk = Number((68 + (6 - day) * 0.35 + rng()).toFixed(2));
      const qps = work ? randInt(rng, 80, 260) : randInt(rng, 8, 40);
      const avgMs = Number((work ? randInt(rng, 65, 210) : randInt(rng, 32, 90)) + rng()).toFixed(1);
      const conns = work ? randInt(rng, 90, 178) : randInt(rng, 28, 62);
      const hit = Number((95 + rng() * 4.5).toFixed(2));
      const online = work ? randInt(rng, 32, 88) : randInt(rng, 3, 16);
      await conn.query(
        'INSERT INTO ops_metric (metric_time, cpu_usage, mem_usage, disk_usage, api_qps, api_avg_ms, db_connections, redis_hit_rate, online_users) VALUES (?,?,?,?,?,?,?,?,?)',
        [fmtDateTime(d), cpu, mem, disk, qps, Math.round(avgMs), conns, hit, online],
      );
    }
  }

  return {};
}
