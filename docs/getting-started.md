---
title: Getting started
description: Install Game Harness and pick the entry points your game needs.
---

Node 22 or newer is required. Install the package plus only the peer family
for the integration you use:

```sh
# Playwright config and production-runtime verification
pnpm add -D @jbdevprimary/game-harness @playwright/test
pnpm exec playwright install chromium

# Vitest Browser Mode instead
pnpm add -D @jbdevprimary/game-harness vitest @vitest/browser-playwright playwright
pnpm exec playwright install chromium

# Peer-free Lighthouse, release-ladder, or visual-battery utilities
pnpm add -D @jbdevprimary/game-harness
```

Framework peers are intentionally optional at install time and are never
loaded by the package root. Each consumer installs only the peers required by
the framework entry point it imports — a Playwright-only game installs
`@playwright/test` but does not need Vitest or `@vitest/browser-playwright`.

## Current release matrix

`engines.node` declares `>=22`, the earliest Node LTS line still actively
supported. CI pins the primary gate to the version in `.nvmrc` (currently
24.19.0, the latest Node 24 LTS patch) and additionally runs the full test
and build suite against Node 22 on Linux to prove the floor of that range,
alongside macOS and Windows portability on the pinned version. The current
conformance matrix is Playwright 1.62.1 and Vitest Browser 4.1.10.
Package-boundary consumers run with a credential-free home directory and npm
configuration, install only the peer family needed by each entry point, and
exercise ESM, CommonJS, the CLI, silent runtime markers, and Chromium launch
profiles. `publint` and `@arethetypeswrong/cli` independently validate package
metadata and declarations.

Continue to [Quick start](/game-harness/quick-start/) to wire up the silent
runtime marker and your first Playwright config.
