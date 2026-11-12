import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  port: num('PORT', 8081),
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: num('DB_PORT', 13306),
    user: process.env.DB_USER ?? 'datasec',
    password: process.env.DB_PASSWORD ?? 'DataSec_2026',
    database: process.env.DB_NAME ?? 'datasec',
  },
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: num('REDIS_PORT', 16379),
    password: process.env.REDIS_PASSWORD ?? 'DataSec_2026',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'datasec-secret-2026',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  },
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5174',
  platformName: '大数据安全治理与服务保障平台',
  version: 'V1.0.0',
};
