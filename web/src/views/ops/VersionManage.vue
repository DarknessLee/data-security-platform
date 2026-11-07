<template>
  <div class="page">
    <PageHeader title="版本管理" subtitle="平台版本发布记录、构建信息与变更说明">
      <el-button :loading="loading" @click="load">刷新</el-button>
    </PageHeader>

    <el-card v-loading="loading" shadow="never" class="content-card current-card">
      <template #header>
        <div class="section-title">
          <span>当前运行版本</span>
          <el-tag v-if="current?.status" type="success" effect="plain">{{ current.status }}</el-tag>
        </div>
      </template>
      <div v-if="current" class="current-body">
        <div class="version-block">
          <div class="version-no">{{ current.version }}</div>
          <div class="version-type">
            <el-tag type="primary" effect="light">{{ current.type }}</el-tag>
            <span class="mono build-no">{{ current.buildNo || '-' }}</span>
          </div>
          <div class="version-time mono">发布于 {{ fmtDateTime(current.releasedAt) }}</div>
        </div>
        <div class="version-meta">
          <div class="detail-grid">
            <div class="detail-item"><span class="k">发布人</span><span class="v">{{ current.owner }}</span></div>
            <div class="detail-item"><span class="k">部署环境</span><span class="v">{{ current.environment || '生产环境' }}</span></div>
            <div class="detail-item"><span class="k">构建编号</span><span class="v mono">{{ current.buildNo || '-' }}</span></div>
            <div class="detail-item"><span class="k">版本类型</span><span class="v">{{ current.type }}</span></div>
          </div>
          <p class="version-summary">{{ current.summary }}</p>
          <div class="changes">
            <div class="changes-title">本次变更</div>
            <ul class="change-list">
              <li v-for="(c, i) in current.changes" :key="i">{{ c }}</li>
            </ul>
          </div>
        </div>
      </div>
      <EmptyState v-else-if="!loading" description="暂无版本信息" />
    </el-card>

    <el-card shadow="never" class="content-card">
      <template #header><div class="section-title">历史版本</div></template>
      <el-timeline v-if="history.length" class="version-timeline">
        <el-timeline-item
          v-for="v in history"
          :key="v.version"
          :timestamp="fmtDateTime(v.releasedAt)"
          placement="top"
          type="primary"
          size="large"
        >
          <div class="history-item">
            <div class="history-head">
              <span class="history-version mono">{{ v.version }}</span>
              <el-tag size="small" type="info" effect="plain">{{ v.type }}</el-tag>
              <span class="history-owner">{{ v.owner }}</span>
            </div>
            <p class="history-summary">{{ v.summary }}</p>
            <ul class="change-list compact">
              <li v-for="(c, i) in v.changes" :key="i">{{ c }}</li>
            </ul>
          </div>
        </el-timeline-item>
      </el-timeline>
      <EmptyState v-else-if="!loading" description="暂无历史版本" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import { fmtDateTime } from '@/utils/format';
import { getVersions, type VersionItem } from '@/api/ops';

const loading = ref(false);
const current = ref<VersionItem | null>(null);
const history = ref<VersionItem[]>([]);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await getVersions();
    current.value = res.data.current;
    history.value = res.data.history;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.current-card { margin-bottom: 16px; }
.current-body { display: flex; gap: 40px; align-items: stretch; }
.version-block { flex: 0 0 250px; padding: 8px 24px 8px 4px; border-right: 1px dashed #e8eef7; display: flex; flex-direction: column; justify-content: center; gap: 10px; }
.version-no { font-size: 34px; font-weight: 700; letter-spacing: 1px; color: #1f6feb; }
.version-type { display: flex; align-items: center; gap: 10px; }
.build-no { font-size: 12px; color: #94a3b8; }
.version-time { font-size: 12px; color: #8595ad; }
.version-meta { flex: 1; min-width: 0; }
.version-summary { margin: 12px 0 14px; font-size: 13px; color: #3d4f68; line-height: 1.7; }
.changes-title { font-size: 13px; font-weight: 600; color: #1c2c46; margin-bottom: 6px; }
.change-list { margin: 0; padding-left: 18px; }
.change-list li { font-size: 12px; color: #5b6c85; line-height: 1.9; }
.change-list.compact li { line-height: 1.8; }
.version-timeline { padding-left: 6px; margin-top: 6px; }
.history-item { max-width: 720px; }
.history-head { display: flex; align-items: center; gap: 10px; }
.history-version { font-size: 15px; font-weight: 600; color: #1c2c46; }
.history-owner { font-size: 12px; color: #94a3b8; }
.history-summary { margin: 6px 0 4px; font-size: 13px; color: #4a5b73; line-height: 1.7; }
</style>
