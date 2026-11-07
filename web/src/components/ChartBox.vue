<template>
  <div class="chart-box">
    <div v-if="title" class="chart-box-head">
      <span class="chart-box-title">{{ title }}</span>
      <slot name="extra" />
    </div>
    <div ref="el" v-loading="loading" class="chart-box-body" :style="{ height: `${height}px` }" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

const props = withDefaults(defineProps<{
  title?: string;
  height?: number;
  option: EChartsOption;
  loading?: boolean;
}>(), { height: 300, loading: false });

const el = ref<HTMLDivElement>();
let chart: echarts.ECharts | null = null;
let observer: ResizeObserver | null = null;

function render(): void {
  if (!el.value) return;
  if (!chart) chart = echarts.init(el.value);
  chart.setOption(props.option, true);
}

onMounted(() => {
  render();
  if (el.value) {
    observer = new ResizeObserver(() => chart?.resize());
    observer.observe(el.value);
  }
});

watch(() => props.option, render, { deep: true });

onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.dispose();
  chart = null;
});
</script>

<style scoped>
.chart-box { background: #fff; border: 1px solid #e9eef6; border-radius: 12px; padding: 14px 16px 8px; }
.chart-box-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.chart-box-title { font-size: 14px; font-weight: 600; color: #23324a; }
.chart-box-body { width: 100%; }
</style>
