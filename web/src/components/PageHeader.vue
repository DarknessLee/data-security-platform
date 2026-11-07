<template>
  <header class="page-header">
    <div class="page-header-main">
      <h1>{{ title }}</h1>
      <p v-if="subtitle">{{ subtitle }}</p>
    </div>
    <div class="page-header-actions">
      <slot />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<style scoped>
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-header-main h1 { margin: 0; font-size: 20px; font-weight: 650; color: #13233c; letter-spacing: 0.3px; }
.page-header-main p { margin: 4px 0 0; font-size: 13px; color: #7688a3; }
.page-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
</style>
