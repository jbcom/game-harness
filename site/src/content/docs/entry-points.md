---
title: Entry points
description: The full map of Game Harness subpath exports and their required peers.
---

Import only the entry point a game uses:

- `@jbdevprimary/game-harness/playwright` for Playwright projects and strict
  preview-server configuration; install `@playwright/test`.
- `@jbdevprimary/game-harness/silent-qa` for a peer-free,
  audio-engine-agnostic application-side runtime mute adapter.
- `@jbdevprimary/game-harness/production-runtime` for a fresh, silent
  production-artifact or exact-live boot; install `@playwright/test`.
- `@jbdevprimary/game-harness/chromium` for peer-free Chromium renderer and
  silence launch profiles.
- `@jbdevprimary/game-harness/vitest` for Vitest Browser Mode; install
  `vitest` and `@vitest/browser-playwright`.
- `@jbdevprimary/game-harness`, `/lighthouse`, `/release-ladder`, and
  `/visual-battery` for peer-free verification utilities.

Framework peers are intentionally optional at install time and are never
loaded by the package root.

## Package boundaries

| Entry point           | Responsibility                                                  | Required peer                          |
| --------------------- | --------------------------------------------------------------- | -------------------------------------- |
| package root          | Lighthouse policy, release ladder, visual battery               | None                                   |
| `/chromium`           | Renderer and mandatory mute launch profile                      | None                                   |
| `/silent-qa`          | Application-side runtime mute request and readiness marker      | None                                   |
| `/playwright`         | Device tiers, isolated ports, preview server, silent navigation | `@playwright/test`                     |
| `/production-runtime` | Fresh server/browser lifecycle and runtime evidence             | `@playwright/test`                     |
| `/vitest`             | Vitest Browser Mode configuration                               | `vitest`, `@vitest/browser-playwright` |
| `/lighthouse`         | Immutable Lighthouse CI presets                                 | None                                   |
| `/release-ladder`     | Ordered sync/async verification steps                           | None                                   |
| `/visual-battery`     | Deterministic screenshot baseline orchestration                 | None                                   |

The production-runtime entry point depends on the Playwright entry point
because it composes `openSilentGame()` into a fresh-browser lifecycle; no
dependency points back toward the root. See the [Architecture reference](/game-harness/reference/architecture/)
for the complete module map and runtime-verification sequence.
