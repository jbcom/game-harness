import { defineConfig } from 'vitest/config';

// Real headed Chromium checks. Kept out of the unit run (and its coverage
// gate) because they need a downloaded browser and a display: run them with
// `pnpm test:chromium`, under `xvfb-run` on a Linux host without one.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/chromium/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
