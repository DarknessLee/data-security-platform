# 技术决策记录（DECISIONS / ADR）

> 范围：大数据安全治理与服务保障平台（软著演示版）V1.0.0　记录人：docs-owner
> 规则：一条决策一行；编号只增不改；改变既有决策时以新编号追加并在影响面注明替代关系。
> 状态说明：所有决策均面向"可运行、可演示、可验收"的演示版；标注"暂缓/不做"的条目在 [PLAN-MATRIX.md](PLAN-MATRIX.md) 中同步。

## 一、决策记录一览

| 编号 | 日期 | 决策 | 理由 | 影响面 |
| --- | --- | --- | --- | --- |
| D-001 | 2026-11-07 | 目录固定为 `api/`、`web/`、`docs/`、`scripts/`；端口固定 API 8081、Web 5174、MySQL 13306、Redis 16379 | 避开本机已占用的 80/3306/6379/5173 等常用端口；四目录边界与接口契约、前端约定、门禁脚本一一对应 | `docker-compose.yml`、`api/src/config/env.ts`、`web/vite.config.ts`、全部文档 |
| D-002 | 2026-11-07 | 技术栈锁定：后端 Node 20+（实测 v24）/ Express 5 / TypeScript ESM / mysql2 / ioredis / jsonwebtoken / bcryptjs / zod；前端 Vue 3 组合式 API / Vite 7 / Element Plus / Pinia / Vue Router 4 / Axios / ECharts；数据层 MySQL 8.0 + Redis 7（Docker） | 与开发方案一致、生态成熟、单机一键起停；演示不需要额外中间件 | `api/package.json`、`web/package.json`、`docs/前端开发约定.md` |
| D-003 | 2026-11-07 | 数据访问用 mysql2 连接池 + 原生 SQL，不引入 ORM / 查询构造器；连接池 `connectionLimit: 12`、`utf8mb4`、`dateStrings: ['DATE']` | 27 张表演示库 SQL 可读、可审计、易定位慢查询；避免 ORM 隐式联表与 N+1；无迁移框架负担 | `api/src/db/pool.ts`、`api/src/modules/**`、`api/db/schema.sql` |
| D-004 | 2026-11-07 | `api/db/schema.sql` 是表结构单一真源；`api/db/init.mjs` 每次 DROP 27 表后重建并重放种子，不引入增量 migration | 演示态必须可一键重建、计数可断言；单一真源杜绝手工改表导致的结构漂移 | `api/db/schema.sql`、`api/db/init.mjs`、`docs/部署运行.md` |
| D-005 | 2026-11-07 | 种子确定性：`mulberry32(20261107)` 固定随机流 + `BASE_TIME = 初始化时刻` + 固定播种顺序 `seedReference → loadUsers → seedAssets → seedCompliance → seedRisk → seedAudit → seedOps` | 重放后计数可断言；日期始终贴近"现在"，"最近 7 天""近 24 小时"演示不会过期 | `api/db/seed/**`、`api/db/validate.mjs`、`docs/STATUS.md` 计数基线 |
| D-006 | 2026-11-07 | 认证采用 JWT（HS256，12 小时，载荷 `sub/username`）+ bcrypt（cost 10）；登录失败 5 次锁定 30 分钟（Redis 计数）；密码 ≥10 位且含大小写字母、数字、特殊字符，不得与旧密码相同 | 方案 3.4 要求密码策略与防暴力破解；锁定策略可在演示中现场触发 | `api/src/modules/auth/router.ts`、`sys_config` 的 4 个安全项、`PUT /auth/password` |
| D-007 | 2026-11-07 | 授权模型为 RBAC 四级：用户-角色-菜单/按钮-接口；`sys_role_menu` 带 `perm_read/perm_write`，`sys_role_api` 控制接口授权；代码层以 `requirePerm(moduleCode, 'read'|'write')` 收口 | 方案 3.4 明确四级模型；菜单可见性（前端隐藏）与接口权限（后端强校验）分离，防止绕过页面直调 | `api/src/middleware/auth.ts`、`sys_menu`、`sys_api_permission`、`/rbac/*` |
| D-008 | 2026-11-07 | 数据级权限由角色 `data_scope` 决定：`ALL` 全量 / `DEPT` 本部门 / `SELF` 仅本人（`CUSTOM` 保留未启用）；统一由 `dataScopeFilter(user, alias, deptColumn, selfColumn)` 生成 WHERE 片段 | 方案 3.4 要求数据隔离；单函数收口防止各接口漏加条件 | `api/src/middleware/auth.ts`、`sys_role.data_scope`、资产/风险/工单等列表接口 |
| D-009 | 2026-11-07 | Redis 只做缓存与计数，不承载正确性：`cached(key, ttl, loader)` 在 Redis 未就绪或异常时直接回源；失效用 `SCAN` 清理；`enableOfflineQueue: false` 让故障快速失败 | 演示环境 Redis 可能未启动，平台核心功能仍须可用；`SCAN` 避免 `KEYS` 阻塞 | `api/src/db/redis.ts`、看板/鉴权缓存、登录失败计数 |
| D-010 | 2026-11-07 | 看板 `/dashboard/overview` 按数据范围（`all` / `dept:<id>`）缓存 20 秒 | 聚合 8 张表，20 秒兼顾首屏性能与"演示实时感"；高频刷新不打满数据库 | `api/src/modules/dashboard/router.ts`、`docs/演示脚本.md` 的注意项 |
| D-011 | 2026-11-07 | 审计自动落库：全局中间件在认证用户的写请求 `res.finish` 后写 `audit_log`（类型"操作日志"，`statusCode<400` 记成功）；登录/失败登录写"登录日志"；落库失败静默不阻断业务 | 方案 3.5 要求全量留痕；中间件统一收口，避免各模块漏写或口径不一 | `api/src/middleware/audit.ts`、`audit_log` 表、审计页面 |
| D-012 | 2026-11-07 | 以下能力采用演示级近似并明确标注：资产扫描（模拟扫描 + 重算敏感度分）、备份（生成记录与校验和）、监控指标（155 点模拟采集）、审计不可篡改（SHA-256 哈希链校验）、脱敏（按规则生成掩码结果）、共享审批（单级审批） | 演示聚焦业务闭环与可交互，不接入真实扫描器 / 备份系统 / 监控采集 / 脱敏引擎 | `/assets/scan`、`/ops/backups`、`/ops/metrics`、`/audit/integrity`、`/compliance/masking/:id/test` |
| D-013 | 2026-11-07 | 演示数据规范：真实业务词库命名，禁止 test/seed/临时字样；四类日志、四级分级、四种工单状态全覆盖；每角色至少 1 条菜单授权与 1 条接口授权（保证"允许"用例），数据范围构造"拒绝"用例 | 手册演示数据规范 + `api/db/validate.mjs` 的 8 条演示规范断言；保证每个角色都能演示允许与拒绝 | `api/db/seed/**`、`sys_role_menu`/`sys_role_api` 授权矩阵 |
| D-014 | 2026-11-07 | 文档门禁：STATUS / DECISIONS / PLAN-MATRIX / 需求溯源 / 阶段报告 / 部署运行 / 验收清单 / 演示脚本 + `scripts/check-docs.mjs`；计数基线集中在 [STATUS.md](STATUS.md) 第二章，其它文档只引用不另立 | 手册要求"必需文档齐、链接与数字不矛盾"；基线集中可避免多文档同步漂移 | `docs/**`、`scripts/check-docs.mjs`、README 文档索引 |
| D-015 | 2026-11-07 | 明确不做：K8s、多租户、真实脱敏引擎、SIEM 对接、软著登记材料、真实邮件/短信通道、Nginx/PM2 多实例、生产级 migration | 超出演示边界，投入产出比低；把资源集中在六大模块闭环与验收材料 | README、PLAN-MATRIX、验收清单的"暂缓/不做"口径 |
| D-016 | 2026-11-07 | 前端工程约定：Vite 代理 `/api → 8081`，令牌与用户信息存 `localStorage`（`datasec_token` / `datasec_user`），路由守卫按 `canRead` 拦截页面，Axios 统一处理 401 跳登录、403 提示；公共组件与布局归 Lead，模块负责人只写 `views/<module>`、`api/<module>.ts`、`e2e/<module>.spec.ts` | 6 位模块负责人并行开发，必须按目录划清写入边界，避免互相覆盖 | `web/src/api/client.ts`、`web/src/stores/auth.ts`、`web/src/router/index.ts`、`docs/前端开发约定.md` |
| D-017 | 2026-11-07 | 看板数据范围过滤按查询别名拆两套拼接：`loadOverview(userId, plainScope, aliasedScope, scopeParams)`，无别名查询拼 `AND dept_id = ?` / `AND username = ?`，join 查询拼 `AND e.dept_id = ?`；缓存 key 分 `all` / `dept-<id>` / `self-<username>` | `risk_event` 等为独立查询、无 `e` 别名，统一拼 `e.dept_id` 会触发 `Unknown column 'e.dept_id'` 500；拆分后 DEPT/SELF 收敛正确且缓存互不串号 | `api/src/modules/dashboard/router.ts`、看板缓存 key；已验证 admin/steward/depthead/analyst/compliance/ops 全部 200，DEPT 仅见本部门 |
| D-018 | 2026-11-07 | 角色菜单授权自动补齐模块子菜单：`reference.mjs` 用 `moduleChildMenuIds` 记录各模块二级菜单，授权顶级目录时按同 read/write 标记一并授权子菜单；`validate.mjs` 增加"已授权模块均包含二级菜单"检查 | 种子最初只授权 7 个顶级目录，侧边栏 `children` 为空、无法进入子页面；补齐后 admin 返回 7 个顶级菜单（子项 0/3/6/3/4/2/5），analyst 返回 5 个（0/3/6/3/5） | `api/db/seed/reference.mjs`、`sys_role_menu`、`api/db/validate.mjs` 第 69 项检查、侧边栏渲染 |

## 二、被否决的备选方案

| 备选方案 | 否决原因 |
| --- | --- |
| Prisma / TypeORM 等 ORM | 27 张表、聚合统计多，ORM 生成的隐式查询难以核对；演示需要 SQL 直读以讲清"数据从哪来" |
| React + Ant Design | 开发方案已锁定 Vue 3 + Element Plus；更换会推翻前端约定与人员分工 |
| JWT 放 HttpOnly Cookie + CSRF Token | 演示版前后端同机、单点登录，localStorage + Bearer 更直观；CSRF 防护列为生产化待办 |
| WebSocket / SSE 推送实时指标 | 轮询 + 20 秒看板缓存已满足 3–5 分钟演示；引入长连接增加部署复杂度 |
| 接入真实漏洞扫描器 / 脱敏引擎 | 需额外服务与授权，演示收益低；以"演示级近似"表达流程完整度 |
| 一库多实例 / 分库分表 | 单机演示无数据量压力，反而增加重建与验收成本 |
| 增量 migration（Flyway 类） | 演示态以"可重放重建"为第一优先级；生产化再补（D-004、D-015） |

## 三、维护约定

1. 新增决策使用下一个编号（D-017 起），不改写历史条目；决策被推翻时新增一条并在"理由"中注明替代关系。
2. 影响面必须写到具体文件或表/接口，便于执行与验收时核对。
3. 涉及计数的决策（D-005、D-013）以 [STATUS.md](STATUS.md) 的基线表为准；修改计数须同步 `scripts/check-docs.mjs` 的基线常量与 `api/db/validate.mjs`。
4. 文档与实现冲突时，先判定是"实现偏差"还是"决策过期"：实现偏差记入阶段报告"偏差"段；决策过期按第 1 条追加新决策。
