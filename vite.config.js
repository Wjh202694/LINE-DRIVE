import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    watch: {
      // Mimosa 钩子在 .mimosa/hook-state 下反复替换文件，Windows 上会触发 EBUSY 打崩监听器
      ignored: ['**/.mimosa/**', '**/tools/**', '**/node_modules/**'],
    },
  },
});
