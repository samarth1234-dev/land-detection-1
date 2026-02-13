import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/earth-search': {
            target: 'https://earth-search.aws.element84.com/v1',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/earth-search/, '')
          },
          '/titiler': {
            target: 'https://titiler.xyz',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/titiler/, '')
          },
          '/nominatim': {
            target: 'https://nominatim.openstreetmap.org',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/nominatim/, ''),
            headers: {
              'User-Agent': 'land-record-dev/1.0'
            }
          },
          '/api': {
            target: 'http://127.0.0.1:4000',
            changeOrigin: true
          }
        }
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
