import { test, expect } from '@playwright/test';
import {
  clickButton,
  expectNoConsoleError,
  expectSuccessToast,
  expectTableRows,
  gotoPage,
  loginAs,
} from './helpers';

/**
 * 权限安全管控模块 E2E 用例
 * 覆盖：用户管理（列表 / 新增 / 筛选 / 只读账号）、角色权限抽屉、菜单权限矩阵、接口权限与安全策略。
 * 注意：新增用户用例会创建唯一命名账号 e2e_rbac_*，用于验证成功后由测试数据清理脚本回收。
 */
test.describe('权限安全管控', () => {
  test('用户管理页可访问、表格有 9 个用户且无 console 错误', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/rbac/users', '用户管理');

    await expectTableRows(page, 9);
    await expect(page.getByText('用户总数').first()).toBeVisible();
    await expect(page.getByText('启用账号').first()).toBeVisible();
    await expect(page.getByText('锁定账号').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '新增用户' })).toBeVisible();

    await expectNoConsoleError(page);
  });

  test('按部门筛选用户列表', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/rbac/users', '用户管理');
    await expectTableRows(page, 9);

    await page.locator('.filter-card .el-select').first().click();
    await page.getByRole('option', { name: '安全合规部' }).click();
    await clickButton(page, /查\s*询/);

    await expect
      .poll(async () => page.locator('.el-table__body tbody tr').count(), { timeout: 20_000 })
      .toBe(2);
    const deptCells = page.locator('.el-table__body tbody tr td:nth-child(2)');
    const texts = await deptCells.allInnerTexts();
    expect(texts.every((text) => text.trim() === '安全合规部')).toBe(true);

    await expectNoConsoleError(page);
  });

  test('新增用户成功提示并出现在列表中', async ({ page }) => {
    const suffix = Date.now().toString().slice(-8);
    const username = `e2e_rbac_${suffix}`;

    await loginAs(page, 'admin');
    await gotoPage(page, '/rbac/users', '用户管理');
    await expectTableRows(page, 9);

    await clickButton(page, '新增用户');
    const drawer = page.locator('.el-drawer').filter({ hasText: '新增用户' });
    await expect(drawer).toBeVisible();

    await drawer.getByPlaceholder(/3–32 位字母/).fill(username);
    await drawer.getByPlaceholder('请输入真实姓名').fill('E2E 校验账号');
    await drawer.getByPlaceholder('请设置初始密码').fill('E2e#Passw0rd');
    await drawer.locator('.el-select').first().click();
    await page.getByRole('option', { name: '技术研发部' }).click();
    await drawer.locator('.el-checkbox').filter({ hasText: '审计员' }).first().click();
    await drawer.getByRole('button', { name: '保存' }).click();

    await expectSuccessToast(page);
    await expect(page.locator('.el-message--success').first()).toContainText('用户创建成功');

    // 通过关键词检索确认新账号已落库
    await page.getByPlaceholder('账号 / 姓名 / 手机号').fill(username);
    await clickButton(page, /查\s*询/);
    await expect(page.getByText(username).first()).toBeVisible({ timeout: 20_000 });

    await expectNoConsoleError(page);
  });

  test('角色权限抽屉可打开并展示菜单树与接口清单', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/rbac/roles', '角色管理');
    await expect(page.getByText('超级管理员').first()).toBeVisible();

    await clickButton(page, '配置权限');
    const drawer = page.locator('.el-drawer').filter({ hasText: '配置角色权限' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('菜单可见性').first()).toBeVisible();
    await expect(drawer.getByText('接口权限').first()).toBeVisible();
    await expect(drawer.locator('.el-tree-node').first()).toBeVisible();
    await expect(drawer.getByText('平台总览').first()).toBeVisible();
    await expect(drawer.locator('.el-checkbox').first()).toBeVisible();
    await expect(drawer.getByText(/已授权菜单/).first()).toBeVisible();

    await expectNoConsoleError(page);
  });

  test('菜单权限页展示菜单树与角色可见性矩阵', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/rbac/menus', '菜单权限');

    await expect(page.getByText('菜单总数').first()).toBeVisible();
    await expect(page.getByText('角色 × 菜单 可见性矩阵').first()).toBeVisible();
    await expectTableRows(page, 30);
    await expect(page.locator('.grant-yes').first()).toBeVisible();
    await expect(page.getByText('角色菜单授权概况').first()).toBeVisible();

    await expectNoConsoleError(page);
  });

  test('接口权限页展示 43 个接口、角色矩阵与安全策略', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/rbac/apis', '接口权限');

    await expect(page.getByText('接口总数').first()).toBeVisible();
    await expect(page.getByText('共 43 / 43 个接口').first()).toBeVisible();
    await expectTableRows(page, 30);
    await expect(page.getByText('角色 × 接口 授权矩阵').first()).toBeVisible();
    await expect(page.locator('.grant-yes').first()).toBeVisible();

    await expect(page.getByText('安全策略').first()).toBeVisible();
    await expect(page.getByText(/当前密码策略/).first()).toBeVisible();
    await expect(page.getByText('登录失败锁定阈值').first()).toBeVisible();
    await expect(page.getByText('IP 白名单').first()).toBeVisible();

    await expectNoConsoleError(page);
  });

  test('保存安全策略返回成功提示', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoPage(page, '/rbac/apis', '接口权限');
    await expect(page.getByText('安全策略').first()).toBeVisible();

    await clickButton(page, '保存策略');
    await expectSuccessToast(page);

    await expectNoConsoleError(page);
  });

  test('auditor 只读账号可查看用户数据但没有新增与编辑入口', async ({ page }) => {
    await loginAs(page, 'auditor');
    await gotoPage(page, '/rbac/users', '用户管理');
    await expectTableRows(page, 9);

    await expect(page.getByRole('button', { name: '新增用户' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重置密码' })).toHaveCount(0);
    await expect(page.getByText('只读').first()).toBeVisible();

    await expectNoConsoleError(page);
  });
});
