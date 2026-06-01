import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

/** Astro integration that prevents *.test.ts files in src/pages/ from being
 *  treated as API endpoints during the build. */
function excludeTestPages() {
  return {
    name: 'exclude-test-pages',
    hooks: {
      'astro:build:setup': ({ vite, target }) => {
        if (target !== 'server') return;
        vite.plugins = vite.plugins || [];
        vite.plugins.push({
          name: 'noop-test-endpoints',
          transform(code, id) {
            if (id.includes('/src/pages/') && id.endsWith('.test.ts')) {
              // Return an empty module — no exports, no side effects
              return { code: 'export {}', map: null };
            }
          },
        });
      },
    },
  };
}

export default defineConfig({
  site: 'https://thehomedir.org',
  output: 'static',
  integrations: [svelte(), excludeTestPages()],
  vite: {
    plugins: [tailwindcss()],
  },
});
