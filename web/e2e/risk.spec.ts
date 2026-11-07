import { test, expect } from '@playwright/test';
import {
  expectNoConsoleError,
  expectSuccessToast,
  expectTableRows,
  gotoPage,
  loginAs,
} from './helpers';

test.describe('智能风险监测', () => {
  test('风险事件页可访问、无 console 错误且表格有数据', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/risk/events', '风险事件列表');
    await expectTableRows(page, 1);

    await expect(page.getByText('风险事件列表').first()).toBeVisible();
    await expect(page.locator('.el-table__header').first().getByText('事件编号')).toBeVisible();
    await expect(page.locator('.el-table__header').first().getByText('操作账号 / IP')).toBeVisible();
    await expect(page.locator('.filter-card')).toBeVisible();

    await expectNoConsoleError(page);
  });

  test('按风险级别筛选后表格只剩该级别事件', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/risk/events', '风险事件列表');
    await expectTableRows(page, 1);

    await page.locator('.filter-card .el-select').first().click();
    await page.getByRole('option', { name: '紧急', exact: true }).click();
    await page.getByRole('button', { name: '查询' }).click();
    await page.waitForLoadState('networkidle');
    await expectTableRows(page, 1);

    // 第三列为风险级别标签
    const levelCells = page.locator('.el-table__body tbody tr td:nth-child(3)');
    await expect
      .poll(async () => {
        const texts = await levelCells.allInnerTexts();
        return texts.length > 0 && texts.every((text) => text.trim() === '紧急');
      }, { timeout: 20_000 })
      .toBe(true);

    await expect(page.locator('.filter-card .el-select').first()).toContainText('紧急');
    await expectNoConsoleError(page);
  });

  test('事件详情抽屉展示基础信息、关联事件与溯源链路', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/risk/events', '风险事件列表');
    await expectTableRows(page, 1);

    await page.locator('.el-table__body tbody tr').first().getByRole('button', { name: '详情' }).click();

    const drawer = page.locator('.el-drawer').filter({ hasText: '风险事件详情' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('关联事件（同 IP / 同账号）').first()).toBeVisible();
    await expect(drawer.getByText('风险事件触发', { exact: false })).toHaveCount(0);

    await drawer.getByRole('button', { name: '开始溯源' }).click();
    await expect(drawer.getByText('风险事件触发').first()).toBeVisible({ timeout: 20_000 });
    await expect(drawer.getByText('涉事账号').first()).toBeVisible();
    await expect(drawer.getByText('同 IP / 同网段其他事件').first()).toBeVisible();

    await expectNoConsoleError(page);
  });

  test('处置待处置事件成功并提示', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/risk/events', '风险事件列表');
    await expectTableRows(page, 1);

    // 先筛选出「待处置」事件（状态筛选为第二个下拉）
    await page.locator('.filter-card .el-select').nth(1).click();
    await page.getByRole('option', { name: '待处置', exact: true }).click();
    await page.getByRole('button', { name: '查询' }).click();
    await page.waitForLoadState('networkidle');

    const rows = page.locator('.el-table__body tbody tr');
    const pendingCount = await rows.count();
    test.skip(pendingCount === 0, '当前没有待处置事件（前序用例已消费），跳过处置用例');

    await rows.first().getByRole('button', { name: '处置' }).click();
    const dialog = page.locator('.el-dialog').filter({ hasText: '处置风险事件' });
    await expect(dialog).toBeVisible();
    await dialog.locator('label.el-radio').filter({ hasText: '已处置' }).first().click();
    await dialog.locator('textarea').fill('E2E 用例：已确认账号异常并封禁，完成处置');
    await dialog.getByRole('button', { name: '确认处置' }).click();

    await expectSuccessToast(page);
    await expect(page.locator('.el-message--success').first()).toContainText('处置成功');

    await expectNoConsoleError(page);
  });

  test('监测规则页展示 10 条规则、命中对比条形与启停开关', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/risk/rules', '规则列表');
    await expectTableRows(page, 10);

    await expect(page.locator('.el-table__body tbody tr')).toHaveCount(10);
    await expect(page.locator('.el-progress').first()).toBeVisible();
    await expect(page.locator('.el-switch').first()).toBeVisible();
    await expect(page.getByText('累计命中').first()).toBeVisible();

    await expectNoConsoleError(page);
  });

  test('实时监控页展示 4 个级别卡片、图表、最新事件与重点 IP 排行', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/risk/realtime', '最新风险事件');

    await expect(page.locator('.stat-card')).toHaveCount(4);
    await expect(page.locator('.chart-box canvas').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('近 24 小时风险趋势').first()).toBeVisible();
    await expect(page.getByText('事件类型分布').first()).toBeVisible();
    await expect(page.getByText('重点 IP 排行').first()).toBeVisible();
    await expect(page.locator('[data-testid="risk-live-list"] .live-item').first()).toBeVisible();
    await expect(page.locator('[data-testid="risk-ip-rank"] .ip-item').first()).toBeVisible();
    await expect(page.getByText('30 秒自动刷新').first()).toBeVisible();

    await expectNoConsoleError(page);
  });

  test('只读账号（auditor）可查看风险事件但无处置权限', async ({ page }) => {
    await loginAs(page, 'auditor');
    await gotoPage(page, '/risk/events', '风险事件列表');
    await expectTableRows(page, 1);

    const firstRowHandle = page.locator('.el-table__body tbody tr').first().getByRole('button', { name: '处置' });
    await expect(firstRowHandle).toBeVisible();
    await expect(firstRowHandle).toBeDisabled();
    await expect(page.locator('.el-table__body tbody tr').first().getByRole('button', { name: '忽略' })).toBeDisabled();

    // 只读账号在规则页同样不能启停规则
    await gotoPage(page, '/risk/rules', '规则列表');
    await expectTableRows(page, 10);
    await expect(page.locator('.el-switch').first()).toHaveClass(/is-disabled/);

    await expectNoConsoleError(page);
  });
});
