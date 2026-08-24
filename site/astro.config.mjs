// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://jonbogaty.com',
  base: '/game-harness',
  trailingSlash: 'always',
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    starlight({
      title: 'Game Harness',
      description:
        'Release-grade browser QA primitives for TypeScript games: silent Playwright/Vitest sessions, deterministic screenshots, runtime proof, and Lighthouse gates.',
      logo: {
        src: './src/assets/game-harness-hero.webp',
        replacesTitle: false,
      },
      customCss: ['./src/styles/global.css'],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/jbcom/game-harness',
        },
        {
          icon: 'seti:npm',
          label: 'npm',
          href: 'https://www.npmjs.com/package/@jbdevprimary/game-harness',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/jbcom/game-harness/edit/main/site/',
      },
      lastUpdated: true,
      sidebar: [
        {
          label: 'Start here',
          items: ['getting-started', 'quick-start', 'entry-points'],
        },
        {
          label: 'Guides',
          items: [{ autogenerate: { directory: 'guides' } }],
        },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }],
        },
      ],
    }),
  ],
});
