import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/zenload/',
  server: {
    port: 5173,
    proxy: {
      '/api/zenload': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/zenload/, '/api'),
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
