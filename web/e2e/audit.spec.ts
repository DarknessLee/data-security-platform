import { test, expect } from '@playwright/test';
import {
  clickButton,
  expectNoConsoleError,
  expectSuccessToast,
  expectTableRows,
  gotoPage,
  loginAs,
} from './helpers';

test.describe('安全审计追溯', () => {
  test('审计日志页可访问、无 console 错误且表格有数据', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/audit/logs', '审计日志明细');
    await expectTableRows(page, 1);

    await expect(page.getByText('今日日志量').first()).toBeVisible();
    await expect(page.getByText('哈希链状态').first()).toBeVisible();
    await expect(page.getByText('异常 IP TOP5').first()).toBeVisible();

    await expectNoConsoleError(page);
  });

  test('按日志类型筛选后表格只剩该类型记录', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/audit/logs', '审计日志明细');
    await expectTableRows(page, 1);

    await page.locator('.filter-card .el-select').first().click();
    await page.getByRole('option', { name: '登录日志' }).click();
    await page.waitForLoadState('networkidle');

    const typeCells = page.locator('.el-table__body tbody tr td:nth-child(2)');
    await expect
      .poll(async () => {
        const texts = await typeCells.allInnerTexts();
        return texts.length > 0 && texts.every((text) => text.trim() === '登录日志');
      }, { timeout: 20_000 })
      .toBe(true);

    await expect(page.locator('.filter-card .el-select').first()).toContainText('登录日志');
    await expectNoConsoleError(page);
  });

  test('日志详情抽屉展示 SHA-256 哈希链校验结果', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/audit/logs', '审计日志明细');
    await expectTableRows(page, 1);

    await page.locator('.el-table__body tbody tr').first().getByRole('button', { name: '详情' }).click();

    const drawer = page.locator('.el-drawer').filter({ hasText: '审计日志详情' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('完整性校验通过').first()).toBeVisible();
    await expect(drawer.getByText('SHA-256 链式摘要', { exact: false }).first()).toBeVisible();
    await expect(drawer.getByText('前序摘要 prevHash').first()).toBeVisible();
    await expect(drawer.getByText('当前摘要 hash').first()).toBeVisible();

    // 摘要为 64 位十六进制
    const hashTexts = await drawer.locator('.hash-node code').allInnerTexts();
    expect(hashTexts.length).toBe(2);
    for (const hash of hashTexts) expect(hash.trim()).toMatch(/^[0-9a-f]{64}$/);

    await expectNoConsoleError(page);
  });

  test('完整性校验弹窗返回哈希链完整', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/audit/logs', '审计日志明细');

    await clickButton(page, '完整性校验');
    const dialog = page.locator('.el-dialog').filter({ hasText: '审计日志不可篡改校验' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('哈希链完整，未发现篡改').first()).toBeVisible();
    await expect(dialog.getByText('链头摘要 headHash').first()).toBeVisible();
    await expect(dialog).toContainText('SHA-256 链式校验');

    await expectNoConsoleError(page);
  });

  test('生成审计日报成功并展示报表摘要', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/audit/reports', '报表列表');
    await expectTableRows(page, 1);

    await clickButton(page, '生成报表');
    const dialog = page.locator('.el-dialog').filter({ hasText: '生成审计报表' });
    await expect(dialog).toBeVisible();
    await dialog.locator('label.el-radio').filter({ hasText: '日报' }).first().click();
    await dialog.getByRole('button', { name: '确认生成' }).click();

    await expectSuccessToast(page);
    await expect(page.locator('.el-message--success').first()).toContainText('生成成功');

    const drawer = page.locator('.el-drawer').filter({ hasText: '审计报表详情' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('报表摘要').first()).toBeVisible();
    await expect(drawer.getByText(/审计事件/).first()).toBeVisible();

    await expectNoConsoleError(page);
  });

  test('auditor 只读账号可访问审计日志与审计报表', async ({ page }) => {
    await loginAs(page, 'auditor');

    await gotoPage(page, '/audit/logs', '审计日志明细');
    await expectTableRows(page, 1);

    await gotoPage(page, '/audit/reports', '报表列表');
    await expectTableRows(page, 1);

    await expectNoConsoleError(page);
  });

  test('无写权限账号看不到生成报表按钮', async ({ page }) => {
    await loginAs(page, 'auditor');
    await gotoPage(page, '/audit/reports', '报表列表');

    await expect(page.getByRole('button', { name: '生成报表' })).toHaveCount(0);
    await expectNoConsoleError(page);
  });
});
