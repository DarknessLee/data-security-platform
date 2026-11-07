import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    watch: {
      // 编辑器/工具的原子写入会在源码目录内产生临时目录，Windows 下被 watch 会 EBUSY 崩溃
      ignored: ['**/.*.tmpdir/**', '**/*.tmpdir/**', '**/.*.tmp', '**/*.tmp'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8081',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8081', changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
});
