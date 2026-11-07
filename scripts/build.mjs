#!/usr/bin/env node
/**
 * 全仓构建门禁：api `tsc --noEmit` + web `vue-tsc --noEmit && vite build`。
 * Windows 下 vite/esbuild 在默认 %TEMP% 下偶发 "Access is denied"（临时文件被占用/杀软拦截），
 * 因此统一把 TMP/TEMP 指向工作区 .runtime/tmp-build，避免门禁被环境问题误判。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = path.join(root, '.runtime', 'tmp-build');
fs.mkdirSync(tmpDir, { recursive: true });

const env = { ...process.env, TMP: tmpDir, TEMP: tmpDir };

function run(label, script, args) {
  process.stdout.write(`\n[build] ${label} ...\n`);
  const started = Date.now();
  // Windows 下 npm 是 .cmd，需要 shell
  const result = spawnSync('npm', ['run', script, ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status !== 0) {
    process.stdout.write(`[build] ${label} FAILED exit=${result.status} 用时=${seconds}s\n`);
    return false;
  }
  process.stdout.write(`[build] ${label} OK 用时=${seconds}s\n`);
  return true;
}

const okApi = run('API (tsc)', 'build', ['-w', 'api']);
const okWeb = okApi && run('Web (vue-tsc + vite)', 'build', ['-w', 'web']);

if (okApi && okWeb) {
  process.stdout.write('\nRESULT=PASS 用时=见上\n');
  process.exit(0);
}
process.stdout.write('\nRESULT=FAIL\n');
process.exit(1);
