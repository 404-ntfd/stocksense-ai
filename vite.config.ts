/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const version = (process.env.APP_VERSION || pkg.version).replace(/^v/, '');

// One build serves three hosts: Capacitor (file-like origin), GitHub Pages (sub-path) and
// `vite preview` on Windows. A relative base plus HashRouter keeps all three identical.
export default defineConfig({
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered by hand in main.tsx, and only on the web (never inside the APK)
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'StockSense AI',
        short_name: 'StockSense',
        description: 'Ask your shop anything: inventory, sales and profit analytics with voice.',
        theme_color: '#0f766e',
        background_color: '#f6f7f9',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2020', chunkSizeWarningLimit: 2500, sourcemap: false },
  server: { port: 5173 },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/*.d.ts', 'src/core/db/worker.ts', 'src/core/db/client.ts', 'src/core/analytics/worker.ts',
        'src/core/voice/nativeEngine.ts', 'src/core/voice/webSpeechEngine.ts', 'src/core/voice/whisperEngine.ts', 'src/core/util/platform.ts', 'src/core/util/secrets.ts'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
