import { test, expect } from '@playwright/test';
import {
  clickButton,
  expectNoConsoleError,
  expectSuccessToast,
  expectTableRows,
  gotoPage,
  loginAs,
} from './helpers';

test.describe('服务保障运维', () => {
  test('运行监控：指标卡与图表渲染、告警可确认', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/ops/monitor', '运行监控');

    // 8 张指标卡
    await expect(page.getByText('CPU 使用率').first()).toBeVisible();
    await expect(page.getByText('内存使用率').first()).toBeVisible();
    await expect(page.getByText('在线用户').first()).toBeVisible();
    await expect(page.getByText('7 日可用率').first()).toBeVisible();
    await expect(page.getByText('备份成功率').first()).toBeVisible();

    // 图表容器与 ECharts canvas（3 个图：24h 资源、QPS 双轴、可用率）
    await expect(page.locator('.chart-box')).toHaveCount(3);
    await expect.poll(async () => page.locator('.chart-box canvas').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);

    await expect(page.getByText('告警列表', { exact: false }).first()).toBeVisible();

    const alertItems = page.locator('.alert-item');
    if ((await alertItems.count()) > 0) {
      await alertItems.first().getByRole('button', { name: '确认' }).click();
      await expectSuccessToast(page);
      await expect(page.locator('.el-message--success').first()).toContainText('告警已确认');
    } else {
      await expect(page.getByText('当前无告警').first()).toBeVisible();
    }

    await expectNoConsoleError(page);

    // 1440×900 下不应出现横向滚动
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('工单列表：有真实数据且按状态筛选生效', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/ops/tickets', '运维工单');
    await expectTableRows(page, 1);
    await expect(page.locator('.el-table__header').first()).toContainText('工单号');
    await expect(page.locator('.el-table__header').first()).toContainText('SLA');

    // 按「已关闭」筛选
    await page.locator('.filter-card .el-select').first().click();
    await page.getByRole('option', { name: '已关闭' }).click();
    await page.waitForLoadState('networkidle');

    await expect
      .poll(async () => {
        const rows = page.locator('.el-table__body tbody tr');
        const texts = await rows.locator('td:nth-child(5)').allInnerTexts();
        return texts.length > 0 && texts.every((text) => text.trim() === '已关闭');
      }, { timeout: 20_000 })
      .toBe(true);

    await expectNoConsoleError(page);
  });

  test('新建工单成功提示且列表出现新工单', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/ops/tickets', '运维工单');
    await expectTableRows(page, 1);

    const title = `E2E-${Date.now()}-运维联调工单`;
    await clickButton(page, '新建工单');
    const dialog = page.locator('.el-dialog').filter({ hasText: '新建运维工单' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('简要描述问题现象').fill(title);
    await dialog.getByPlaceholder(/影响范围、复现步骤/).fill('E2E 自动化用例创建：平台联调测试工单，用于验证建单、通知与列表刷新。');
    await dialog.getByRole('button', { name: '提交工单' }).click();

    await expectSuccessToast(page);
    await expect(page.locator('.el-message--success').first()).toContainText('创建成功');
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.el-table__body tbody tr').first()).toContainText(title);

    await expectNoConsoleError(page);
  });

  test('工单详情抽屉展示流转时间线', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/ops/tickets', '运维工单');
    await expectTableRows(page, 1);

    await page.locator('.el-table__body tbody tr').first().getByRole('button', { name: '详情' }).click();
    const drawer = page.locator('.el-drawer').first();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('流转轨迹').first()).toBeVisible();
    await expect(drawer.locator('.el-timeline-item').first()).toBeVisible();
    await expect(drawer.getByText('创建').first()).toBeVisible();
    await expect(drawer.getByText('问题描述').first()).toBeVisible();

    await expectNoConsoleError(page);
  });

  test('备份管理：记录有数据、立即备份成功且图表渲染', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/ops/backups', '备份管理');
    await expectTableRows(page, 1);
    await expect(page.locator('.el-table__header').first()).toContainText('备份编号');

    await expect.poll(async () => page.locator('.chart-box canvas').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

    await clickButton(page, '立即备份');
    const confirmBox = page.locator('.el-message-box');
    await expect(confirmBox).toBeVisible();
    await confirmBox.getByRole('button', { name: '开始备份' }).click();

    await expectSuccessToast(page);
    await expect(page.locator('.el-message--success').first()).toContainText('执行成功');
    await expectTableRows(page, 1);

    await expectNoConsoleError(page);
  });

  test('平台配置：按分组展示 12 项配置且可编辑', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/ops/configs', '平台配置');

    await expect(page.getByRole('tab', { name: /基础信息/ })).toBeVisible();
    await page.getByRole('tab', { name: /安全策略/ }).click();
    await expect(page.getByText('security.password.min_length').first()).toBeVisible();
    const firstInput = page.locator('.config-form input:visible').first();
    await expect(firstInput).toBeVisible();
    await expect(page.getByRole('button', { name: '保存本组配置' }).first()).toBeDisabled();
    const original = await firstInput.inputValue();
    await firstInput.fill(`${original}-e2e`);
    await expect(page.getByRole('button', { name: '保存本组配置' }).first()).toBeEnabled();
    await firstInput.fill(original);

    await page.getByRole('tab', { name: /数据治理/ }).click();
    await expect(page.getByText('asset.scan.schedule').first()).toBeVisible();

    await expectNoConsoleError(page);
  });

  test('版本管理：当前版本与历史版本时间线', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/ops/versions', '版本管理');

    await expect(page.getByText('当前运行版本').first()).toBeVisible();
    await expect(page.getByText('V1.0.0').first()).toBeVisible();
    await expect(page.getByText('历史版本').first()).toBeVisible();
    await expect(page.locator('.version-timeline .el-timeline-item')).toHaveCount(4);

    await expectNoConsoleError(page);
  });

  test('auditor 只读账号：可访问但建单/备份/配置保存按钮禁用', async ({ page }) => {
    await loginAs(page, 'auditor');

    await gotoPage(page, '/ops/tickets', '运维工单');
    await expectTableRows(page, 1);
    await expect(page.getByRole('button', { name: '新建工单' })).toBeDisabled();

    await gotoPage(page, '/ops/backups', '备份管理');
    await expectTableRows(page, 1);
    await expect(page.getByRole('button', { name: '立即备份' })).toBeDisabled();

    await gotoPage(page, '/ops/configs', '平台配置');
    await expect(page.getByRole('button', { name: '保存本组配置' }).first()).toBeDisabled();
    await expect(page.locator('.config-form input:visible').first()).toBeDisabled();

    await expectNoConsoleError(page);
  });
});
