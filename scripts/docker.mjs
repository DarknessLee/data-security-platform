#!/usr/bin/env node
/**
 * Docker 编排脚本：统一注入 Docker CLI 路径，处理 Windows 下的端口与健康检查。
 * 用法：node scripts/docker.mjs up|down|status|logs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = resolve(ROOT, 'docker-compose.yml');
const DOCKER_CANDIDATES = [
  process.env.DOCKER_PATH,
  'D:\\DevTools\\Docker\\resources\\bin\\docker.exe',
  'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
  'docker',
].filter(Boolean);

function dockerBin() {
  for (const c of DOCKER_CANDIDATES) {
    if (c === 'docker') return c;
    if (existsSync(c)) return c;
  }
  return 'docker';
}

function run(args, opts = {}) {
  const bin = dockerBin();
  console.log(`[docker] ${args.join(' ')}`);
  const result = spawnSync(bin, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  return result.status ?? 1;
}

function compose(args) {
  return run(['compose', '-f', COMPOSE, ...args]);
}

function containerState(name) {
  try {
    const out = execFileSync(dockerBin(), ['inspect', '--format', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', name], {
      encoding: 'utf8',
      cwd: ROOT,
    }).trim();
    const [status, health] = out.split('|');
    return { status, health };
  } catch {
    return { status: 'missing', health: 'none' };
  }
}

async function waitHealthy(timeoutMs = 120_000) {
  const started = Date.now();
  const targets = ['datasec-mysql', 'datasec-redis'];
  while (Date.now() - started < timeoutMs) {
    const states = targets.map((t) => ({ name: t, ...containerState(t) }));
    const ok = states.every((s) => s.status === 'running' && (s.health === 'healthy' || s.health === 'none'));
    if (ok) {
      console.log('[docker] 容器均已就绪: ' + states.map((s) => `${s.name}=${s.status}/${s.health}`).join(', '));
      return true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.error('[docker] 容器健康检查超时');
  return false;
}

const action = process.argv[2] ?? 'up';
if (action === 'up') {
  const code = compose(['up', '-d']);
  if (code !== 0) process.exit(code);
  const healthy = await waitHealthy();
  process.exit(healthy ? 0 : 1);
} else if (action === 'down') {
  process.exit(compose(['down']));
} else if (action === 'status') {
  process.exit(compose(['ps']));
} else if (action === 'logs') {
  process.exit(compose(['logs', '--tail', '80', ...process.argv.slice(3)]));
} else {
  console.error('未知操作：' + action + '（支持 up/down/status/logs）');
  process.exit(2);
}
