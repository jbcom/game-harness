---
title: Vitest Browser Mode
description: A real-Chromium Vitest Browser Mode project, headed by default and silent at launch.
---

```ts
import { defineConfig } from 'vitest/config';
import { defineBrowserTestConfig } from 'game-harness/vitest';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', environment: 'node', include: ['tests/unit/**'] },
      },
      {
        extends: true,
        test: defineBrowserTestConfig({
          optimizeDeps: ['three/examples/jsm/utils/SkeletonUtils.js'],
        }),
      },
    ],
  },
});
```

`defineBrowserTestConfig()` builds the `test` fragment for a real-Chromium
Vitest Browser Mode project: headed by default (both locally and in CI, same
as `definePlaywrightConfig()`), silent at the Chromium launch boundary, and a
fixed viewport with `deviceScaleFactor: 1` so a headed macOS run never
recaptures visual baselines at the host's Retina scale. Pass `headless:
'ci-only'` only for a hosted runner genuinely without a display; CI should
normally keep the headed default and run under `xvfb-run`. Requires `vitest`
and `@vitest/browser-playwright` installed as peers.

`optimizeDeps` surfaces module specifiers (deep imports Vite's scanner won't
discover on its own) that must also be merged into your top-level
`vite.config.ts`'s `optimizeDeps.include` — read them off the returned
fragment's `__optimizeDepsInclude` field, since Vitest's `test` block has no
`optimizeDeps` field of its own.

A game whose suite needs more of Vitest's browser options passes them through
rather than spreading over the fragment:

- `api` is the browser server's address, such as the port a CI slot or a
  local port allocator assigned, with `strictPort: true` so a taken port
  fails rather than drifting. It is placed where the installed Vitest reads
  it: the top-level `api` on Vitest 5 (which ignores `browser.api`),
  `browser.api` on Vitest 4.
- `commands` registers custom browser commands (`browser.commands`), such as
  a pointer drawn along a path that `userEvent` cannot draw.
- `screenshotFailures` sets `browser.screenshotFailures`.
- `isolate` sets the top-level `isolate`, which replaced `browser.isolate`.

Each is left to Vitest's default when it is not given.
