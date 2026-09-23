/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

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
  build: {
    // supabase-js (auth + realtime) is most of the bundle; ~150 kB gzipped is fine here.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'supabase/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
