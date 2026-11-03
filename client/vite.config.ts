/*
 * The client website, part of the Moon Library project (served by the Flask server at /).
 *   npm run build   → dist/, which the server serves at the site's root (sh start.sh does this for you)
 *   npm run dev     http://localhost:5200 with live reload while you work on it — everything that
 *                   isn't the client site itself (the API, the admin at /admin, file downloads) is
 *                   passed on to the server (BACKEND_URL, default http://127.0.0.1:5100)
 */
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.BACKEND_URL || 'http://127.0.0.1:5100';
  // keep the browser's Host, so the server's same-origin check sees localhost:5200 on both sides
  const to = { target: backend, changeOrigin: false, xfwd: true };
  const proxy = { '/api': to, '/admin': to, '/f/': to, '/zip': to, '/fonts': to, '/category-icons': to };
  return {
    plugins: [react()],
    server: { port: 5200, strictPort: true, proxy },
    preview: { port: 5200, proxy },
    build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  };
});
