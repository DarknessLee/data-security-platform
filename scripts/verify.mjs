#!/usr/bin/env node
/**
 * 全量门禁：docker → db:init → db:validate → build → test:api → test:e2e → check:docs
 * 用法：node scripts/verify.mjs [--skip-e2e] [--skip-docker]
 * 末行固定输出 RESULT=PASS|FAIL passed=N failed=M 用时=S
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const started = Date.now();
const results = [];

const STEPS = [
  { key: 'docker:up', label: '容器启动', cmd: 'node', argv: ['scripts/docker.mjs', 'up'], skip: args.has('--skip-docker') },
  { key: 'db:init', label: '数据库初始化（可重放种子）', cmd: 'node', argv: ['api/db/init.mjs'] },
  { key: 'db:validate', label: '数据契约校验', cmd: 'node', argv: ['api/db/validate.mjs'] },
  { key: 'build', label: '编译构建（API tsc + Web vue-tsc/vite）', cmd: 'npm', argv: ['run', 'build'], shell: true },
  { key: 'test:api', label: 'API 门禁', cmd: 'node', argv: ['scripts/test-api.mjs'] },
  { key: 'test:e2e', label: 'E2E 门禁', cmd: 'npx', argv: ['playwright', 'test', '-c', 'web/playwright.config.ts'], shell: true, skip: args.has('--skip-e2e') },
  { key: 'check:docs', label: '文档门禁', cmd: 'node', argv: ['scripts/check-docs.mjs'] },
];

function runStep(step) {
  if (step.skip) {
    results.push({ key: step.key, label: step.label, status: 'SKIP', detail: '按参数跳过' });
    console.log(`SKIP ${step.label}`);
    return;
  }
  console.log(`\n▶ ${step.label}`);
  const tail = [];
  const res = spawnSync(step.cmd, step.argv, {
    cwd: ROOT,
    shell: step.shell ?? false,
    env: { ...process.env, TEMP: resolve(ROOT, '.runtime/tmp'), TMP: resolve(ROOT, '.runtime/tmp') },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
  });
  const output = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const lines = output.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    if (line.startsWith('PASS ') || line.startsWith('FAIL ') || line.startsWith('RESULT=') || line.startsWith('▶') || line.startsWith('✓')) {
      console.log(line);
    }
    tail.push(line);
    if (tail.length > 40) tail.shift();
  }
  const resultLine = lines.filter((l) => l.startsWith('RESULT=')).pop();
  const passed = res.status === 0 && resultLine && !resultLine.startsWith('RESULT=FAIL');
  results.push({ key: step.key, label: step.label, status: passed ? 'PASS' : 'FAIL', detail: resultLine ?? `exit=${res.status} ${tail.slice(-3).join(' | ')}` });
  if (!passed) {
    console.log(`FAIL ${step.label} ${resultLine ?? `exit=${res.status}`}`);
    console.log(tail.slice(-12).join('\n'));
  } else {
    console.log(`PASS ${step.label} ${resultLine ?? ''}`);
  }
}

for (const step of STEPS) {
  runStep(step);
  if (step.key === 'db:validate' && results.at(-1).status === 'FAIL') {
    console.log('数据基线校验失败，后续门禁跳过');
    break;
  }
}

const passed = results.filter((r) => r.status === 'PASS').length;
const failed = results.filter((r) => r.status === 'FAIL').length;
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log('\n=== 门禁汇总 ===');
for (const r of results) console.log(`${r.status.padEnd(4)} ${r.label}  ${r.detail}`);
console.log('证据文件：.runtime/ 与 docs/screenshots/');
if (failed === 0) {
  console.log(`RESULT=PASS passed=${passed} failed=0 用时=${seconds}s`);
  process.exit(0);
} else {
  console.log(`RESULT=FAIL passed=${passed} failed=${failed} 用时=${seconds}s`);
  process.exit(1);
}
