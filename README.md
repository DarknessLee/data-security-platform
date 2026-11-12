# 大数据安全治理与服务保障平台

面向组织数据安全治理与运营的一体化平台：围绕数据全生命周期，把**数据资产治理、安全合规管理、智能风险监测、权限安全管控、安全审计追溯、服务保障运维**六项能力收进同一个工作台，形成"资产识别 → 分类分级 → 合规检查 → 风险监测 → 处置闭环 → 审计追溯 → 运维保障"的完整治理链路。

平台面向落实《数据安全法》《个人信息保护法》与等保 2.0 要求的组织，目标是把安全治理从"事后整改"前移到"事前预防、事中监测、事后追溯"：数据看得清、合规查得到、风险管得住、权限控得严、审计追得回、运维兜得底。

- 版本：V1.0.0　技术栈：Vue 3 + Express 5 + MySQL 8 + Redis 7　部署形态：Node 进程 + Docker Compose 依赖
- 数据模型：27 张表覆盖组织权限、数据资产、合规、风险、审计与运维；`npm run db:init` 生成可重放初始数据（8 类角色账号、64 条资产、100 条检查记录、48 条风险事件、331 条审计日志、22 张工单、155 个监控点），任何环境重建后结果一致
- 工程质量：build / test:api / test:e2e / db:validate / check:docs 五道自动化门禁，`npm run verify` 一键串行执行

## 项目背景与目标

数据分散在多个业务系统中，安全治理常见三类问题：资产底数不清、合规要求难落地、风险发现滞后。平台将分散的治理动作收敛为一套标准流程：

| 目标 | 平台能力 |
| --- | --- |
| 摸清家底 | 资产台账、分类分级（公开/内部/机密/绝密）、标签与生命周期轨迹，敏感数据自动打标 |
| 合规落地 | 法规规则库、自动检查批次、整改闭环、脱敏规则与试运行、数据共享审批、合规报告 |
| 风险可控 | 越权访问、批量导出、异常登录、数据篡改、敏感外传五类监测，四级预警，处置与溯源闭环 |
| 权限收敛 | 用户—角色—菜单—接口四级 RBAC，数据范围 ALL / DEPT / SELF 隔离，密码策略与登录锁定 |
| 全程留痕 | 登录/访问/操作/接口四类日志，SHA-256 链式校验，日/周/月/年报表 |
| 稳定运行 | 资源监控与阈值告警、工单闭环、备份、配置与版本管理 |

## 功能一览

| 模块 | 能力 | 页面入口 |
| --- | --- | --- |
| 平台总览 | 资产/敏感资产/未闭环风险/待办工单/合规率一屏聚合，7 天风险趋势与 24h 运维态势 | `/dashboard` |
| 数据资产治理 | 台账、分类分级（公开/内部/机密/绝密）、标签、生命周期、敏感度扫描、统计导出 | `/asset/list` 等 3 页 |
| 安全合规管理 | 法规规则库、自动检查批次、整改闭环、脱敏规则与试运行、共享审批、合规报告 | `/compliance/*` 6 页 |
| 智能风险监测 | 五类异常事件、四级预警、实时监控、趋势、处置与溯源 | `/risk/*` 3 页 |
| 权限安全管控 | 用户/角色/菜单/接口四级 RBAC、数据范围 ALL/DEPT/SELF、密码策略与登录锁定 | `/rbac/*` 4 页 |
| 安全审计追溯 | 四类日志查询导出、SHA-256 完整性校验、日/周/月/年报表 | `/audit/*` 2 页 |
| 服务保障运维 | 资源监控、阈值告警、工单闭环、备份、配置与版本管理 | `/ops/*` 5 页 |

## 系统架构

前后端分离部署：Web 端为 Vue 3 单页应用，通过 Axios 调用 REST 接口；API 为 Express 5 + TypeScript 服务，统一 JWT 鉴权、RBAC 接口级校验、数据范围过滤与写操作审计；数据层使用 MySQL 8 存储业务数据、Redis 承担看板缓存、登录失败计数与鉴权缓存；容器化依赖由 Docker Compose 提供，前端与 API 可分别部署到内网服务器。

```
浏览器 ──HTTP──> Vue 3 (Vite) ──/api──> Express 5 API ──> MySQL 8 / Redis 7
                                          │
                                          └─ JWT 鉴权 · RBAC 四级 · 数据范围 · 审计留痕
```

## 快速开始

```powershell
# 1) 安装依赖（npm workspaces）
npm install

# 2) 启动 MySQL 13306 / Redis 16379
npm run docker:up

# 3) 建表 + 写入初始数据，并校验数据契约
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

初始账号（密码均为 `角色名@2026` 规则，见 [STATUS](docs/STATUS.md) 第三章）：`admin / Admin@2026`、`secadmin / Sec@2026`、`compliance / Comp@2026`、`steward / Steward@2026`、`auditor / Audit@2026`、`ops / Ops@2026`、`depthead / Dept@2026`、`analyst / Analyst@2026`。

> 完整环境要求、端口与故障排查见 [部署运行手册](docs/部署运行.md)；数据基线重建统一使用 `npm run db:reset`。

## 各角色使用路径

| 顺序 | 角色 | 日常操作路径 | 预期结果 |
| --- | --- | --- | --- |
| 1 | admin 超级管理员 | 登录 → 总览 → 资产分级 → 合规检查执行 → 风险处置 → 权限调整 → 审计校验 → 运维工单 | 8 步串起完整治理链路，详见 [验收走查](docs/验收走查.md) |
| 2 | steward 数据管理员 | 资产台账筛选、调级、生命周期轨迹 | 调级后分级分布变化并留痕 |
| 3 | compliance 合规专员 | 规则库、执行检查、整改闭环 | 新批次生成，不通过项进入整改 |
| 4 | secadmin 安全管理员 | 风险事件处置、规则命中 | 未闭环数下降，看板 20 秒内同步 |
| 5 | auditor 审计员 | 四类日志、完整性校验、报表 | 只读可查，链校验返回完整 |
| 6 | ops 运维工程师 | 监控趋势、告警、工单流转、备份记录 | 工单四态流转并写轨迹 |
| 7 | depthead 部门主管 | 部门视角看板与资产 | 仅见本部门数据 |
| 8 | analyst 数据分析师 | 看板与资产只读 | 访问权限/审计页面被拒（403） |

## 业务流程与界面

下面按"资产 → 合规 → 风险 → 权限 → 审计 → 运维"的治理闭环串起一条 8 步业务流程，每一步嵌入对应的功能页面截图（截图存放于 `docs/screenshots/`，由 `npm run screenshots` 生成，单张 1440×900）。

### ① 统一身份登录 → ② 安全运营总览

登录页采用 JWT + 密码策略 + 连续 5 次失败锁定 30 分钟；登录后进入总览看板：一屏聚合资产、敏感资产、未闭环风险、待办工单、合规通过率，数字来自 27 张表实时聚合（缓存 20 秒）。

<div align="center">
<img src="docs/screenshots/01-login.png" width="48%" />　<img src="docs/screenshots/02-dashboard.png" width="48%" />
</div>

### ③ 数据资产治理（台账 → 分类分级 → 生命周期）

分级分类是治理起点：公开 / 内部 / 机密 / 绝密四级，调级会写生命周期留痕。页面包含台账筛选、调级、标签、生命周期轨迹、敏感度扫描与导出。

<div align="center">
<img src="docs/screenshots/03-asset-list.png" width="48%" />　<img src="docs/screenshots/04-asset-categories.png" width="48%" />
</div>

<div align="center">
<img src="docs/screenshots/05-asset-lifecycle.png" width="96%" />
</div>

### ④ 安全合规管理（规则库 → 执行检查 → 整改闭环 → 脱敏 → 共享审批 → 合规报告）

规则依据《数据安全法》《个人信息保护法》《等保 2.0》与行业规范；执行检查生成批次，不通过项进入整改池，整改闭环后自动更新合规报告。

<div align="center">
<img src="docs/screenshots/06-compliance-rules.png" width="48%" />　<img src="docs/screenshots/07-compliance-checks.png" width="48%" />
</div>

<div align="center">
<img src="docs/screenshots/08-compliance-rectify.png" width="48%" />　<img src="docs/screenshots/09-compliance-masking.png" width="48%" />
</div>

<div align="center">
<img src="docs/screenshots/10-compliance-approvals.png" width="48%" />　<img src="docs/screenshots/11-compliance-report.png" width="48%" />
</div>

### ⑤ 智能风险监测（风险事件 → 规则命中 → 实时监控）

覆盖越权访问、批量导出、异常登录、数据篡改、敏感外传五类异常事件，四级预警，处置全程留痕，看板 20 秒内同步未闭环数。

<div align="center">
<img src="docs/screenshots/12-risk-events.png" width="48%" />　<img src="docs/screenshots/13-risk-rules.png" width="48%" />
</div>

<div align="center">
<img src="docs/screenshots/14-risk-realtime.png" width="96%" />
</div>

### ⑥ 权限安全管控（用户 → 角色 → 菜单 → 接口，RBAC 四级 + 数据范围）

RBAC 四级：用户 - 角色 - 菜单/按钮 - 接口；数据范围 ALL / DEPT / SELF / CUSTOM 再叠加一层隔离。角色授权后需退出重登才能生效，体现"重新认证"。

<div align="center">
<img src="docs/screenshots/15-rbac-users.png" width="48%" />　<img src="docs/screenshots/16-rbac-roles.png" width="48%" />
</div>

<div align="center">
<img src="docs/screenshots/17-rbac-menus.png" width="48%" />　<img src="docs/screenshots/18-rbac-apis.png" width="48%" />
</div>

### ⑦ 安全审计追溯（四类日志 → SHA-256 完整性校验 → 报表）

登录 / 访问 / 操作 / 接口四类日志全量留痕；SHA-256 链式校验返回链完整性结果，用于验证日志未被篡改；支持日 / 周 / 月 / 年报表导出。

<div align="center">
<img src="docs/screenshots/19-audit-logs.png" width="48%" />　<img src="docs/screenshots/20-audit-reports.png" width="48%" />
</div>

### ⑧ 服务保障运维（监控 → 工单闭环 → 备份 → 配置 → 版本）

工单四态流转（新建 → 受理 → 处理 → 验证 → 关闭）并写轨迹；监控页 CPU / 内存 / QPS 有 24h 趋势；配合定时备份、配置与版本管理，构成服务保障闭环。

<div align="center">
<img src="docs/screenshots/21-ops-monitor.png" width="48%" />　<img src="docs/screenshots/22-ops-tickets.png" width="48%" />
</div>

<div align="center">
<img src="docs/screenshots/23-ops-backups.png" width="31%" />　<img src="docs/screenshots/24-ops-configs.png" width="31%" />　<img src="docs/screenshots/25-ops-versions.png" width="31%" />
</div>

> `docs/screenshots/` 目录下另外包含 6 张合规模块早期归档图（`compliance-*.png`），内容与 06～11 对应，可对照。

## 目录结构

```text
data-security-platform/
├─ api/                     # Express 5 + TypeScript 后端
│  ├─ db/                   # schema.sql、init.mjs、validate.mjs、seed/
│  └─ src/                  # app.ts、config、db、lib、middleware、modules（7 个）、routes
├─ web/                     # Vue 3 + Vite 前端
│  ├─ src/                  # api、components、layouts、router、stores、styles、utils、views（7 模块）
│  └─ e2e/                  # Playwright 用例
├─ docs/                    # 文档集（契约、状态、决策、矩阵、溯源、阶段报告、验收、走查、部署）
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
npm run db:reset     # 重建初始数据基线
npm run db:validate  # RESULT=PASS passed=69 failed=0
npm run build        # RESULT=PASS（api tsc + web vue-tsc/vite build）
npm run test:api     # RESULT=PASS passed=74 failed=0
npm run test:e2e     # 45 passed / 0 failed（2.4 分钟）
npm run check:docs   # RESULT=PASS
npm run verify       # RESULT=PASS passed=7 failed=0 用时=226.5s（7 项全 PASS）
```

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [大数据安全治理与服务保障平台.docx](docs/大数据安全治理与服务保障平台.docx) | 面向业务用户的图文操作手册：业务流程、页面功能与 25 张截图（Word，12 章） |
| [STATUS](docs/STATUS.md) | 当前阶段、计数基线、已知限制、下一步 |
| [接口契约](docs/接口契约.md) | V1.0 验收基线 + V1.1 响应结构 + V1.2 实现清单（81 条业务 + 2 条系统） |
| [DECISIONS](docs/DECISIONS.md) | 18 条技术决策与被否决备选方案 |
| [PLAN-MATRIX](docs/PLAN-MATRIX.md) | 90 工作日六阶段 → 五里程碑映射与能力矩阵 |
| [需求溯源](docs/需求溯源.md) | 方案 3.1–3.6 功能点 → 接口/页面/表 |
| [阶段报告](docs/阶段报告/) | M0 立项、M1 基座、M2 业务、M3 验收、M4 交付 |
| [验收清单](docs/验收清单.md) | 五类检查点与通过标准 |
| [验收走查](docs/验收走查.md) | 3–5 分钟 8 步走查路线 |
| [部署运行](docs/部署运行.md) | 环境、起停、重建、验证、FAQ |

## 能力边界与后续规划

本期平台已完成六大模块完整业务闭环与工程化交付，以下能力按当前范围实现，后续可按需替换或扩展：

1. **扫描、备份、监控采集、脱敏、哈希链校验**：本期以本地逻辑实现完整流程与数据留痕，接口契约稳定，后续可替换为真实扫描器、备份系统、监控采集与脱敏引擎（见 [DECISIONS](docs/DECISIONS.md) D-012）。
2. **部署形态**：当前为 Node 进程 + Docker Compose 单机部署，可满足内网试用与项目验收；生产化部署建议补充 Nginx 反向代理、PM2 进程守护与多实例（D-015）。
3. **规模化能力**：K8s 编排、多租户隔离、SIEM/态势平台对接不在本期范围，接口层已预留扩展点。
4. **工程状态**：25 个前端视图与 25 张交付截图齐备，`npm run verify` 7/7 PASS，最新提交与阶段进度以 [STATUS](docs/STATUS.md) 为准。
