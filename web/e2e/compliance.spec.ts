import { expect, test } from '@playwright/test';
import {
  ACCOUNTS,
  clickButton,
  expectNoConsoleError,
  expectSuccessToast,
  expectTableRows,
  gotoPage,
  loginAs,
  shot,
} from './helpers';

test.describe('安全合规管理模块', () => {
  test('规则库：加载无 console 错误，规则表有数据', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/compliance/rules', '合规规则库');

    await expectTableRows(page, 10);
    await expect(page.locator('.el-table__body')).toContainText('CR-001');
    await shot(page, 'compliance-rules');

    expectNoConsoleError(page);
  });

  test('合规检查：执行检查成功并生成新批次', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/compliance/checks', '合规检查');
    await expectTableRows(page, 10);

    await clickButton(page, /立即执行检查/);
    await expectSuccessToast(page);
    const toast = page.locator('.el-message--success').last();
    await expect(toast).toContainText(/检查完成/);
    await expect(toast).toContainText(/通过率/);

    // 详情抽屉：展示规则原文与同批次对比
    await page.getByRole('button', { name: '详情' }).first().click();
    await expect(page.locator('.el-drawer')).toBeVisible();
    await expect(page.locator('.el-drawer')).toContainText('规则原文');
    await shot(page, 'compliance-checks');
    await page.locator('.el-drawer').getByRole('button', { name: '关闭', exact: true }).click();

    expectNoConsoleError(page);
  });

  test('整改跟踪：状态统计卡片与更新进度抽屉', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/compliance/rectify', '整改跟踪');

    await expect(page.getByText('待整改', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('已逾期', { exact: false }).first()).toBeVisible();
    await expectTableRows(page, 5);
    await shot(page, 'compliance-rectify');

    await page.getByRole('button', { name: '更新进度' }).first().click();
    await expect(page.locator('.el-drawer')).toBeVisible();
    await expect(page.locator('.el-drawer')).toContainText('整改措施');
    await page.locator('.el-drawer').getByRole('button', { name: '取消' }).click();

    expectNoConsoleError(page);
  });

  test('脱敏管理：试脱敏前后结果发生变化', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/compliance/masking', '脱敏管理');
    await expectTableRows(page, 5);

    await page.getByRole('button', { name: '试脱敏' }).first().click();
    await expect(page.locator('.el-dialog')).toBeVisible();
    await clickButton(page, '执行脱敏');
    await expect(page.locator('.result-after')).not.toHaveText('—');

    const before = (await page.locator('.result-grid .mono').nth(0).innerText()).trim();
    const after = (await page.locator('.result-after').innerText()).trim();
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toBe(before);
    await shot(page, 'compliance-masking');
    await page.locator('.el-dialog').getByRole('button', { name: '关闭', exact: true }).click();

    expectNoConsoleError(page);
  });

  test('共享审批：提交申请后审批通过并留痕', async ({ page }) => {
    test.setTimeout(90_000);
    await loginAs(page, 'admin');
    await gotoPage(page, '/compliance/approvals', '共享审批');
    await expectTableRows(page, 1);

    // 发起共享申请
    await clickButton(page, '发起共享申请');
    const dialog = page.locator('.el-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('.el-select').first().click();
    await page.locator('.el-select-dropdown__item:visible').first().click();
    await dialog.getByPlaceholder('接收方单位 / 系统名称').fill('E2E测试接收方');
    await dialog.getByPlaceholder('说明共享用途与使用范围').fill('E2E自动化测试共享用途，验证审批链路');
    await clickButton(page, '提交申请');
    await expectSuccessToast(page);
    const toastText = await page.locator('.el-message--success').last().innerText();
    const matched = toastText.match(/SQ-\d{4}-\d{3}/);
    expect(matched, `提交后提示应包含审批单号: ${toastText}`).not.toBeNull();
    const approvalNo = matched as unknown as string;
    console.log(`[compliance-e2e] created approval: ${approvalNo}`);

    // 待审批列表出现该申请，点击通过
    const pendingRow = page.locator('.el-table__body tbody tr', { hasText: approvalNo }).first();
    await expect(pendingRow).toBeVisible();
    await pendingRow.getByRole('button', { name: '通过' }).click();
    const box = page.locator('.el-message-box');
    await expect(box).toBeVisible();
    await box.getByRole('button', { name: '确认通过' }).click();
    await expectSuccessToast(page);
    await expect(page.locator('.el-message--success').last()).toContainText(/已通过/);

    // 历史记录中状态为已通过
    const historyRow = page.locator('.el-table__body tbody tr', { hasText: approvalNo }).first();
    await expect(historyRow).toBeVisible({ timeout: 20_000 });
    await expect(historyRow).toContainText('已通过');
    await shot(page, 'compliance-approvals');

    expectNoConsoleError(page);
  });

  test('合规报告：批次图表与不通过清单可导出', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/compliance/report', '合规报告');

    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });
    await expectTableRows(page, 1);
    await expect(page.getByText('不通过清单', { exact: false }).first()).toBeVisible();
    await shot(page, 'compliance-report');

    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await clickButton(page, /导出不通过清单/);
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('不通过清单');

    expectNoConsoleError(page);
  });

  test('权限：审计员（只读）无写操作入口', async ({ page }) => {
    await loginAs(page, 'auditor');
    await gotoPage(page, '/compliance/rules', '合规规则库');
    await expectTableRows(page, 10);

    await expect(page.getByRole('button', { name: /新建规则/ }).first()).toBeDisabled();
    await expect(page.getByRole('button', { name: '编辑' }).first()).toBeDisabled();

    await gotoPage(page, '/compliance/checks', '合规检查');
    await expect(page.getByRole('button', { name: /立即执行检查/ }).first()).toBeDisabled();

    await gotoPage(page, '/compliance/masking', '脱敏管理');
    await expectTableRows(page, 5);

    expectNoConsoleError(page);
  });
});
