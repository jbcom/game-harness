# @arcade-cabinet/test-harness

Shared browser and release evidence primitives for the standalone arcade fleet.
Import only the entry point a game uses:

- `@arcade-cabinet/test-harness/playwright` for Playwright projects and strict
  preview-server configuration; install `@playwright/test`;
- `@arcade-cabinet/test-harness/vitest` for Vitest Browser Mode; install
  `vitest` and `@vitest/browser-playwright`;
- `@arcade-cabinet/test-harness`, `/lighthouse`, `/release-ladder`, and
  `/visual-battery` for peer-free fleet verification utilities.

Framework peers are intentionally optional at install time and are never loaded
by the package root. Each consumer must install the peers required by the
framework entry point it imports. A Playwright-only game, for example, installs
`@playwright/test` but does not need Vitest or `@vitest/browser-playwright`.

## Playwright example

```ts
import { definePlaywrightConfig } from '@arcade-cabinet/test-harness/playwright';

export default definePlaywrightConfig({
  port: 4391,
  deviceTiers: ['desktop', 'mobile'],
  overrides: {
    webServer: {
      command: 'npm run build && npm run serve:e2e',
      reuseExistingServer: false,
    },
  },
});
```

`deviceTiers` declares the available matrix, while the default fast gate runs
only its first tier. Run `MULTIVIEW=1 pnpm exec playwright test` (or
`VISUAL=1 ...`) to include every declared tier.

Keep `reuseExistingServer` false for fleet evidence and assert the game identity
before exercising a journey. A process from another repository on a familiar
port must never be accepted as proof.

Before publishing the package, run `pnpm test:package` to pack it and verify the
peer-free root plus the Playwright-only consumer boundary in clean temporary
installs.
