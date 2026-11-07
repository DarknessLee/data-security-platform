#!/usr/bin/env node
/**
 * 环境准备：依赖安装 → Docker 依赖启动 → 数据库初始化 → 数据校验。
 * 用法：npm run setup
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

function sh(cmd, args, opts = {}) {
  console.log(`\n[setup] ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: isWin, ...opts });
  return result.status ?? 1;
}

function main() {
  if (!spawnSync('node', ['-v'], { encoding: 'utf8' }).stdout) {
    console.error('[setup] 未找到 Node.js，请先安装 Node.js 20+');
    process.exit(1);
  }

  console.log('[setup] 1/4 安装依赖（npm workspaces）...');
  if (sh('npm', ['install']) !== 0) process.exit(1);

  console.log('[setup] 2/4 启动 Docker 依赖（MySQL 13306 / Redis 16379）...');
  if (sh('node', [resolve(ROOT, 'scripts/docker.mjs'), 'up']) !== 0) process.exit(1);

  console.log('[setup] 3/4 初始化数据库结构与演示数据...');
  if (sh('node', [resolve(ROOT, 'api/db/init.mjs')]) !== 0) process.exit(1);

  console.log('[setup] 4/4 校验演示数据...');
  if (sh('node', [resolve(ROOT, 'api/db/validate.mjs')]) !== 0) process.exit(1);

  console.log('\n[setup] 环境准备完成。执行 npm run dev 启动平台，访问 http://127.0.0.1:5174');
}

main();
