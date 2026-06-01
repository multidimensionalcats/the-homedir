import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: false, compilerOptions: { css: 'injected' } })],
  resolve: {
    conditions: ['browser'],
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,js}'],
    exclude: ['node_modules', 'dist', '.astro'],
    passWithNoTests: true,
  },
});
