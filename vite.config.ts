import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Vipad — Audio Recorder & Editor',
        short_name: 'Vipad',
        description: 'Record, edit and enhance audio on any device.',
        start_url: './app.html',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#070707',
        theme_color: '#070707',
        categories: ['music', 'productivity', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // right-click (desktop) / long-press (Android) quick actions on the app icon
        shortcuts: [
          { name: 'New recording', short_name: 'Record', description: 'Start a new recording', url: './app.html?action=record', icons: [{ src: 'icons/shortcut-record.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'Multitrack', short_name: 'Multitrack', description: 'Open the multitrack mixer', url: './app.html?action=multitrack', icons: [{ src: 'icons/shortcut-multitrack.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'Library', short_name: 'Library', description: 'Your saved and recovered recordings', url: './app.html?action=library', icons: [{ src: 'icons/shortcut-library.png', sizes: '96x96', type: 'image/png' }] },
        ],
        file_handlers: [
          {
            action: './app.html',
            accept: { 'audio/*': ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.opus', '.webm'] },
          },
        ],
      } as never,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Only the editor works offline; marketing pages must always be fresh from the network.
        globIgnores: ['index.html', 'download.html', 'guide.html', '404.html', 'guide/**', '**/main-*.js', '**/download-*.js', '**/guide-*.js', '**/main-*.css', '**/download-*.css', '**/guide-*.css'],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: null,
      },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app.html'),
        download: resolve(__dirname, 'download.html'),
        guide: resolve(__dirname, 'guide.html'),
        notFound: resolve(__dirname, '404.html'),
      },
    },
  },
  worker: { format: 'es' },
  server: { port: 5173 },
});
