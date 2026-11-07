<template>
  <div class="page">
    <PageHeader title="平台配置" subtitle="平台基础信息、安全策略、数据治理、风险监测与运维保障参数">
      <el-button :loading="loading" @click="load">刷新</el-button>
    </PageHeader>

    <el-card v-loading="loading" shadow="never" class="content-card">
      <el-tabs v-model="activeTab">
        <el-tab-pane v-for="g in groups" :key="g.group" :name="g.group" :label="`${g.group}（${g.count}）`">
          <div class="group-head">
            <span class="group-desc">{{ groupDescription(g.group) }}</span>
            <el-tag v-if="dirtyOf(g)" type="warning" size="small" effect="plain">有未保存修改</el-tag>
          </div>
          <el-form label-width="150px" class="config-form" @submit.prevent>
            <el-form-item v-for="item in g.items" :key="item.config_key" :label="item.description">
              <div class="config-row">
                <el-input v-model="drafts[item.config_key]" :disabled="!auth.canWrite('ops')" maxlength="512" />
                <div class="config-meta">
                  <span class="mono">{{ item.config_key }}</span>
                  <span class="mono">更新于 {{ fmtDateTime(item.updated_at) }}</span>
                </div>
              </div>
            </el-form-item>
          </el-form>
          <div class="save-bar">
            <el-button type="primary" :disabled="!auth.canWrite('ops') || !dirtyOf(g)" :loading="savingGroup === g.group" @click="save(g)">
              保存本组配置
            </el-button>
            <el-button :disabled="!dirtyOf(g)" @click="revert(g)">撤销修改</el-button>
            <span v-if="!auth.canWrite('ops')" class="readonly-hint">当前账号为只读权限，无法修改配置</span>
          </div>
        </el-tab-pane>
      </el-tabs>
      <EmptyState v-if="!loading && !groups.length" description="暂无配置项" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import { useAuthStore } from '@/stores/auth';
import { fmtDateTime } from '@/utils/format';
import { getConfigs, updateConfig, type ConfigGroup } from '@/api/ops';

const GROUP_DESCRIPTIONS: Record<string, string> = {
  基础信息: '平台名称与当前版本号，版本号会同步展示在版本管理中',
  安全策略: '口令强度、登录失败锁定、会话有效期与访问白名单等安全基线',
  数据治理: '资产扫描与合规检查的调度周期',
  风险监测: '风险告警的推送渠道',
  运维保障: '备份任务的执行计划',
};

const auth = useAuthStore();

const loading = ref(false);
const groups = ref<ConfigGroup[]>([]);
const drafts = ref<Record<string, string>>({});
const activeTab = ref('');
const savingGroup = ref<string | null>(null);

function groupDescription(group: string): string {
  return GROUP_DESCRIPTIONS[group] ?? '平台运行参数';
}

function dirtyOf(g: ConfigGroup): boolean {
  return g.items.some((item) => drafts.value[item.config_key] !== item.config_value);
}

function revert(g: ConfigGroup): void {
  for (const item of g.items) drafts.value[item.config_key] = item.config_value;
  ElMessage.info('已撤销本组未保存的修改');
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await getConfigs();
    groups.value = res.data;
    const nextDrafts: Record<string, string> = {};
    for (const g of res.data) {
      for (const item of g.items) nextDrafts[item.config_key] = item.config_value;
    }
    drafts.value = nextDrafts;
    if (!activeTab.value && res.data.length) activeTab.value = res.data[0].group;
  } finally {
    loading.value = false;
  }
}

async function save(g: ConfigGroup): Promise<void> {
  const changed = g.items.filter((item) => drafts.value[item.config_key] !== item.config_value);
  if (!changed.length) {
    ElMessage.info('本组配置未变更');
    return;
  }
  for (const item of changed) {
    if (!drafts.value[item.config_key]?.trim()) {
      ElMessage.warning(`「${item.description}」不能为空`);
      return;
    }
  }
  savingGroup.value = g.group;
  try {
    for (const item of changed) {
      await updateConfig(item.config_key, drafts.value[item.config_key].trim());
    }
    ElMessage.success(`已保存「${g.group}」的 ${changed.length} 项配置`);
    await load();
  } finally {
    savingGroup.value = null;
  }
}

onMounted(load);
</script>

<style scoped>
.group-head { display: flex; align-items: center; gap: 10px; margin: 4px 0 16px; }
.group-desc { font-size: 12px; color: #8595ad; }
.config-form { max-width: 860px; }
.config-row { width: 100%; }
.config-meta { display: flex; gap: 16px; margin-top: 4px; font-size: 11px; color: #94a3b8; }
.save-bar { display: flex; align-items: center; gap: 10px; padding: 16px 0 4px; border-top: 1px dashed #e8eef7; }
.readonly-hint { font-size: 12px; color: #94a3b8; }
</style>
