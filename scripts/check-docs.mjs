#!/usr/bin/env node
/**
 * 文档门禁（check-docs）
 * 用法：node scripts/check-docs.mjs   （根目录 npm run check:docs）
 * 校验：必需文档存在且非空、关键章节齐全、STATUS 计数基线与实现一致、
 *       接口契约覆盖 7 模块、阶段报告六段结构、无 TODO/占位标记、文档内相对链接可解析。
 * 输出：逐项 PASS/FAIL，末行 RESULT=PASS|FAIL passed=N failed=M 用时=S
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const started = Date.now();

let passed = 0;
let failed = 0;
const pass = (name) => {
  passed += 1;
  console.log(`PASS ${name}`);
};
const fail = (name, actual) => {
  failed += 1;
  console.log(`FAIL ${name} ${actual}`);
};
const check = (name, fn) => {
  try {
    const detail = fn();
    if (detail === false || (typeof detail === 'string' && detail.length > 0)) {
      fail(name, typeof detail === 'string' ? detail : '不满足');
      return;
    }
    pass(name);
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  }
};

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const sizeOf = (rel) => statSync(join(ROOT, rel)).size;
const has = (text, needles) => {
  const missing = needles.filter((n) => !text.includes(n));
  return missing.length === 0 ? null : `缺少：${missing.join('、')}`;
};
const lines = (text) => text.replace(/\r\n/g, '\n').trimEnd().split('\n');
const countOf = (text, re) => (text.match(re) || []).length;

// ---------- 1. 五类必备文档 ----------
const CLASSES = [
  ['状态', 'docs/STATUS.md'],
  ['决策', 'docs/DECISIONS.md'],
  ['计划', 'docs/PLAN-MATRIX.md'],
  ['接口契约', 'docs/接口契约.md'],
  ['阶段报告', 'docs/阶段报告'],
];
check('五类必备文档齐全（状态/决策/计划/契约/阶段报告）', () => {
  const missing = CLASSES.filter(([, rel]) => !existsSync(join(ROOT, rel))).map(([name]) => name);
  return missing.length === 0 ? null : `缺少：${missing.join('、')}`;
});

// ---------- 2. 逐份文档：存在、>500 字节、关键章节 ----------
const DOCS = [
  {
    rel: 'docs/STATUS.md',
    name: '状态文档',
    headings: ['## 一、当前阶段', '## 二、演示态重建与关键计数', '## 三、运行入口与演示账号', '## 四、下一步', '## 五、已知限制'],
  },
  {
    rel: 'docs/DECISIONS.md',
    name: '决策记录',
    headings: ['## 一、决策记录一览', '## 二、被否决的备选方案'],
    extra: (t) => {
      const rows = countOf(t, /^\|\s*D-\d{3}\s*\|/gm);
      if (rows < 18) return `决策条数 ${rows}，应 ≥18`;
      if (!t.includes('D-001')) return '缺少 D-001';
      return has(t, ['D-017', 'D-018']);
    },
  },
  {
    rel: 'docs/PLAN-MATRIX.md',
    name: '计划矩阵',
    headings: ['## 一、90 工作日六阶段 → Demo 里程碑映射', '## 二、能力落地矩阵', '## 三、里程碑出口条件'],
    extra: (t) => has(t, ['已实现', '部分', '暂缓', '不做', 'M0', 'M1', 'M2', 'M3', 'M4']),
  },
  {
    rel: 'docs/需求溯源.md',
    name: '需求溯源',
    headings: ['## 一、总览', '## 二、3.1 数据资产治理', '## 七、3.6 服务保障运维', '## 八、非功能性需求溯源'],
  },
  {
    rel: 'docs/部署运行.md',
    name: '部署运行手册',
    headings: ['## 一、环境要求', '## 二、首次安装与启动', '## 五、常见问题（FAQ）'],
    extra: (t) => has(t, ['docker:up', 'db:reset', '13306', '16379', '8081', '5174']),
  },
  {
    rel: 'docs/验收清单.md',
    name: '验收清单',
    headings: ['## 二、五道门禁验收', '## 四、角色权限验收（每角色 1 允许 + 1 拒绝）', '## 六、验收结论'],
    extra: (t) => has(t, ['build', 'test:api', 'test:e2e', 'db:validate', 'check:docs']),
  },
  {
    rel: 'docs/演示脚本.md',
    name: '演示脚本',
    headings: ['## 二、演示步骤', '## 三、演示注意事项'],
    extra: (t) => has(t, ['风险处置', '审计校验', '运维工单', 'admin']),
  },
  {
    rel: 'README.md',
    name: '项目说明',
    headings: ['## 快速开始', '## 演示路线（按角色）', '## 目录结构', '## 技术栈'],
    extra: (t) => has(t, ['docs/screenshots/', 'npm run dev', '25 张']),
  },
];

for (const doc of DOCS) {
  check(`${doc.name}存在且非空（${doc.rel}）`, () => {
    if (!existsSync(join(ROOT, doc.rel))) return '文件不存在';
    const size = sizeOf(doc.rel);
    return size > 500 ? null : `文件仅 ${size} 字节（应 >500）`;
  });
  check(`${doc.name}关键章节齐全`, () => has(read(doc.rel), doc.headings));
  if (doc.extra) check(`${doc.name}内容要点齐全`, () => doc.extra(read(doc.rel)));
}

// ---------- 3. STATUS 计数基线（唯一真源） ----------
const BASELINE = {
  数据表: 27,
  部门: 6,
  用户: 9,
  角色: 8,
  '用户-角色关系': 9,
  菜单: 30,
  '角色-菜单授权': 54,
  接口权限: 43,
  '角色-接口授权': 199,
  平台配置: 12,
  站内通知: 10,
  资产分类: 8,
  数据资产: 64,
  资产标签: 156,
  生命周期记录: 257,
  合规规则: 20,
  合规检查结果: 100,
  整改单: 22,
  脱敏规则: 10,
  共享审批单: 18,
  风险规则: 10,
  风险事件: 48,
  审计日志: 331,
  审计报表: 5,
  服务工单: 22,
  工单轨迹: 88,
  备份记录: 14,
  监控指标点: 155,
};

const parseBaseline = (text) => {
  const map = new Map();
  for (const line of lines(text)) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*$/);
    if (!m) continue;
    const label = m[1].trim();
    if (label === '基线项' || label.startsWith('---')) continue;
    map.set(label, Number(m[3]));
  }
  return map;
};

const statusText = read('docs/STATUS.md');
const baselineRows = parseBaseline(statusText);
check('STATUS 计数基线表为 28 项（27 张表 + 表总数行）', () => {
  const n = baselineRows.size;
  return n === 28 ? null : `实际 ${n} 项`;
});
for (const [label, expected] of Object.entries(BASELINE)) {
  check(`基线一致：${label}=${expected}`, () => {
    if (!baselineRows.has(label)) return 'STATUS 中缺少该行';
    const actual = baselineRows.get(label);
    return actual === expected ? null : `实际 ${actual}（应为 ${expected}）`;
  });
}
check('STATUS 含当前阶段与更新时间', () => has(statusText, ['M2', 'M3', '更新时间']));
check('STATUS 记录 69 项数据门禁与 83 条已注册路由', () => has(statusText, ['passed=69', '83 条', '81 条']));

// ---------- 4. 接口契约 ----------
const contract = read('docs/接口契约.md');
check('接口契约含 7 个模块（dashboard + 六大模块）', () => {
  const modules = ['GET /dashboard/overview', '## 三、数据资产治理', '## 四、安全合规管理', '## 五、智能风险监测', '## 六、权限安全管控', '## 七、安全审计追溯', '## 八、服务保障运维'];
  return has(contract, modules);
});
check('接口契约包含 82 条接口', () => {
  const cut = contract.indexOf('## 十一、V1.2 实现接口清单');
  const v10 = cut > 0 ? contract.slice(0, cut) : contract;
  const n = countOf(v10, /^\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|/gm);
  return n === 82 ? null : `实际 ${n} 条`;
});
check('接口契约含 V1.1 响应结构对齐', () => has(contract, ['V1.1', '响应结构对齐']));
check('接口契约含 V1.2 实现接口清单（81 条业务 + 2 条系统）', () => {
  const idx = contract.indexOf('## 十一、V1.2 实现接口清单');
  if (idx < 0) return '缺少第十一章（V1.2 实现接口清单）';
  const end = contract.indexOf('## 十二、变更记录', idx);
  const section = end > idx ? contract.slice(idx, end) : contract.slice(idx);
  const n = countOf(section, /^\|\s*[^|]+\s*\|\s*(?:GET|POST|PUT|DELETE)\s*\|\s*`\/api\//gm);
  if (n !== 81) return `实际 ${n} 条业务接口`;
  return has(section, ['81 条业务接口', '83 条已注册路由', 'V1.0 契约的 82 条验收基线']);
});

// ---------- 5. 阶段报告 M0–M4 ----------
const REPORT_DIR = 'docs/阶段报告';
const REPORTS = ['M0-立项报告.md', 'M1-基座报告.md', 'M2-业务开发报告.md', 'M3-验收报告.md', 'M4-交付报告.md'];
const SECTIONS = ['范围与判据', '交付物', '验证结果', '偏差', '遗留与已知限制', '结论'];
for (const file of REPORTS) {
  const rel = `${REPORT_DIR}/${file}`;
  check(`阶段报告存在：${file}`, () => {
    if (!existsSync(join(ROOT, rel))) return '文件不存在';
    return sizeOf(rel) > 500 ? null : '文件过小';
  });
  check(`阶段报告六段结构：${file}`, () => {
    const text = read(rel);
    const missing = SECTIONS.filter((s) => !new RegExp(`^##[^\\n]*${s}`, 'm').test(text));
    return missing.length === 0 ? null : `缺段：${missing.join('、')}`;
  });
  check(`阶段报告行数≤60：${file}`, () => {
    const n = lines(read(rel)).length;
    return n <= 60 ? null : `实际 ${n} 行`;
  });
}

// ---------- 6. 无 TODO / 占位标记 ----------
const MARKDOWN_FILES = [
  ...readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
  ...readdirSync(join(ROOT, REPORT_DIR)).filter((f) => f.endsWith('.md')).map((f) => `${REPORT_DIR}/${f}`),
  'README.md',
];
check('文档无 TODO/FIXME/待补充等占位标记', () => {
  const bad = [];
  for (const rel of MARKDOWN_FILES) {
    const hits = read(rel).match(/TODO|FIXME|待补充|TBD|占位待填/g);
    if (hits) bad.push(`${rel}(${hits.join(',')})`);
  }
  return bad.length === 0 ? null : bad.join('；');
});

// ---------- 7. 文档内相对链接可解析 ----------
check('文档内相对链接全部可解析', () => {
  const bad = [];
  for (const rel of MARKDOWN_FILES) {
    const dir = dirname(join(ROOT, rel));
    const re = /\]\(([^)\s]+?\.md)\)/g;
    let m;
    while ((m = re.exec(read(rel))) !== null) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const abs = normalize(join(dir, target));
      if (!existsSync(abs) || !statSync(abs).isFile()) bad.push(`${rel} → ${target}`);
    }
  }
  return bad.length === 0 ? null : bad.slice(0, 5).join('；');
});

// ---------- 8. 文档集规模 ----------
check('文档集规模（≥12 份 Markdown）', () => {
  const n = MARKDOWN_FILES.length;
  return n >= 12 ? null : `实际 ${n} 份`;
});

// ---------- 汇总 ----------
const seconds = ((Date.now() - started) / 1000).toFixed(2);
console.log(`RESULT=${failed === 0 ? 'PASS' : 'FAIL'} passed=${passed} failed=${failed} 用时=${seconds}s`);
if (failed > 0) process.exitCode = 1;
