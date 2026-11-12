# 项目状态（STATUS）

> 平台：大数据安全治理与服务保障平台　版本：V1.0.0　更新时间：2026-11-07 10:49

## 一、当前阶段

**M3 验收收口**（M0 立项、M1 基座、M2 业务开发已完成）。数据基座（27 张表 + 可重放初始数据）、接口契约（V1.0 验收基线 + V1.1 响应结构 + V1.2 实现清单）、认证与安全策略、RBAC 与数据范围、自动审计、看板、健康检查与平台元信息均已落地；六大业务模块后端与前端 24 个业务页面全部合入，25 张交付截图已生成，五道门禁实测全绿。全量 `node scripts/verify.mjs` 已 7/7 PASS（174.6s），Git 已提交 9a55663（M1）与 92dcce6（M2/M3）；待按 `docs/验收清单.md` 签字后转入 M4 交付。

| 项 | 内容 |
| --- | --- |
| 项目版本 | V1.0.0（`sys_config.platform.version`） |
| 当前阶段 | M3 验收（全量 verify 7/7 PASS，待验收清单签字） |
| 最新提交 | 6945d9c（统一对外表述口径）；前一提交 92dcce6（M2/M3 交付）、9a55663（M1 基座） |
| 数据门禁 | `node api/db/validate.mjs` → `RESULT=PASS passed=69 failed=0`（第 69 项：已授权模块均包含二级菜单） |
| 接口口径 | 已注册路由 **83 条**：业务接口 **81 条**（assets 12、compliance 18、risk 10、rbac 14、audit 8、ops 12、dashboard 1、auth 6）+ 系统接口 2 条（`/health`、`/meta`）；契约 V1.0 的 82 条验收基线已全部覆盖，清单见 `docs/接口契约.md` 第十一章（V1.2） |
| 门禁链 | `db:reset → db:validate（69/69）→ build（RESULT=PASS）→ test:api（74/74）→ test:e2e（45/45，2.4 分钟）→ check:docs（76/76）→ verify（RESULT=PASS passed=7 failed=0 用时=174.6s）` |
| 最近验收 | E2E 6 个 spec 共 45 条全 PASS（asset 8、audit 7、compliance 7、ops 8、rbac 8、risk 7）；截图 `RESULT=PASS count=25`；admin 登录返回 7 个顶级菜单（子项 0/3/6/3/4/2/5） |
| 更新时间 | 2026-11-12 10:05 |

## 二、数据基线重建与关键计数

重建命令（任选其一，`db:init` 与 `db:reset` 等价，均会重放全部种子）：

```powershell
node api/db/init.mjs        # 或 npm run db:init / npm run db:reset
node api/db/validate.mjs    # 69 项计数/约束/外键/数据规范断言，末行 RESULT=
```

下表是文档引用的**唯一计数基线**，其它文档只引用、不另立数字；重建后计数保持不变（`todayLogs` 随初始化时刻浮动，见已知限制）。**门禁与验收前必须先 `db:reset`**，避免运行期写入的工单/备份/日志使计数断言偏移。

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

关键分布（看板与验收走查口径）：

| 维度 | 分布 |
| --- | --- |
| 资产分级 | 公开 4 / 内部 27 / 机密 20 / 绝密 13（敏感资产 33） |
| 资产状态 | 正常 52 / 待治理 6 / 风险 5 / 已归档 1 |
| 合规检查 | 5 个批次（CHK-2026-001～005）各 20 条，每批通过 14 条，最近批次通过率 70% |
| 风险事件 | 等级：低 3 / 中 13 / 高 18 / 紧急 14；状态：待处置 4 / 处置中 5 / 已处置 26 / 已忽略 13（未闭环 9，其中高+紧急 6） |
| 服务工单 | 待受理 3 / 处理中 4 / 待验证 2 / 已关闭 13（待处理 9） |
| 整改单 | 待整改 6 / 整改中 1 / 已逾期 5 / 已闭环 10（闭环率 45%） |
| 备份记录 | 成功 13 / 失败 1 |
| 审计日志 | 覆盖连续 7 个自然日，四类日志：登录 / 访问 / 操作 / 接口；初始化后约 331 条，运行期的登录与操作会继续追加 |

## 三、运行入口与初始账号

| 项 | 地址 / 说明 |
| --- | --- |
| API 服务 | `http://127.0.0.1:8081/api`（Express 5，`npm run api`） |
| Web 前端 | `http://127.0.0.1:5174`（Vite，`npm run web`；25 个视图已全部实装） |
| MySQL | Docker 容器 `datasec-mysql`，`127.0.0.1:13306`，库 `datasec` |
| Redis | Docker 容器 `datasec-redis`，`127.0.0.1:16379` |
| 健康检查 | `GET /api/health`（无需鉴权） |
| 初始账号 | admin / Admin@2026（超级管理员）、secadmin / Sec@2026、compliance / Comp@2026、steward / Steward@2026、auditor / Audit@2026、ops / Ops@2026、depthead / Dept@2026、analyst / Analyst@2026 |

## 四、下一步

1. Lead 执行 `npm run verify`（串行五门禁 + 重播种）并回填汇总末行到本文件与 M3 报告。
2. Lead 完成 Git 首次提交后，回填本表"最新提交"与各阶段报告提交号。
3. 按 `docs/验收清单.md` 逐项勾选并签字，M3 结论改为"通过"。
4. 按 `docs/验收走查.md` 计时走查（25 张截图已就绪，可对照讲解）。
5. M4 交付：按 `docs/部署运行.md` 复现部署，归档交付物与交接说明。

## 五、已知限制

| 编号 | 限制 | 状态与处理 |
| --- | --- | --- |
| L-01 | 前端 16 个业务页面曾为骨架占位 | 已修复：25 个视图（登录 + 24 业务页）全部实装，无"页面建设中"占位 |
| L-02 | Web 构建曾有 3 个页面 9 处 `el-table` 行类型错误 | 已修复：`npm run build` → `RESULT=PASS`（api tsc 0 错误、web vue-tsc 0 错误 + vite build 成功） |
| L-03 | 交付截图曾缺失 | 已修复：`npm run screenshots` → `RESULT=PASS count=25`（`01-login.png`～`25-ops-versions.png`），README 截图区已回填 |
| L-04 | 目录曾未初始化 Git 仓库 | 已修复：Git 已初始化，9a55663（M1）+ 92dcce6（M2/M3）+ 6945d9c（表述口径统一） |
| L-05 | Docker CLI 未加入当前 PowerShell 的 PATH，但容器已运行 | 环境提示：用 Docker Desktop 绝对路径或 `DOCKER_PATH`，见部署运行手册 FAQ |
| L-06 | 看板 `todayLogs` 以初始化时刻为基准、且运行期会持续写入登录/操作日志 | 数值随初始化时刻与访问量浮动，其余计数固定 |
| L-07 | 资产扫描、备份、监控指标、哈希链校验、脱敏试运行为简化实现 | 不接入真实扫描器 / 备份系统 / 监控采集 / 真实脱敏引擎（D-012） |
| L-08 | 性能目标（≤500ms）与可用率目标（≥99.9%）未压测、未承诺 | 运行环境为单机单实例，Nginx / PM2 多实例暂缓（D-015） |
| L-09 | 接口联调曾在库内留下 1 张工单、2 条备份及若干日志 | 已修复：重建后 `db:validate` 69/69 全 PASS |
| L-10 | 看板 DEPT/SELF 数据范围曾因统一拼 `e.dept_id` 触发 500 | 已修复：按查询别名拆两套拼接，admin/steward/depthead/analyst/compliance/ops 全部 200（D-017） |
| L-11 | 侧边栏曾无二级菜单（种子只授权 7 个顶级目录） | 已修复：角色授权自动补齐子菜单，admin 子项 0/3/6/3/4/2/5、analyst 0/3/6/3/5（D-018，validate 第 69 项） |
