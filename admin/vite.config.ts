/*
 * The admin panel build.
 *   npm run dev     http://localhost:5173/admin/  — API calls go to the Flask server (BACKEND_URL, default http://127.0.0.1:5100)
 *   npm run build   → dist/, which Flask serves at /admin
 */
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import type { Plugin } from 'vite';

/**
 * The shared components use root addresses for a few public files (/fonts/…, /category-icons/…,
 * /logo.webp, /favicon.png). In production Flask serves them at the root; in `npm run dev`
 * this does the same from public/.
 */
const TYPES: Record<string, string> = { '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
function rootPublicFiles(): Plugin {
  const pub = fileURLToPath(new URL('./public', import.meta.url));
  return {
    name: 'moon-root-public-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!/^\/(fonts\/|category-icons\/|logo\.webp$|favicon\.png$)/.test(path)) return next();
        const file = normalize(join(pub, path));
        if (!file.startsWith(pub) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.BACKEND_URL || 'http://127.0.0.1:5100';
  // keep the browser's Host, so the server's same-origin check sees localhost:5173 on both sides
  const toBackend = { target: backend, changeOrigin: false, xfwd: true };
  return {
    base: '/admin/',
    plugins: [react(), rootPublicFiles()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': toBackend,
        '/f/': toBackend,
        '/zip': toBackend,
        // the admin's "View" links open the public site; Flask forwards them to FRONTEND_ORIGIN
        '/library': toBackend,
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        onwarn(w, warn) {
          // the shared components carry Next.js 'use client' markers; Vite doesn't need them
          if (w.code === 'MODULE_LEVEL_DIRECTIVE') return;
          warn(w);
        },
      },
    },
  };
});
