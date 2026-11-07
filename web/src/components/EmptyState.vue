<template>
  <div class="empty-state">
    <el-empty :description="description" :image-size="72" />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ description?: string }>(), { description: '暂无数据' });
</script>

<style scoped>
.empty-state { padding: 18px 0; }
</style>
