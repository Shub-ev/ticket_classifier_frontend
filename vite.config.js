import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Backend triage API (FastAPI) — overridable with TRIAGE_API_URL
const API_TARGET = process.env.TRIAGE_API_URL || 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Dev proxy: avoids CORS entirely by keeping requests same-origin.
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
