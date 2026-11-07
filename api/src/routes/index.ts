import { Router } from 'express';
import { config } from '../config/env.ts';
import { ping, queryOne } from '../db/pool.ts';
import { isRedisReady } from '../db/redis.ts';
import { ok } from '../lib/http.ts';
import { fmtDateTime } from '../lib/time.ts';
import { authenticate, requirePerm } from '../middleware/auth.ts';
import { authRouter } from '../modules/auth/router.ts';
import { dashboardRouter } from '../modules/dashboard/router.ts';
import { assetsRouter } from '../modules/assets/router.ts';
import { complianceRouter } from '../modules/compliance/router.ts';
import { riskRouter } from '../modules/risk/router.ts';
import { rbacRouter } from '../modules/rbac/router.ts';
import { auditRouter } from '../modules/audit/router.ts';
import { opsRouter } from '../modules/ops/router.ts';

export const apiRouter = Router();

apiRouter.get('/health', async (_req, res) => {
  const dbOk = await ping();
  const redisOk = isRedisReady();
  const assetCount = dbOk ? await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM data_asset') : null;
  ok(res, {
    status: dbOk && redisOk ? 'UP' : 'DEGRADED',
    platform: config.platformName,
    version: config.version,
    mysql: dbOk ? 'UP' : 'DOWN',
    redis: redisOk ? 'UP' : 'DOWN',
    assetCount: Number(assetCount?.c ?? 0),
    time: fmtDateTime(new Date()),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

apiRouter.get('/meta', authenticate, async (_req, res) => {
  ok(res, {
    platform: config.platformName,
    version: config.version,
    modules: [
      { code: 'dashboard', name: '安全运营看板' },
      { code: 'asset', name: '数据资产治理' },
      { code: 'compliance', name: '安全合规管理' },
      { code: 'risk', name: '智能风险监测' },
      { code: 'rbac', name: '权限安全管控' },
      { code: 'audit', name: '安全审计追溯' },
      { code: 'ops', name: '服务保障运维' },
    ],
    permissions: ['read', 'write'],
    dataScopes: ['ALL', 'DEPT', 'SELF', 'CUSTOM'],
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/dashboard', authenticate, requirePerm('dashboard'), dashboardRouter);
apiRouter.use('/assets', assetsRouter);
apiRouter.use('/compliance', complianceRouter);
apiRouter.use('/risk', riskRouter);
apiRouter.use('/rbac', rbacRouter);
apiRouter.use('/audit', auditRouter);
apiRouter.use('/ops', opsRouter);


