import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const runtimeVersion = JSON.parse(readFileSync(new URL('./node_modules/onnxruntime-web/package.json', import.meta.url), 'utf8')).version;
export default defineConfig(({ mode }) => {
  const extension = mode === 'extension';
  const input: Record<string, string> = extension
    ? { broker: fileURLToPath(new URL('./broker.html', import.meta.url)), background: fileURLToPath(new URL('./src/extension/background.ts', import.meta.url)) }
    : { index: fileURLToPath(new URL('./index.html', import.meta.url)) };
  return {
    base: './', plugins: [react()],
    define: { 'import.meta.env.VITE_ORT_VERSION': JSON.stringify(runtimeVersion) },
    publicDir: extension ? false : 'public',
    server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] }, host: '0.0.0.0', port: 5174, strictPort: true },
    worker: { format: 'es' },
    build: {
      outDir: extension ? 'dist-extension' : 'dist',
      rollupOptions: {
        input,
        output: { entryFileNames: chunk => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js' },
      },
    },
  };
});
