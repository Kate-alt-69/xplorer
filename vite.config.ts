import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'apps', 'client', 'src'),
      '@xplorer/sdk': path.resolve(import.meta.dirname, 'packages', 'sdk', 'src', 'index.ts'),
      '@xplorer/extension-sdk': path.resolve(
        import.meta.dirname,
        'packages',
        'extension-sdk',
        'src',
        'index.ts',
      ),
    },
  },
  root: path.resolve(import.meta.dirname, 'apps', 'client'),
  build: {
    outDir: path.resolve(import.meta.dirname, 'apps/client/dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.includes('pdf.worker')) {
            return 'assets/pdf.worker.[hash][extname]';
          }
          return 'assets/[name].[hash][extname]';
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    watch: {
      ignored: ['**/packages/extensions/**'],
    },
  },
  // Copy PDF worker to public directory
  assetsInclude: ['**/*.wasm'],
  // Tauri expects a fixed port, fail if that port is not available
  clearScreen: false,
  // Env variables starting with VITE_ will be exposed to the client
  envPrefix: ['VITE_', 'TAURI_'],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/**/*.{test,spec}.{ts,tsx}'],
    define: {
      'import.meta.env.TAURI_FAMILY': '"test"',
      'window.__TAURI__': 'undefined',
    },
  },
});
