<template>
  <el-drawer v-model="visible" :title="title" :size="width" destroy-on-close class="detail-drawer">
    <template #header>
      <div class="drawer-head">
        <span class="drawer-title">{{ title }}</span>
        <slot name="header-extra" />
      </div>
    </template>
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ modelValue: boolean; title: string; width?: string }>(), { width: '560px' });
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});
</script>

<style scoped>
.drawer-head { display: flex; align-items: center; gap: 10px; }
.drawer-title { font-size: 16px; font-weight: 600; color: #13233c; }
</style>
