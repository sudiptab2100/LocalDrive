import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Admin control panel served by the embedded Express server under `/admin/`.
// It reuses the desktop renderer UI (`src/renderer/src`) via an HTTP-backed
// `LocalDriveApi`, so there is no service worker here — the panel is a plain
// SPA that always talks to the live server it is served from.
export default defineConfig({
  root: 'src/admin',
  base: '/admin/',
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src'),
      '@admin': resolve('src/admin')
    }
  },
  plugins: [react()],
  build: {
    outDir: resolve('out/admin'),
    emptyOutDir: true
  }
})
