<template>
  <section class="page risk-rules">
    <PageHeader title="监测规则" subtitle="智能风险监测 · 规则配置与命中效果">
      <el-button :loading="loading" icon="Refresh" @click="load">刷新</el-button>
      <el-tag type="info" effect="plain">只读账号仅可查看</el-tag>
    </PageHeader>

    <div class="stat-grid">
      <StatCard label="规则总数" :value="rules.length" unit="条" tone="primary" hint="覆盖 5 类风险事件" />
      <StatCard label="启用中" :value="enabledCount" unit="条" tone="success" hint="启用后实时参与监测" />
      <StatCard label="已停用" :value="rules.length - enabledCount" unit="条" tone="info" hint="停用规则不再产生新告警" />
      <StatCard label="累计命中" :value="totalHits" unit="次" tone="warning" hint="规则命中已形成风险事件" />
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="关键词">
          <el-input v-model="query.keyword" clearable placeholder="规则编号/名称/表达式" style="width: 230px" />
        </el-form-item>
        <el-form-item label="事件类型">
          <el-select v-model="query.eventType" clearable placeholder="全部类型" style="width: 140px">
            <el-option v-for="t in EVENT_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用状态">
          <el-select v-model="query.enabled" clearable placeholder="全部状态" style="width: 130px">
            <el-option label="已启用" :value="1" />
            <el-option label="已停用" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" icon="Search" @click="load">查询</el-button>
          <el-button icon="RefreshLeft" @click="resetQuery">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="content-card">
      <template #header>
        <div class="section-title">
          <span>规则列表</span>
          <span class="sub">命中次数按全量风险事件统计，条形对比便于识别高风险规则</span>
        </div>
      </template>

      <el-table v-loading="loading" :data="rules" stripe data-testid="risk-rule-table" row-key="id">
        <el-table-column label="规则编号" width="120">
          <template #default="{ row }"><span class="mono">{{ row.rule_code }}</span></template>
        </el-table-column>
        <el-table-column label="规则名称 / 检测表达式" min-width="290">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="title">{{ row.rule_name }}</span>
              <span class="sub mono">{{ row.expression }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="event_type" label="事件类型" width="110" />
        <el-table-column label="风险级别" width="90">
          <template #default="{ row }"><StatusTag :value="row.level" /></template>
        </el-table-column>
        <el-table-column label="命中次数对比" min-width="220" sortable prop="hit_count">
          <template #default="{ row }">
            <div class="hit-cell">
              <el-progress
                :percentage="hitPercent(row.hit_count)"
                :stroke-width="10"
                :show-text="false"
                :color="hitColor(row.level)"
                class="hit-bar"
              />
              <span class="mono hit-count">{{ row.hit_count }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="启用状态" width="110" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.enabled"
              :disabled="!auth.canWrite('risk') || switching === row.id"
              :loading="switching === row.id"
              inline-prompt
              active-text="启"
              inactive-text="停"
              @change="(val: string | number | boolean) => onToggle(row, val)"
            />
          </template>
        </el-table-column>
        <el-table-column prop="updated_at" label="更新时间" width="170" />
        <template #empty><EmptyState description="暂无监测规则" /></template>
      </el-table>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import StatusTag from '@/components/StatusTag.vue';
import EmptyState from '@/components/EmptyState.vue';
import { getRules, toggleRule, type RiskRule } from '@/api/risk';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

const EVENT_TYPES = ['越权访问', '批量导出', '异常登录', '数据篡改', '敏感外传'];

const rules = ref<RiskRule[]>([]);
const loading = ref(false);
const switching = ref<number | null>(null);

const query = reactive<{ keyword: string; eventType: string; enabled: 0 | 1 | '' }>({
  keyword: '',
  eventType: '',
  enabled: '',
});

const enabledCount = computed(() => rules.value.filter((r) => r.enabled).length);
const totalHits = computed(() => rules.value.reduce((sum, r) => sum + r.hit_count, 0));
const maxHits = computed(() => Math.max(1, ...rules.value.map((r) => r.hit_count)));

function hitPercent(hits: number): number {
  return Math.round((hits / maxHits.value) * 100);
}

function hitColor(level: string): string {
  if (level === '紧急') return '#e5484d';
  if (level === '高') return '#f76808';
  if (level === '中') return '#d4a000';
  return '#3b82f6';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await getRules({
      keyword: query.keyword.trim() || undefined,
      eventType: query.eventType || undefined,
      enabled: query.enabled === '' ? undefined : query.enabled,
    });
    rules.value = res.data.sort((a, b) => b.hit_count - a.hit_count);
  } finally {
    loading.value = false;
  }
}

function resetQuery(): void {
  Object.assign(query, { keyword: '', eventType: '', enabled: '' });
  load();
}

async function onToggle(rawRow: unknown, rawNext: unknown): Promise<void> {
  const row = rawRow as RiskRule;
  const next = Boolean(rawNext);
  try {
    await ElMessageBox.confirm(
      `确认${next ? '启用' : '停用'}规则「${row.rule_name}」吗？${next ? '启用后将实时参与风险监测。' : '停用后不再产生新的风险告警。'}`,
      '启停监测规则',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return; // 用户取消，开关保持原值
  }
  switching.value = row.id;
  try {
    const res = await toggleRule(row.id, next);
    const target = rules.value.find((r) => r.id === row.id);
    if (target) target.enabled = res.data.enabled;
    ElMessage.success(`规则 ${row.rule_code} 已${res.data.enabled ? '启用' : '停用'}`);
  } finally {
    switching.value = null;
  }
}

onMounted(load);
</script>

<style scoped>
.hit-cell { display: flex; align-items: center; gap: 10px; }
.hit-bar { flex: 1; }
.hit-count { min-width: 32px; text-align: right; font-weight: 600; color: #23324a; }
</style>
