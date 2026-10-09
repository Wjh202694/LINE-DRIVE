// 单文件构建配置（M6 产物之二）：JS/CSS/图片/视频全部内联为一个 index.html
// 用法：npx vite build --config vite.config.single.js → dist-single/index.html
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',                                  // 相对路径：双击本地打开也能跑
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-single',
    assetsInlineLimit: 100000000,              // 内联全部资源（图 + 视频 base64）
    chunkSizeWarningLimit: 100000,
    cssCodeSplit: false,
  },
});
