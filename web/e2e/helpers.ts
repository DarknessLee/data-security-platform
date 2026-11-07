import { expect, type Page } from '@playwright/test';

export interface Credentials {
  username: string;
  password: string;
}

export const ACCOUNTS = {
  admin: { username: 'admin', password: 'Admin@2026' },
  secadmin: { username: 'secadmin', password: 'Sec@2026' },
  compliance: { username: 'compliance', password: 'Comp@2026' },
  steward: { username: 'steward', password: 'Steward@2026' },
  auditor: { username: 'auditor', password: 'Audit@2026' },
  ops: { username: 'ops', password: 'Ops@2026' },
  depthead: { username: 'depthead', password: 'Dept@2026' },
  analyst: { username: 'analyst', password: 'Analyst@2026' },
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

const consoleErrors = new WeakMap<Page, string[]>();

/** 汇总页面 console 错误与未捕获异常，供用例断言 */
export function expectNoConsoleError(page: Page): void {
  const errors = consoleErrors.get(page);
  expect(errors ?? [], `页面存在 console 错误: ${(errors ?? []).join(' | ')}`).toEqual([]);
}

function watchConsole(page: Page): void {
  if (consoleErrors.has(page)) return;
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // 忽略浏览器扩展/网络层噪音，只关注应用内错误
      if (text.includes('favicon') || text.includes('DevTools')) return;
      errors.push(text);
    }
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
}

/** 登录并等待进入平台首页 */
export async function loginAs(page: Page, account: AccountKey | Credentials = 'admin'): Promise<void> {
  watchConsole(page);
  const creds = typeof account === 'string' ? ACCOUNTS[account] : account;
  await page.goto('/login');
  await page.getByPlaceholder('请输入用户名').fill(creds.username);
  await page.getByPlaceholder('请输入登录密码').fill(creds.password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}

/** 通过路由直达某个模块页并等待主要区域渲染 */
export async function gotoPage(page: Page, path: string, readyText?: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  if (readyText) await expect(page.getByText(readyText, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

/** 等待表格有数据行（默认至少 1 行） */
export async function expectTableRows(page: Page, min = 1): Promise<void> {
  const rows = page.locator('.el-table__body tbody tr');
  await expect.poll(async () => rows.count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(min);
}

/** 安全点击：等待元素可见后点击 */
export async function clickButton(page: Page, name: string | RegExp): Promise<void> {
  const btn = page.getByRole('button', { name }).first();
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
}

/** 断言 Element Plus 成功提示出现 */
export async function expectSuccessToast(page: Page): Promise<void> {
  await expect(page.locator('.el-message--success').first()).toBeVisible({ timeout: 15_000 });
}

/** 记录截图到 docs/screenshots（供交付材料） */
export async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `../docs/screenshots/${name}.png`, fullPage: false });
}
