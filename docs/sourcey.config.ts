import { defineConfig, markdown } from 'sourcey';

export default defineConfig({
  name: 'Game Harness',
  siteUrl: 'https://jonbogaty.com',
  baseUrl: '/game-harness',
  theme: {
    preset: 'default',
    colors: {
      primary: '#0f766e',
      light: '#2dd4bf',
      dark: '#115e59',
    },
    fonts: {
      sans: 'Inter, system-ui, sans-serif',
      mono: 'JetBrains Mono, ui-monospace, monospace',
    },
    layout: {
      content: '48rem',
    },
  },
  prettyUrls: 'slash',
  favicon: './assets/game-harness-hero.webp',
  ogImage: './assets/game-harness-hero.webp',
  repo: 'https://github.com/jbcom/game-harness',
  editBranch: 'main',
  editBasePath: 'docs',
  navbar: {
    links: [
      { type: 'github', href: 'https://github.com/jbcom/game-harness' },
      {
        type: 'link',
        label: 'npm',
        href: 'https://www.npmjs.com/package/@jbdevprimary/game-harness',
      },
    ],
  },
  footer: {
    links: [
      { type: 'github', href: 'https://github.com/jbcom/game-harness' },
      { type: 'link', label: 'Security', href: 'https://jonbogaty.com/game-harness/security/' },
    ],
  },
  navigation: {
    tabs: [
      {
        tab: 'Documentation',
        slug: '',
        source: markdown({
          groups: [
            {
              group: 'Getting Started',
              pages: ['introduction', 'getting-started', 'quick-start', 'entry-points'],
            },
            {
              group: 'Guides',
              pages: [
                'guides/playwright',
                'guides/vitest',
                'guides/chromium-and-silent-qa',
                'guides/production-runtime',
                'guides/visual-battery',
                'guides/lighthouse-and-release-ladder',
              ],
            },
            {
              group: 'Reference',
              pages: ['architecture', 'reference/troubleshooting'],
            },
            {
              group: 'Project',
              pages: ['contributing', 'security', 'changelog', 'agent-guide'],
            },
          ],
        }),
      },
    ],
  },
});
