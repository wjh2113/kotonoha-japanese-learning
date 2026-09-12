import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Capacitor WebView 需要相对资源路径，APK 内才能正确加载 JS/CSS。
  base: './',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
})
