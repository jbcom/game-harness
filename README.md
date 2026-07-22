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

Every browser launched by `definePlaywrightConfig()` or
`defineBrowserTestConfig()` receives Chromium's `--mute-audio` argument as a
defense-in-depth guard, including projects with custom launch options. The
application must also expose a non-persistent mute mode so tests fail closed
before interacting with it:

```ts
import { openSilentGame } from '@arcade-cabinet/test-harness/playwright';

test('starts a game without audible QA', async ({ page }) => {
  await openSilentGame(page, '/my-game/', { scenario: 'new-game' });
  // The helper returns only after html[data-audio-mode="muted-test"] exists.
});
```

`openSilentGame()` adds `?muted=1` (preserving other query parameters and the
fragment), navigates, and requires the application to set
`data-audio-mode="muted-test"` on `<html>`. The mute mode is runtime-only: it
must mute audio before any sound objects can play and must never write the
player's saved audio preference. Use `silentTestUrl()` when a test needs the
URL without navigating. Custom marker/query names are supported for legacy
adapters, but new games use the fleet defaults.

Keep `reuseExistingServer` false for fleet evidence and assert the game identity
before exercising a journey. A process from another repository on a familiar
port must never be accepted as proof.

Before publishing the package, run `pnpm test:package` to pack it and verify the
peer-free root, Playwright-only, and Vitest Browser-only consumer boundaries in
clean temporary installs.

## Visual battery contract

`runVisualBattery()` owns one baseline directory directly under the configured
harness directory. Vitest screenshot paths are relative to the test file, so a
harness must write `__screenshots__/name.png`, not a repository-relative path
such as `tests/harness/__screenshots__/name.png`. The battery rejects any second
`__screenshots__` directory nested elsewhere under the harness tree; otherwise
an apparently green run could leave an important screenshot outside the Git
diff gate.

For WebGL scenes, capture the canvas locator instead of the full browser page:

```ts
const canvas = document.querySelector('canvas');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('canvas missing');
await page.elementLocator(canvas).screenshot({ path: '__screenshots__/scene.png' });
```

If a canvas baseline is stable alone but changes after other harnesses have run
in the same long-lived Chromium process, isolate that file so it gets a fresh
browser process while the remaining files stay in one fast batch:

```ts
runVisualBattery('tests/harness', {
  isolatedHarnessFiles: ['scene.browser.test.tsx'],
});
```
