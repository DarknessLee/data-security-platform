import { createApp } from './app.ts';
import { config } from './config/env.ts';
import { ping } from './db/pool.ts';
import { isRedisReady } from './db/redis.ts';

async function bootstrap(): Promise<void> {
  const app = createApp();
  const dbOk = await ping();
  console.log(`[api] MySQL ${config.db.host}:${config.db.port}/${config.db.database} ${dbOk ? '已连接' : '连接失败'}`);
  console.log(`[api] Redis ${config.redis.host}:${config.redis.port} ${isRedisReady() ? '已连接' : '未就绪（自动降级）'}`);

  const server = app.listen(config.port, () => {
    console.log(`[api] ${config.platformName} ${config.version} 已启动: http://127.0.0.1:${config.port}/api/health`);
  });

  const shutdown = (signal: string) => {
    console.log(`[api] 收到 ${signal}，正在优雅关闭...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[api] 启动失败:', err);
  process.exit(1);
});
