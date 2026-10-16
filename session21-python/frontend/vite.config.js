import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` and `npm run preview` proxy /api to the FastAPI backend.
// In production nginx serves dist/ and proxies /api itself, so the app only
// ever calls relative /api/... URLs.
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:8000'

const proxy = {
  '/api': { target: apiTarget, changeOrigin: true },
}

// VITE_APP_VERSION (optional, set at build time) reaches the app as
// import.meta.env.VITE_APP_VERSION. It is only a fallback label: the running
// build and pod are always read from GET /api/info.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy,
  },
  preview: {
    port: 4173,
    proxy,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
})
