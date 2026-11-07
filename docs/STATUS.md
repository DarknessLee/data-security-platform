# 项目状态（STATUS）

> 平台：大数据安全治理与服务保障平台（软著演示版）　版本：V1.0.0　更新时间：2026-11-07 10:12

## 一、当前阶段

**M2 业务模块并行开发中**（M0 立项、M1 基座已完成）。

数据基座（27 张表 + 可重放演示数据）、接口契约 V1.0、认证与安全策略、自动操作审计、看板接口、健康检查与平台元信息均已落地；六大业务模块（资产 / 合规 / 风险 / 权限 / 审计 / 运维）的接口与页面由 6 位模块负责人并行开发，前端基座骨架（路由、状态、请求封装、格式化工具）已就绪，布局、公共组件与 24 个业务页面搭建中。

| 项 | 内容 |
| --- | --- |
| 项目版本 | V1.0.0（`sys_config.platform.version`） |
| 当前阶段 | M2 业务模块并行开发 |
| 最新提交 | 本目录尚未初始化 Git 仓库（无提交号）；由 Lead 统一 `git init`、首次提交后回填至本行 |
| 最近验收 | 2026-11-07 10:07 `node api/db/validate.mjs` → `RESULT=PASS passed=68 failed=0`；10:06 `GET /api/health` 返回 mysql/redis 均 UP、assetCount=64；`POST /api/auth/login`（admin）登录成功，返回 7 个顶级菜单与 12 小时令牌 |
| 更新时间 | 2026-11-07 10:12 |

## 二、演示态重建与关键计数

重建命令（任选其一，`db:init` 与 `db:reset` 等价，均会重放全部种子）：

```powershell
node api/db/init.mjs        # 或 npm run db:init / npm run db:reset
node api/db/validate.mjs    # 校验计数、约束、外键与演示规范，末行 RESULT=
```

下表是文档引用的**唯一计数基线**，其它文档只引用、不另立数字；重建后计数保持不变（`todayLogs` 随初始化时刻浮动，见已知限制）。

| 基线项 | 数据表 | 记录数 |
| --- | --- | --- |
| 数据表 | 全部业务表 | 27 |
| 部门 | sys_dept | 6 |
| 用户 | sys_user | 9 |
| 角色 | sys_role | 8 |
| 用户-角色关系 | sys_user_role | 9 |
| 菜单 | sys_menu | 30 |
| 角色-菜单授权 | sys_role_menu | 54 |
| 接口权限 | sys_api_permission | 43 |
| 角色-接口授权 | sys_role_api | 199 |
| 平台配置 | sys_config | 12 |
| 站内通知 | notification | 10 |
| 资产分类 | asset_category | 8 |
| 数据资产 | data_asset | 64 |
| 资产标签 | asset_tag | 156 |
| 生命周期记录 | asset_lifecycle | 257 |
| 合规规则 | compliance_rule | 20 |
| 合规检查结果 | compliance_check | 100 |
| 整改单 | compliance_rectify | 22 |
| 脱敏规则 | masking_rule | 10 |
| 共享审批单 | share_approval | 18 |
| 风险规则 | risk_rule | 10 |
| 风险事件 | risk_event | 48 |
| 审计日志 | audit_log | 331 |
| 审计报表 | audit_report | 5 |
| 服务工单 | service_ticket | 22 |
| 工单轨迹 | ticket_trace | 88 |
| 备份记录 | backup_record | 14 |
| 监控指标点 | ops_metric | 155 |

关键分布（看板与演示脚本口径）：

| 维度 | 分布 |
| --- | --- |
| 资产分级 | 公开 4 / 内部 27 / 机密 20 / 绝密 13（敏感资产 33） |
| 资产状态 | 正常 34 / 待治理 12 / 风险 11 / 已归档 7 |
| 合规检查 | 5 个批次（CHK-2026-001～005）各 20 条，每批通过 14 条，最近批次通过率 70% |
| 风险事件 | 待处置 4 / 处置中 5 / 已处置 26 / 已忽略 13（未闭环 9，其中高+紧急 6） |
| 服务工单 | 待受理 3 / 处理中 4 / 待验证 2 / 已关闭 13（待处理 9） |
| 审计日志 | 覆盖连续 7 个自然日，四类日志：登录 / 访问 / 操作 / 接口 |

## 三、运行入口与演示账号

| 项 | 地址 / 说明 |
| --- | --- |
| API 服务 | `http://127.0.0.1:8081/api`（Express 5，`cd api && npm run dev`） |
| Web 前端 | `http://127.0.0.1:5174`（Vite 开发服务器，`npm run web`；页面搭建中） |
| MySQL | Docker 容器 `datasec-mysql`，`127.0.0.1:13306`，库 `datasec` |
| Redis | Docker 容器 `datasec-redis`，`127.0.0.1:16379` |
| 健康检查 | `GET /api/health`（无需鉴权） |
| 演示账号 | admin / Admin@2026（超级管理员）、secadmin / Sec@2026、compliance / Comp@2026、steward / Steward@2026、auditor / Audit@2026、ops / Ops@2026、depthead / Dept@2026、analyst / Analyst@2026 |

## 四、下一步

1. 六位模块负责人合入六个路由文件（`api/src/modules/<module>/router.ts`），替换占位 `Router()`，使契约 V1.0 的 82 个接口全部可调。
2. Lead 补齐前端布局 `web/src/layouts/AppLayout.vue`、公共组件与 24 个业务页面，打通登录 → 看板 → 六模块页面链路。
3. 五道门禁转绿：`npm run build`、`npm run test:api`、`npm run test:e2e`、`node api/db/validate.mjs`、`node scripts/check-docs.mjs`。
4. 生成演示截图到 `docs/screenshots/`，回填 README 截图区；初始化 Git 并回填提交号。
5. 补全 M2 阶段报告（当前只写已落地部分）、更新本文件为 M3 验收态。

## 五、已知限制

| 编号 | 限制 | 影响 |
| --- | --- | --- |
| L-01 | 六个业务模块的 `router.ts` 仍为占位实现，对应接口请求返回 404 | 资产 / 合规 / 风险 / 权限 / 审计 / 运维页面暂不可用，M3 前必须合入 |
| L-02 | Web 前端 `layouts`、`components`、`views`、`styles/main.scss` 尚未补齐 | `npm run build` 中 web 侧当前不通过，前端不可启动 |
| L-03 | `docs/screenshots/` 尚无截图 | README 截图区为路径占位，由 Lead 生成截图后补链接 |
| L-04 | 目录未初始化 Git 仓库 | 阶段报告与 STATUS 无提交号可回填，由 Lead 统一提交 |
| L-05 | Docker CLI 未加入当前 PowerShell 的 PATH，但容器已运行 | 重建环境时需用 Docker Desktop 绝对路径或修正 PATH，见部署文档 FAQ |
| L-06 | 看板 `todayLogs` 以初始化时刻为基准动态计算（当前约 50 条） | 演示时该卡片数值会在合理区间浮动，其余计数固定 |
| L-07 | 资产扫描、备份、监控指标、哈希链校验、脱敏试运行为演示级近似 | 不接入真实扫描器 / 备份系统 / 监控采集 / 真实脱敏引擎 |
| L-08 | 性能目标（≤500ms）与可用率目标（≥99.9%）未压测、未承诺 | 演示环境为单机单实例，Nginx / PM2 多实例暂缓 |
