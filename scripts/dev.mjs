#!/usr/bin/env node
/**
 * 一键开发环境：检查/启动 Docker 依赖 → 初始化数据 → 并行启动 API(8081) 与 Web(5174)。
 * 用法：npm run dev
 */
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: 'inherit' });
  return result.status ?? 1;
}

async function waitHttp(url, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* 稍后重试 */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

function launch(name, npmArgs) {
  const child = spawn(isWin ? 'npm.cmd' : 'npm', npmArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWin,
  });
  child.on('exit', (code) => {
    if (code !== 0 && !shuttingDown) {
      console.error(`[dev] ${name} 退出，code=${code}`);
    }
  });
  return child;
}

let shuttingDown = false;
const children = [];

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.pid || child.killed) continue;
    if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 500);
}

async function main() {
  console.log('[dev] 1/4 检查 Docker 依赖 ...');
  runNode(resolve(ROOT, 'scripts/docker.mjs'), ['up']);

  console.log('[dev] 2/4 初始化演示数据（可重复执行）...');
  const init = runNode(resolve(ROOT, 'api/db/init.mjs'));
  if (init !== 0) {
    console.error('[dev] 数据初始化失败，请检查 MySQL 容器是否就绪');
    process.exit(1);
  }

  console.log('[dev] 3/4 启动 API（http://127.0.0.1:8081）...');
  children.push(launch('api', ['run', 'dev', '-w', 'api']));

  console.log('[dev] 4/4 启动 Web（http://127.0.0.1:5174）...');
  children.push(launch('web', ['run', 'dev', '-w', 'web']));

  const [apiOk, webOk] = await Promise.all([
    waitHttp('http://127.0.0.1:8081/api/health', 90_000),
    waitHttp('http://127.0.0.1:5174', 90_000),
  ]);
  console.log('');
  console.log('==============================================');
  console.log(`  API 健康检查: ${apiOk ? '通过' : '未通过'}`);
  console.log(`  Web 访问地址: ${webOk ? 'http://127.0.0.1:5174' : '未就绪'}`);
  console.log('  演示账号: admin / Admin@2026');
  console.log('  按 Ctrl+C 停止全部服务');
  console.log('==============================================');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => {
  if (!shuttingDown) shutdown();
});

main().catch((err) => {
  console.error('[dev] 启动失败:', err);
  shutdown();
});
