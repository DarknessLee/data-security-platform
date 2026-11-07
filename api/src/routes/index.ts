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
      { code: 'dashboard', name: '瀹夊叏杩愯惀鐪嬫澘' },
      { code: 'asset', name: '鏁版嵁璧勪骇娌荤悊' },
      { code: 'compliance', name: '瀹夊叏鍚堣绠＄悊' },
      { code: 'risk', name: '鏅鸿兘椋庨櫓鐩戞祴' },
      { code: 'rbac', name: '鏉冮檺瀹夊叏绠℃帶' },
      { code: 'audit', name: '瀹夊叏瀹¤杩芥函' },
      { code: 'ops', name: '鏈嶅姟淇濋殰杩愮淮' },
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


