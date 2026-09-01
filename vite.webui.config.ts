import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Client-facing PWA served by the embedded Express server to browsers on the LAN.
export default defineConfig({
  root: 'src/webui',
  base: '/',
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@webui': resolve('src/webui/src')
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'LocalDrive',
        short_name: 'LocalDrive',
        description: 'Private WiFi network storage',
        theme_color: '#0b0f14',
        background_color: '#0b0f14',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        // Never cache API or file streams in the service worker.
        navigateFallbackDenylist: [/^\/api/, /^\/dav/, /^\/files/]
      }
    })
  ],
  build: {
    outDir: resolve('out/webui'),
    emptyOutDir: true
  }
})
