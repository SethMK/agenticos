import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// output: 'server' enables SSR for /ops (S012).
// Public pages (index, how-it-was-built, api routes) retain
// `export const prerender = true` in their own frontmatter.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
});
