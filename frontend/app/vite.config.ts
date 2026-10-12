import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base: './', plugins: [react()],
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  worker: { format: 'es' },
  build: { rollupOptions: {
    input: { index: fileURLToPath(new URL('./index.html', import.meta.url)), background: fileURLToPath(new URL('./src/extension/background.ts', import.meta.url)) },
    output: { entryFileNames: chunk => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js' },
  } },
});
