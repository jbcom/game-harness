# Architecture

Game Harness is a small collection of composable verification primitives. It
does not own a game's tests or runtime state; it makes the boundaries around
those tests explicit and fail-closed.

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

The root deliberately does not re-export Playwright or Vitest integrations. A
consumer that needs only peer-free utilities therefore never loads or installs
either framework.

## Runtime evidence flow

1. `verifyProductionRuntime()` validates the URL, callbacks, server identity,
   and lifecycle limits before starting external work.
2. When a server is configured, its readiness URL must be unreachable first.
   The command is spawned directly with an argument array and must bind with
   strict-port behavior.
3. A fresh browser launches with the selected renderer profile and exactly one
   final `--mute-audio` argument.
4. Local-storage sentinels are installed before application code.
5. `openSilentGame()` adds the runtime-only mute query and waits for the
   application readiness marker.
6. The consumer's `assertReady` proves game identity and primary UI. An optional
   `assertSilentState` proves engine-specific mute state.
7. Console errors, page errors, failed requests, HTTP errors, and sentinel
   mutations fail the verification.
8. Browser and owned server resources are closed on success or failure.

The browser launch argument is defense in depth. The application marker is the
primary proof that its own audio graph was muted before test interaction. The
mute adapter never changes the player's persisted preference.

## Visual baseline ownership

`runVisualBattery()` owns one canonical baseline directory. It discovers
top-level `*.browser.test.ts` and `*.browser.test.tsx` files deterministically,
runs selected harnesses in direct child processes, requires at least one PNG,
and asks Git for scoped status with argument arrays rather than shell commands.

Update mode reports reviewed changes. CI mode also refuses a dirty starting
state and fails on any resulting drift. Renderer-specific output belongs in an
explicit profile directory rather than behind a permissive pixel threshold.

## Configuration philosophy

Factories provide production-minded defaults and validate inputs at the public
boundary. Callers can override Playwright and browser-provider details, but the
silence guard is re-applied after merges. Values that would produce ambiguous
or empty verification—invalid ports, missing device tiers, empty browser
matrices, malformed URLs, zero Lighthouse runs, or zero screenshots—fail early
with actionable errors.

## Build and distribution

TypeScript emits independent ESM, CommonJS, and declaration trees. A nested
`dist/cjs/package.json` marks the CommonJS output without changing the package's
top-level ESM identity. Optional peers keep install boundaries narrow. Release
validation then checks:

- formatting, linting, strict types, and 100% source coverage;
- both JavaScript module formats and declarations;
- package metadata and resolution through `publint` and
  `@arethetypeswrong/cli`;
- clean tarball consumers for root, Playwright, production runtime, Vitest, and
  CLI entry points;
- Linux, macOS, and Windows build/test portability in CI.
