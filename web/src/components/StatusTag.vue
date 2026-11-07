<template>
  <el-tag :type="tagType" :effect="effect" size="small" class="status-tag">{{ value }}</el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ value: string; kind?: 'level' | 'result' | 'status' | 'risk' | 'auto'; effect?: 'light' | 'dark' | 'plain' }>(), {
  kind: 'auto',
  effect: 'light',
});

const DANGER = ['紧急', '不通过', '失败', '已逾期', '停用', '锁定', '已驳回', '风险', '高'];
const WARNING = ['警告', '中', '待整改', '整改中', '待审批', '处理中', '待处置', '处置中', '待受理', '待验证', '待治理'];
const SUCCESS = ['通过', '成功', '已闭环', '已通过', '正常', '已关闭', '已处置', '已归档', '启用'];
const INFO = ['低', '公开', '内部', '信息', '已忽略', '已撤回'];

const tagType = computed<'success' | 'warning' | 'danger' | 'info' | 'primary'>(() => {
  const v = props.value;
  if (DANGER.includes(v)) return 'danger';
  if (WARNING.includes(v)) return 'warning';
  if (SUCCESS.includes(v)) return 'success';
  if (v === '机密' || v === '绝密') return 'danger';
  if (INFO.includes(v)) return 'info';
  return 'primary';
});
</script>

<style scoped>
.status-tag { font-weight: 600; letter-spacing: 0.3px; }
</style>
