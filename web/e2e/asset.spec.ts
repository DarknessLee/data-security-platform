import { expect, test } from '@playwright/test';
import {
  ACCOUNTS,
  expectNoConsoleError,
  expectTableRows,
  gotoPage,
  loginAs,
} from './helpers';

const ASSET_LIST = '/asset/list';
const ASSET_CATEGORIES = '/asset/categories';
const ASSET_LIFECYCLE = '/asset/lifecycle';

/** 从「共 N 条」文本中解析总数 */
async function readTotal(page: import('@playwright/test').Page): Promise<number> {
  const text = await page.getByTestId('asset-total').innerText();
  const match = /共\s*(\d+)\s*条/.exec(text);
  return match ? Number(match[1]) : 0;
}

test.describe('数据资产治理 - 资产台账', () => {
  test('台账页面加载：统计卡片、表格与图表正常渲染，无 console 错误', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, ASSET_LIST, '资产台账');

    // 统计卡片
    await expect(page.getByText('资产总量').first()).toBeVisible();
    await expect(page.getByText('敏感数据资产').first()).toBeVisible();
    await expect(page.getByText('平均质量分').first()).toBeVisible();

    // 表格首屏 10 行
    await expectTableRows(page, 10);
    expect(await readTotal(page)).toBeGreaterThanOrEqual(10);

    // 分页条
    await expect(page.locator('.el-pagination')).toBeVisible();

    expectNoConsoleError(page);
  });

  test('关键词筛选生效且可重置', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, ASSET_LIST, '资产台账');
    await expectTableRows(page, 10);

    const totalBefore = await readTotal(page);

    await page.getByPlaceholder('资产名称/编号').fill('人口');
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/assets?') && res.status() === 200),
      page.getByRole('button', { name: /查\s*询/ }).click(),
    ]);

    await expect
      .poll(async () => page.locator('.el-table__body tbody tr').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    const totalFiltered = await readTotal(page);
    expect(totalFiltered).toBeGreaterThan(0);
    expect(totalFiltered).toBeLessThan(totalBefore);

    // 首行命中关键词（资产名称或编号）
    const firstRow = page.locator('.el-table__body tbody tr').first();
    await expect(firstRow).toContainText('人口');

    // 重置回全量
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/assets?') && res.status() === 200),
      page.getByRole('button', { name: /重\s*置/ }).click(),
    ]);
    expect(await readTotal(page)).toBe(totalBefore);

    expectNoConsoleError(page);
  });

  test('点击详情打开资产详情抽屉并展示标签与生命周期', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, ASSET_LIST, '资产台账');
    await expectTableRows(page, 1);

    await page.locator('.el-table__body tbody tr').first().getByRole('button', { name: '详情' }).click();

    const drawer = page.locator('.el-drawer').first();
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByText('资产编号').first()).toBeVisible();
    await expect(drawer.getByText('敏感度 / 质量分').first()).toBeVisible();
    await expect(drawer.getByText('资产生命周期').first()).toBeVisible();

    expectNoConsoleError(page);
  });

  test('管理员可看到写操作按钮（登记资产 / 全局扫描）', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, ASSET_LIST, '资产台账');
    await expectTableRows(page, 1);

    await expect(page.getByTestId('asset-create')).toBeVisible();
    await expect(page.getByRole('button', { name: '全局扫描' })).toBeVisible();
    await expect(page.getByRole('button', { name: '导出台账' })).toBeVisible();

    // 行内写操作按钮同样可见
    await expect(page.locator('.el-table__body tbody tr').first().getByRole('button', { name: '编辑' })).toBeVisible();

    expectNoConsoleError(page);
  });

  test('只读账号（auditor）看不到任何写按钮，导出仍可用', async ({ page }) => {
    await loginAs(page, 'auditor');
    await gotoPage(page, ASSET_LIST, '资产台账');
    await expectTableRows(page, 1);

    await expect(page.getByTestId('asset-create')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '全局扫描' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '导出台账' })).toBeVisible();

    const firstRow = page.locator('.el-table__body tbody tr').first();
    await expect(firstRow.getByRole('button', { name: '编辑' })).toHaveCount(0);
    await expect(firstRow.getByRole('button', { name: '分级调整' })).toHaveCount(0);
    await expect(firstRow.getByRole('button', { name: '扫描复核' })).toHaveCount(0);
    await expect(firstRow.getByRole('button', { name: '详情' })).toBeVisible();

    expectNoConsoleError(page);
  });
});

test.describe('数据资产治理 - 分类分级与生命周期', () => {
  test('分类分级页展示分类树、分布图与分类资产清单', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, ASSET_CATEGORIES, '分类分级');

    await expect(page.getByText('资产分类树')).toBeVisible();
    await expect(page.getByText('基础信息库').first()).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();

    const table = page.getByTestId('category-asset-table');
    await expect(table).toBeVisible();
    await expect.poll(async () => table.locator('.el-table__body tbody tr').count(), { timeout: 20_000 })
      .toBeGreaterThan(0);

    // 点击分类树其他节点，清单标题随之切换
    await page.getByText('金融交易数据').first().click();
    await expect(page.getByText('金融交易数据 资产清单')).toBeVisible({ timeout: 15_000 });

    expectNoConsoleError(page);
  });

  test('生命周期页展示 5 阶段统计与资产生命周期时间线', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, ASSET_LIFECYCLE, '生命周期');

    for (const stage of ['采集阶段', '存储阶段', '使用阶段', '共享阶段', '销毁阶段']) {
      await expect(page.getByText(stage).first()).toBeVisible();
    }
    await expect(page.getByTestId('lifecycle-asset-select')).toBeVisible();

    // 默认选中首个资产，时间线应有记录
    await expect
      .poll(async () => page.locator('.el-timeline-item').count(), { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect(page.locator('.el-steps').first()).toBeVisible();

    expectNoConsoleError(page);
  });
});

test.describe('数据资产治理 - 账号密码常量', () => {
  test('auditor 账号常量与登录密码正确', async () => {
    expect(ACCOUNTS.auditor.username).toBe('auditor');
    expect(ACCOUNTS.auditor.password).toBe('Audit@2026');
  });
});
