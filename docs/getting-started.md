---
title: Getting started
description: Install Game Harness and pick the entry points your game needs.
---

Node.js 22, 24 and 26 are supported. Install the package plus only the peer family
for the integration you use:

```sh
# Playwright config and production-runtime verification
pnpm add -D game-harness @playwright/test
pnpm exec playwright install chromium

# Vitest Browser Mode instead
pnpm add -D game-harness vitest @vitest/browser-playwright playwright
pnpm exec playwright install chromium

# Peer-free Lighthouse, release-ladder, or visual-battery utilities
pnpm add -D game-harness
```

Framework peers are intentionally optional at install time and are never
loaded by the package root. Each consumer installs only the peers required by
the framework entry point it imports — a Playwright-only game installs
`@playwright/test` but does not need Vitest or `@vitest/browser-playwright`.

## Current release matrix

`engines.node` declares `>=22`. Supported maintained lines are Node.js 22,
24 and 26; CI runs the full verification and packed-consumer smoke on each
line on Linux, plus Node 26 portability on macOS and Windows. `.nvmrc`
selects major 26 without requiring an exact patch. This is a maintained-line
policy, not a promise about every historical patch. The current
conformance matrix is Playwright 1.62.1 and Vitest Browser 4.1.10 and 5.0.3.
Package-boundary consumers run with a credential-free home directory and npm
configuration, install only the peer family needed by each entry point, and
exercise ESM, CommonJS, the CLI, silent runtime markers, and Chromium launch
profiles. `publint` and `@arethetypeswrong/cli` independently validate package
metadata and declarations.

Continue to [Quick start](/game-harness/quick-start/) to wire up the silent
runtime marker and your first Playwright config.
