#!/usr/bin/env node
/**
 * 交付截图：登录页 + 22 个业务页面（1440×900，全页）。
 * 前置：API（8081）与 Web（5174）均已启动。
 * 输出：docs/screenshots/*.png，末行 RESULT=PASS|FAIL count=N
 */
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/screenshots');
const BASE = process.env.WEB_BASE ?? 'http://127.0.0.1:5174';
const API = process.env.API_BASE ?? 'http://127.0.0.1:8081/api';

const PAGES = [
  ['02-dashboard', '/dashboard'],
  ['03-asset-list', '/asset/list'],
  ['04-asset-categories', '/asset/categories'],
  ['05-asset-lifecycle', '/asset/lifecycle'],
  ['06-compliance-rules', '/compliance/rules'],
  ['07-compliance-checks', '/compliance/checks'],
  ['08-compliance-rectify', '/compliance/rectify'],
  ['09-compliance-masking', '/compliance/masking'],
  ['10-compliance-approvals', '/compliance/approvals'],
  ['11-compliance-report', '/compliance/report'],
  ['12-risk-events', '/risk/events'],
  ['13-risk-rules', '/risk/rules'],
  ['14-risk-realtime', '/risk/realtime'],
  ['15-rbac-users', '/rbac/users'],
  ['16-rbac-roles', '/rbac/roles'],
  ['17-rbac-menus', '/rbac/menus'],
  ['18-rbac-apis', '/rbac/apis'],
  ['19-audit-logs', '/audit/logs'],
  ['20-audit-reports', '/audit/reports'],
  ['21-ops-monitor', '/ops/monitor'],
  ['22-ops-tickets', '/ops/tickets'],
  ['23-ops-backups', '/ops/backups'],
  ['24-ops-configs', '/ops/configs'],
  ['25-ops-versions', '/ops/versions'],
];

async function waitFor(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // 服务尚未就绪
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!(await waitFor(`${API}/health`))) {
    console.error('[screenshots] API 未就绪，请先执行 npm run dev');
    console.log('RESULT=FAIL count=0');
    process.exit(1);
  }
  if (!(await waitFor(BASE))) {
    console.error('[screenshots] Web 未就绪，请先执行 npm run dev');
    console.log('RESULT=FAIL count=0');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/favicon|DevTools|Download the Vue Devtools/i.test(text)) return;
    consoleErrors.push(`${page.url()} :: ${text}`);
  });
  page.on('pageerror', (err) => consoleErrors.push(`${page.url()} :: ${err.message}`));

  let count = 0;
  const failed = [];

  async function shoot(name) {
    const file = resolve(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    if (existsSync(file)) count += 1;
  }

  // 登录页
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await shoot('01-login');
  console.log(`[screenshots] 01-login`);

  // 登录
  await page.fill('input[placeholder="请输入用户名"]', 'admin');
  await page.fill('input[placeholder="请输入登录密码"]', 'Admin@2026');
  await page.click('button:has-text("登 录"), button:has-text("登录")');
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  for (const [name, path] of PAGES) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 30_000 });
      // 等待主要数据渲染：表格出现数据行，或图表容器出现绘制画布
      await Promise.race([
        page.waitForSelector('.el-table__row', { timeout: 8_000 }).catch(() => null),
        page.waitForSelector('canvas', { timeout: 8_000 }).catch(() => null),
      ]);
      await page.waitForTimeout(1200);
      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes('页面建设中')) {
        failed.push(`${name} 仍为占位页`);
      }
      await shoot(name);
      console.log(`[screenshots] ${name}`);
    } catch (err) {
      failed.push(`${name} 截图失败：${err.message}`);
      console.log(`FAIL ${name} ${err.message}`);
    }
  }

  await browser.close();

  if (consoleErrors.length) {
    console.error('[screenshots] 页面控制台错误：');
    for (const line of consoleErrors.slice(0, 20)) console.error(`  - ${line}`);
  }
  if (failed.length) {
    for (const line of failed) console.log(`FAIL ${line}`);
  }
  const ok = count >= PAGES.length + 1;
  console.log(`RESULT=${ok ? 'PASS' : 'FAIL'} count=${count}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[screenshots] 执行异常：', err);
  console.log('RESULT=FAIL count=0');
  process.exit(1);
});
