import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Passage',
        short_name: 'Passage',
        description: 'Suivi des passages d’élèves par carte NFC, même hors ligne.',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8f4ee',
        theme_color: '#84411a',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // L'application entière est mise en cache : l'écran de scan s'ouvre sans réseau.
        // Motifs WebP (249 Ko) inclus : l'apparence reste la même hors ligne.
        globPatterns: ['**/*.{js,css,html,svg,woff2}', 'motifs/*.webp'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Les données (API) ne sont jamais mises en cache par le service worker :
        // elles concernent des mineurs. La file de scans vit dans IndexedDB.
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        // Garder l'en-tête Host d'origine (localhost:5173) : le contrôle anti-CSRF
        // de l'API accepte une origine égale à l'hôte de la requête. Sans cela,
        // l'API voit Host = localhost:3000 et refuse la connexion (403).
        changeOrigin: false,
      },
    },
  },
});
