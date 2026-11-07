import { Router } from 'express';
import { query, queryOne } from '../../db/pool.ts';
import { cached } from '../../db/redis.ts';
import { ok } from '../../lib/http.ts';
import { fmtDateTime } from '../../lib/time.ts';
import { authenticate, currentUser } from '../../middleware/auth.ts';

export const dashboardRouter = Router();

interface LevelRow { data_level: string; c: number }

async function loadOverview(
  userId: number,
  plainScope: string,
  aliasedScope: string,
  scopeParams: unknown[],
): Promise<Record<string, unknown>> {
  const totalAssets = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM data_asset');
  const sensitive = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM data_asset WHERE data_level IN ('机密','绝密')");
  const openRisk = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM risk_event WHERE status IN ('待处置','处置中') ${plainScope}`,
    scopeParams,
  );
  const urgentRisk = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM risk_event WHERE level IN ('高','紧急') AND status IN ('待处置','处置中') ${plainScope}`,
    scopeParams,
  );
  const pendingTickets = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM service_ticket WHERE status IN ('待受理','处理中','待验证')");
  const openRectify = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM compliance_rectify WHERE status IN ('待整改','整改中','已逾期')");
  const todayLogs = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM audit_log WHERE DATE(created_at) = CURDATE()');
  const onlineUsers = await queryOne<{ c: number }>(
    `SELECT COUNT(DISTINCT user_id) AS c FROM audit_log WHERE log_type = '登录日志' AND result = '成功' AND created_at >= DATE_SUB(NOW(), INTERVAL 12 HOUR)`,
  );

  const latestBatch = await queryOne<{ batch_no: string }>(
    'SELECT batch_no FROM compliance_check ORDER BY checked_at DESC LIMIT 1',
  );
  const batchStat = latestBatch
    ? await queryOne<{ total: number; passed: number }>(
      "SELECT COUNT(*) AS total, SUM(result = '通过') AS passed FROM compliance_check WHERE batch_no = ?",
      [latestBatch.batch_no],
    )
    : null;
  const complianceRate = batchStat && Number(batchStat.total) > 0
    ? Math.round((Number(batchStat.passed) / Number(batchStat.total)) * 1000) / 10
    : 0;

  const levels = await query<LevelRow>('SELECT data_level, COUNT(*) AS c FROM data_asset GROUP BY data_level');
  const levelOrder = ['公开', '内部', '机密', '绝密'];
  const assetLevel = levelOrder.map((level) => ({
    name: level,
    value: Number(levels.find((l) => l.data_level === level)?.c ?? 0),
  }));

  const stages = await query<{ lifecycle_stage: string; c: number }>('SELECT lifecycle_stage, COUNT(*) AS c FROM data_asset GROUP BY lifecycle_stage');
  const stageOrder = ['采集', '存储', '使用', '共享', '销毁'];
  const assetStage = stageOrder.map((s) => ({ name: s, value: Number(stages.find((x) => x.lifecycle_stage === s)?.c ?? 0) }));

  const riskLevel = await query<{ level: string; c: number }>(
    `SELECT level, COUNT(*) AS c FROM risk_event WHERE 1 = 1 ${plainScope} GROUP BY level`,
    scopeParams,
  );
  const riskLevelDist = ['低', '中', '高', '紧急'].map((level) => ({
    name: level,
    value: Number(riskLevel.find((r) => r.level === level)?.c ?? 0),
  }));

  const trendRows = await query<{ d: string; total: number; high: number }>(
    `SELECT DATE_FORMAT(occurred_at, '%Y-%m-%d') AS d, COUNT(*) AS total, SUM(level IN ('高','紧急')) AS high
       FROM risk_event WHERE occurred_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) ${plainScope}
      GROUP BY DATE_FORMAT(occurred_at, '%Y-%m-%d') ORDER BY d`,
    scopeParams,
  );
  const riskTrend: Array<{ date: string; total: number; high: number }> = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hit = trendRows.find((r) => r.d === key);
    riskTrend.push({ date: key.slice(5), total: Number(hit?.total ?? 0), high: Number(hit?.high ?? 0) });
  }

  const batches = await query<{ batch_no: string; checked_at: string; total: number; passed: number }>(
    `SELECT batch_no, MAX(checked_at) AS checked_at, COUNT(*) AS total, SUM(result = '通过') AS passed
       FROM compliance_check GROUP BY batch_no ORDER BY MAX(checked_at) DESC LIMIT 5`,
  );
  const complianceTrend = batches.reverse().map((b) => ({
    batch: b.batch_no.replace('CHK-2026-', '第') + '批',
    rate: Number(b.total) > 0 ? Math.round((Number(b.passed) / Number(b.total)) * 1000) / 10 : 0,
  }));

  const recentEvents = await query(
    `SELECT e.id, e.event_no, e.event_type, e.level, e.status, e.username, e.ip, e.occurred_at,
            a.asset_name
       FROM risk_event e LEFT JOIN data_asset a ON a.id = e.asset_id
      WHERE 1 = 1 ${aliasedScope}
      ORDER BY FIELD(e.level, '紧急', '高', '中', '低'), e.occurred_at DESC LIMIT 6`,
    scopeParams,
  );

  const ticketStat = await query<{ status: string; c: number }>('SELECT status, COUNT(*) AS c FROM service_ticket GROUP BY status');
  const ticketByStatus = ['待受理', '处理中', '待验证', '已关闭'].map((s) => ({
    name: s,
    value: Number(ticketStat.find((t) => t.status === s)?.c ?? 0),
  }));

  const opsLatest = await queryOne('SELECT * FROM ops_metric ORDER BY metric_time DESC LIMIT 1');
  const opsSeries = await query<{ metric_time: string; cpu_usage: string; mem_usage: string; api_qps: number }>(
    `SELECT metric_time, cpu_usage, mem_usage, api_qps FROM ops_metric
      WHERE metric_time >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY metric_time`,
  );

  const notices = await query(
    `SELECT id, title, content, level, read_flag, created_at FROM notification
      WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC LIMIT 5`,
    [userId],
  );

  return {
    cards: {
      totalAssets: Number(totalAssets?.c ?? 0),
      sensitiveAssets: Number(sensitive?.c ?? 0),
      openRisk: Number(openRisk?.c ?? 0),
      urgentRisk: Number(urgentRisk?.c ?? 0),
      pendingTickets: Number(pendingTickets?.c ?? 0),
      openRectify: Number(openRectify?.c ?? 0),
      todayLogs: Number(todayLogs?.c ?? 0),
      onlineUsers: Number(onlineUsers?.c ?? 0),
      complianceRate,
      latestBatchNo: latestBatch?.batch_no ?? null,
    },
    assetLevel,
    assetStage,
    riskLevel: riskLevelDist,
    riskTrend,
    complianceTrend,
    recentEvents,
    ticketByStatus,
    opsLatest,
    opsSeries: opsSeries.map((m) => ({
      time: fmtDateTime(new Date(m.metric_time)),
      cpu: Number(m.cpu_usage),
      mem: Number(m.mem_usage),
      qps: Number(m.api_qps),
    })),
    notices,
    generatedAt: fmtDateTime(new Date()),
  };
}

/** 运营看板总览（Redis 缓存 20 秒） */
dashboardRouter.get('/overview', authenticate, async (req, res) => {
  const user = currentUser(req);
  const scoped = !(user.roleCodes.includes('SUPER_ADMIN') || user.dataScope === 'ALL');
  const bySelf = scoped && user.dataScope === 'SELF';
  // 注意：risk_event 的独立查询没有表别名，join 查询用 e. 前缀，两者必须分开拼，否则会报 Unknown column 'e.dept_id'
  const plainScope = !scoped ? '' : bySelf ? 'AND username = ?' : 'AND dept_id = ?';
  const aliasedScope = !scoped ? '' : bySelf ? 'AND e.username = ?' : 'AND e.dept_id = ?';
  const scopeParams: unknown[] = !scoped ? [] : [bySelf ? user.username : user.deptId];
  const cacheKey = !scoped ? 'all' : bySelf ? `self-${user.username}` : `dept-${user.deptId}`;
  const data = await cached(`dashboard:overview:${cacheKey}`, 20, () => loadOverview(user.id, plainScope, aliasedScope, scopeParams));
  ok(res, data);
});
