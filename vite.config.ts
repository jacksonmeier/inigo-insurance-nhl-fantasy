/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type ProxyOptions } from 'vite'

// Running the league on your own computer: the web server passes
// /supabase-api on to the local Supabase stack, websockets included. Phones on
// the same Wi-Fi then only need to reach one address, and the app can use a
// URL that works from any of them (VITE_SUPABASE_URL=/supabase-api, written by
// scripts/setup.ts). A hosted build doesn't use this: there VITE_SUPABASE_URL
// is the project's https URL.
//
// Not "/supabase": the dev server serves the shared config from the
// supabase/ folder at that path.
const supabaseProxy: Record<string, ProxyOptions> = {
  '/supabase-api': {
    target: process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321',
    changeOrigin: true,
    ws: true,
    rewrite: (path) => path.replace(/^\/supabase-api/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative base so the build works at https://<user>.github.io/<repo>/.
  // Routing is hash-based, so no server-side rewrites are needed.
  base: './',
  resolve: {
    alias: {
      // League + scoring config shared with the Edge Functions.
      '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)),
    },
  },
  server: {
    host: true, // reachable from other devices on the network
    proxy: supabaseProxy,
  },
  preview: {
    host: true,
    proxy: supabaseProxy,
  },
  build: {
    // supabase-js (auth + realtime) is most of the bundle; ~150 kB gzipped is fine here.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'supabase/**/*.test.ts', 'scripts/**/*.test.ts'],
    testTimeout: 30_000,
    // Each database test file starts its own in-memory Postgres and applies
    // every migration to it. That's slow when many start at once.
    hookTimeout: 90_000,
    maxWorkers: 3,
  },
})
