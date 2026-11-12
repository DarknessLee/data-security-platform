import Redis from 'ioredis';
import { config } from '../config/env.ts';

/** Redis 用于：登录会话缓存、失败计数锁定、看板数据缓存、在线用户数 */
export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  lazyConnect: false,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
});

let redisReady = false;
redis.on('ready', () => {
  redisReady = true;
});
redis.on('error', () => {
  redisReady = false;
});

export function isRedisReady(): boolean {
  return redisReady && redis.status === 'ready';
}

/** 带降级的缓存读取：Redis 不可用时直接执行 loader，不阻塞业务 */
export async function cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  if (isRedisReady()) {
    try {
      const hit = await redis.get(key);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      /* 降级 */
    }
  }
  const value = await loader();
  if (isRedisReady()) {
    try {
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* 降级 */
    }
  }
  return value;
}

export async function invalidate(pattern: string): Promise<void> {
  if (!isRedisReady()) return;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    /* 降级 */
  }
}
