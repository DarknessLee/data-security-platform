<template>
  <div class="stat-card" :class="`tone-${tone}`">
    <div class="stat-main">
      <span class="stat-label">{{ label }}</span>
      <div class="stat-value">
        <b>{{ displayValue }}</b>
        <em v-if="unit">{{ unit }}</em>
      </div>
      <span v-if="hint" class="stat-hint">{{ hint }}</span>
    </div>
    <div v-if="icon" class="stat-icon">
      <el-icon :size="22"><component :is="icon" /></el-icon>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  icon?: string;
}>(), { tone: 'primary' });

const displayValue = computed(() => {
  if (typeof props.value === 'number' && Number.isFinite(props.value)) {
    return props.value.toLocaleString('zh-CN');
  }
  return props.value ?? '-';
});
</script>

<style scoped>
.stat-card { position: relative; display: flex; justify-content: space-between; gap: 12px; background: #fff; border: 1px solid #e9eef6; border-radius: 12px; padding: 16px 18px; box-shadow: 0 1px 2px rgba(19, 35, 60, 0.04); overflow: hidden; }
.stat-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--tone, #1f6feb); }
.stat-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.stat-label { font-size: 13px; color: #74859e; }
.stat-value { display: flex; align-items: baseline; gap: 4px; }
.stat-value b { font-size: 26px; line-height: 1.1; font-weight: 700; color: #13233c; font-variant-numeric: tabular-nums; }
.stat-value em { font-style: normal; font-size: 12px; color: #8595ad; }
.stat-hint { font-size: 12px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stat-icon { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; color: var(--tone, #1f6feb); background: var(--tone-bg, rgba(31, 111, 235, 0.1)); flex-shrink: 0; }
.tone-primary { --tone: #1f6feb; --tone-bg: rgba(31, 111, 235, 0.1); }
.tone-success { --tone: #16a34a; --tone-bg: rgba(22, 163, 74, 0.1); }
.tone-warning { --tone: #d97706; --tone-bg: rgba(217, 119, 6, 0.12); }
.tone-danger { --tone: #dc2626; --tone-bg: rgba(220, 38, 38, 0.1); }
.tone-info { --tone: #64748b; --tone-bg: rgba(100, 116, 139, 0.12); }
</style>
