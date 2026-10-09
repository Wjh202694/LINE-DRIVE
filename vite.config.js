import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // GitHub Pages 项目站需要 /LINE-DRIVE/ 前缀——仅在 --mode pages 时启用
  // （注意：不能用 command==='build' 判断——vite preview 的 command 是 'serve'，
  //   会导致 preview 服务路径与产物引用路径不一致、资源 fallback 成 HTML）
  base: mode === 'pages' ? '/LINE-DRIVE/' : '/',
  server: {
    watch: {
      // Mimosa 钩子在 .mimosa/hook-state 下反复替换文件，Windows 上会触发 EBUSY 打崩监听器
      ignored: ['**/.mimosa/**', '**/tools/**', '**/node_modules/**'],
    },
  },
}));
