// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://kolatts.github.io',
  base: '/pncli/',
  markdown: {
    // Changelog bodies are raw commit messages full of bare CLI flags
    // (e.g. --output-file); smartypants would turn the "--" into an em dash.
    smartypants: false,
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: ['host.docker.internal'],
    },
  },
  integrations: [mdx()],
});