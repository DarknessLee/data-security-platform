# 大数据安全治理与服务保障平台（软著演示版）

面向数据安全治理场景的一体化演示平台：把**数据资产治理、安全合规、智能风险监测、权限管控、安全审计、服务保障运维**六件事收进一个工作台，用一套可重放的演示数据串联"资产看得清、合规查得到、风险管得住、权限控得严、审计追得回、运维兜得底"的完整闭环。

- 版本：V1.0.0　技术栈：Vue 3 + Express 5 + MySQL 8 + Redis 7　运行方式：本机进程 + Docker 依赖
- 数据规模：27 张表、64 条资产、100 条合规检查、48 条风险事件、331 条审计日志、22 张工单、155 个监控点
- 质量门禁：build / test:api / test:e2e / db:validate / check:docs 五道（详见 [验收清单](docs/验收清单.md)）

## 功能一览

| 模块 | 能力 | 页面入口 |
| --- | --- | --- |
| 平台总览 | 资产/敏感资产/未闭环风险/待办工单/合规率一屏聚合，7 天风险趋势与 24h 运维态势 | `/dashboard` |
| 数据资产治理 | 台账、分类分级（公开/内部/机密/绝密）、标签、生命周期、模拟扫描、统计导出 | `/asset/list` 等 3 页 |
| 安全合规管理 | 法规规则库、自动检查批次、整改闭环、脱敏规则与试运行、共享审批、合规报告 | `/compliance/*` 6 页 |
| 智能风险监测 | 五类异常事件、四级预警、实时监控、趋势、处置与溯源 | `/risk/*` 3 页 |
| 权限安全管控 | 用户/角色/菜单/接口四级 RBAC、数据范围 ALL/DEPT/SELF、密码策略与登录锁定 | `/rbac/*` 4 页 |
| 安全审计追溯 | 四类日志查询导出、SHA-256 完整性校验、日/周/月/年报表 | `/audit/*` 2 页 |
| 服务保障运维 | 资源监控、阈值告警、工单闭环、备份、配置与版本管理 | `/ops/*` 5 页 |

## 快速开始

```powershell
# 1) 安装依赖（npm workspaces）
npm install

# 2) 启动 MySQL 13306 / Redis 16379
npm run docker:up

# 3) 建表 + 重放演示数据，并校验基线
npm run db:init
npm run db:validate

# 4) 启动前后端
npm run dev
```

| 入口 | 地址 |
| --- | --- |
| 前端 | http://127.0.0.1:5174 |
| 接口 | http://127.0.0.1:8081/api |
| 健康检查 | http://127.0.0.1:8081/api/health |

演示账号（密码均为 `角色名@2026` 规则，见 [STATUS](docs/STATUS.md) 第三章）：`admin / Admin@2026`、`secadmin / Sec@2026`、`compliance / Comp@2026`、`steward / Steward@2026`、`auditor / Audit@2026`、`ops / Ops@2026`、`depthead / Dept@2026`、`analyst / Analyst@2026`。

> 完整环境要求、故障排查见 [部署运行手册](docs/部署运行.md)；演示前务必 `npm run db:reset` 恢复基线。

## 演示路线（按角色）

| 顺序 | 角色 | 演示内容 | 预期现象 |
| --- | --- | --- | --- |
| 1 | admin 超级管理员 | 登录 → 看板 → 资产分级 → 合规检查执行 → 风险处置 → 权限调整 → 审计校验 → 运维工单 | 8 步 3–5 分钟走通，详见 [演示脚本](docs/演示脚本.md) |
| 2 | steward 数据管理员 | 资产台账筛选、调级、生命周期轨迹 | 调级后分级分布变化并留痕 |
| 3 | compliance 合规专员 | 规则库、执行检查、整改闭环 | 新批次生成，不通过项进入整改 |
| 4 | secadmin 安全管理员 | 风险事件处置、规则命中 | 未闭环数下降，看板 20 秒内同步 |
| 5 | auditor 审计员 | 四类日志、完整性校验、报表 | 只读可查，链校验返回完整 |
| 6 | ops 运维工程师 | 监控趋势、告警、工单流转、备份记录 | 工单四态流转并写轨迹 |
| 7 | depthead 部门主管 | 部门视角看板与资产 | 仅见本部门数据 |
| 8 | analyst 数据分析师 | 看板与资产只读 | 访问权限/审计页面被拒（403） |

## 功能截图

截图统一存放于 `docs/screenshots/`，由 `npm run screenshots` 生成：登录页 1 张 + 业务页面 24 张，共 25 张（1440×900，命名 `NN-<页面>.png`），`RESULT=PASS count=25`。

| 模块 | 截图文件 |
| --- | --- |
| 登录 / 看板 | [01-login.png](docs/screenshots/01-login.png)、[02-dashboard.png](docs/screenshots/02-dashboard.png) |
| 数据资产（3） | [03-asset-list.png](docs/screenshots/03-asset-list.png)、[04-asset-categories.png](docs/screenshots/04-asset-categories.png)、[05-asset-lifecycle.png](docs/screenshots/05-asset-lifecycle.png) |
| 安全合规（6） | [06-compliance-rules.png](docs/screenshots/06-compliance-rules.png)、[07-compliance-checks.png](docs/screenshots/07-compliance-checks.png)、[08-compliance-rectify.png](docs/screenshots/08-compliance-rectify.png)、[09-compliance-masking.png](docs/screenshots/09-compliance-masking.png)、[10-compliance-approvals.png](docs/screenshots/10-compliance-approvals.png)、[11-compliance-report.png](docs/screenshots/11-compliance-report.png) |
| 智能风险（3） | [12-risk-events.png](docs/screenshots/12-risk-events.png)、[13-risk-rules.png](docs/screenshots/13-risk-rules.png)、[14-risk-realtime.png](docs/screenshots/14-risk-realtime.png) |
| 权限管控（4） | [15-rbac-users.png](docs/screenshots/15-rbac-users.png)、[16-rbac-roles.png](docs/screenshots/16-rbac-roles.png)、[17-rbac-menus.png](docs/screenshots/17-rbac-menus.png)、[18-rbac-apis.png](docs/screenshots/18-rbac-apis.png) |
| 安全审计（2） | [19-audit-logs.png](docs/screenshots/19-audit-logs.png)、[20-audit-reports.png](docs/screenshots/20-audit-reports.png) |
| 服务保障（5） | [21-ops-monitor.png](docs/screenshots/21-ops-monitor.png)、[22-ops-tickets.png](docs/screenshots/22-ops-tickets.png)、[23-ops-backups.png](docs/screenshots/23-ops-backups.png)、[24-ops-configs.png](docs/screenshots/24-ops-configs.png)、[25-ops-versions.png](docs/screenshots/25-ops-versions.png) |

> `docs/screenshots/` 中另有 6 张合规模块早期归档图（`compliance-*.png`），内容与 `06`～`11` 对应。

## 目录结构

```text
data-security-platform/
├─ api/                     # Express 5 + TypeScript 后端
│  ├─ db/                   # schema.sql、init.mjs、validate.mjs、seed/
│  └─ src/                  # app.ts、config、db、lib、middleware、modules（7 个）、routes
├─ web/                     # Vue 3 + Vite 前端
│  ├─ src/                  # api、components、layouts、router、stores、styles、utils、views（7 模块）
│  └─ e2e/                  # Playwright 用例
├─ docs/                    # 文档集（契约、状态、决策、矩阵、溯源、阶段报告、验收、演示、部署）
│  └─ screenshots/          # 交付截图
├─ scripts/                 # setup / docker / dev / test-api / verify / screenshots / check-docs
├─ docker-compose.yml       # MySQL 8.0（13306）+ Redis 7（16379）
└─ package.json             # npm workspaces + 门禁脚本
```

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vue 3 组合式 API、TypeScript、Vite 7、Element Plus、Pinia、Vue Router 4、Axios、ECharts、dayjs |
| 后端 | Node 20+、Express 5、TypeScript（ESM）、mysql2 连接池 + 原生 SQL、ioredis、jsonwebtoken、bcryptjs、zod |
| 数据 | MySQL 8.0（27 表，utf8mb4）、Redis 7（看板缓存、登录失败计数、鉴权缓存） |
| 测试与交付 | Playwright（E2E）、Node 校验脚本（数据契约/文档门禁）、Docker Compose |

## 质量门禁

门禁链顺序（`npm run verify` 串行执行）：数据重建 → `db:validate` → `build` → `test:api` → `test:e2e` → `check:docs`。

```powershell
npm run db:reset     # 重播种干净演示基线
npm run db:validate  # RESULT=PASS passed=69 failed=0
npm run build        # RESULT=PASS（api tsc + web vue-tsc/vite build）
npm run test:api     # RESULT=PASS passed=74 failed=0
npm run test:e2e     # 45 passed / 0 failed（2.4 分钟）
npm run check:docs   # RESULT=PASS
npm run verify       # 全量串行门禁（待回填汇总）
```

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [STATUS](docs/STATUS.md) | 当前阶段、计数基线、已知限制、下一步 |
| [接口契约](docs/接口契约.md) | V1.0 验收基线 + V1.1 响应结构 + V1.2 实现清单（81 条业务 + 2 条系统） |
| [DECISIONS](docs/DECISIONS.md) | 18 条技术决策与被否决备选方案 |
| [PLAN-MATRIX](docs/PLAN-MATRIX.md) | 90 工作日六阶段 → 五里程碑映射与能力矩阵 |
| [需求溯源](docs/需求溯源.md) | 方案 3.1–3.6 功能点 → 接口/页面/表 |
| [阶段报告](docs/阶段报告/) | M0 立项、M1 基座、M2 业务、M3 验收、M4 交付 |
| [验收清单](docs/验收清单.md) | 五类检查点与通过标准 |
| [演示脚本](docs/演示脚本.md) | 3–5 分钟 8 步演示路线 |
| [部署运行](docs/部署运行.md) | 环境、起停、重建、验证、FAQ |

## 已知限制

1. 资产扫描、监控采集、备份、脱敏、哈希链校验为**演示级近似**（[DECISIONS](docs/DECISIONS.md) D-012）。
2. 单机单实例演示，不承诺 99.9% 可用率与并发指标（[PLAN-MATRIX](docs/PLAN-MATRIX.md) H-02）。
3. K8s、多租户、真实脱敏引擎、SIEM、软著登记材料不在本期范围（D-015）。
4. 前端 25 个视图与 25 张截图已齐备；`npm run verify` 汇总与 Git 提交号待回填，进度以 [STATUS](docs/STATUS.md) 为准。
