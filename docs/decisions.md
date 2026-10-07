---
title: Decisions
description: Why the package is shaped the way it is, and how a predecessor harness converged into it.
---

Each entry records a decision, the reason for it, and what it means for a
consumer. Newest first.

## Converging a predecessor `test-harness` package

Game Harness began as an extraction of a private, scoped package published as
`@<scope>/test-harness`. Both lines kept shipping for a while, so this entry
compares them export by export and records what was folded into Game Harness
so that every consumer of the predecessor can move here. The step-by-step
consumer mapping is in [MIGRATION.md](https://github.com/jbcom/game-harness/blob/main/MIGRATION.md).

**Decision:** Game Harness is the one canonical harness. Where both packages
implement the same thing, Game Harness keeps its own public shape; anything the
predecessor did that Game Harness did not is added here, with tests.

### Method

1. Diffed every source file of the predecessor's last release against this
   repository's `main`.
2. Ran the predecessor's own unit suite against Game Harness's source. Every
   behavioural test passed (97 of 107). The ten failures were all in the
   visual battery and mocked `execSync`, an implementation detail Game Harness
   replaced with shell-free `execFileSync`; the behaviour those tests describe
   is covered by Game Harness's own suite. The predecessor's package-contract
   test checks its own package name and is not applicable.

### Entry points

| Subpath               | Predecessor | Game Harness | Notes                                                       |
| --------------------- | ----------- | ------------ | ----------------------------------------------------------- |
| `.` (root)            | yes         | yes          | Same re-exports: Lighthouse, release ladder, visual battery |
| `/vitest`             | yes         | yes          | Same function; Game Harness validates its inputs            |
| `/playwright`         | yes         | yes          | Same functions; Game Harness validates and normalizes       |
| `/silent-qa`          | yes         | yes          | Game Harness adds `activateSilentQaAsync`                   |
| `/production-runtime` | yes         | yes          | Same functions; Game Harness validates URLs and durations   |
| `/chromium`           | yes         | yes          | Game Harness adds `CHROMIUM_ANTI_THROTTLING_ARGS`           |
| `/lighthouse`         | yes         | yes          | Same function; result type always carries `staticDistDir`   |
| `/release-ladder`     | yes         | yes          | Identical behaviour                                         |
| `/visual-battery`     | yes         | yes          | Game Harness adds `VisualBatteryCommand` and path checks    |
| `/package.json`       | yes         | yes          |                                                             |

Both packages ship ESM and CommonJS builds. Game Harness additionally ships
separate `.d.cts` declarations for `require` consumers.

### Exports

Every named export of the predecessor exists in Game Harness under the same
name and subpath. Game Harness adds three:

| Export                          | Subpath                 | Why                                                                  |
| ------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| `activateSilentQaAsync`         | `/silent-qa`            | Publishes the readiness marker only after an async mute resolves     |
| `VisualBatteryCommand`          | `/visual-battery`, root | Runs the browser suite without a shell                               |
| `CHROMIUM_ANTI_THROTTLING_ARGS` | `/chromium`             | The scheduling switches every launch profile now carries (see below) |

### Bins

| Predecessor                   | Game Harness                                                |
| ----------------------------- | ----------------------------------------------------------- |
| `test-harness-visual-battery` | `game-harness-visual-battery`, and the old name as an alias |

Game Harness's CLI also rejects unknown flags and more than one positional
directory (exit code 2) instead of silently ignoring them.

### Peers

| Peer                         | Predecessor   | Game Harness  |
| ---------------------------- | ------------- | ------------- |
| `@playwright/test`           | `>=1.62.1 <2` | `>=1.62.1 <2` |
| `vitest`                     | `>=4.1.10 <5` | `>=4.1.10 <6` |
| `@vitest/browser-playwright` | `>=4.1.10 <5` | `>=4.1.10 <6` |
| Node (`engines`)             | `>=24.19.0`   | `>=22`        |

All framework peers stay optional; the root never loads them. CI proves the
packed tarball against Vitest 4.1.10 and 5.0.3.

### Where the shapes differ

Game Harness's shape wins in each case. The consumer-facing consequence is
listed in MIGRATION.md.

- **Visual battery `testCommand`.** The predecessor passed a string to a
  shell, so shell syntax (`FOO=1 pnpm …`, `&&`, quoting) worked by accident.
  Game Harness never starts a shell: a string is split on whitespace, or a
  `{ command, args }` object is executed directly. Kept because a shell turns
  a configuration value into a command-injection surface and behaves
  differently on Windows.
- **Strict input validation.** Game Harness throws a `TypeError` for an
  invalid `PLAYWRIGHT_PORT`/`PW_PORT` (the predecessor silently fell back to
  the derived port), an empty or unknown `deviceTiers` list, a non-positive
  `ciTimeoutMultiplier`, a `basePath` with a query, fragment or traversal, an
  empty Vitest project name, `instances` or `include`, and empty or invalid
  Lighthouse overrides. Kept because a misconfigured gate that silently
  "passes" is not release evidence.
- **Async mute callbacks.** The predecessor's `activateSilentQa` accepted a
  promise-returning callback and published the readiness marker before the
  mute finished. Game Harness throws and points to `activateSilentQaAsync`.
- **`LighthouseCiConfig.ci.collect.staticDistDir`** is required in the result
  type. Every preset already sets it, so only code that builds the type by
  hand without it is affected.
- **Visual battery paths.** Game Harness requires the harness and baseline
  directories to stay inside `cwd`, sorts harness files for a deterministic
  run order, and fails when a run produces no PNG baselines.

### Deliberately not carried over

- **The predecessor's repository tooling:** its Gitea release workflow,
  release-label script, anonymous-registry environment helper and the test
  that pinned that workflow. Game Harness publishes from GitHub with npm
  trusted publishing and provenance, so none of it applies.
- **Shell execution for `testCommand`**, for the reason above. A consumer
  that needs environment variables or chained commands puts them in a
  package script and passes that script's name.

## Every launch profile disables background throttling

**Decision:** `createChromiumLaunchProfile()` always adds
`--disable-background-timer-throttling`, `--disable-renderer-backgrounding`
and `--disable-backgrounding-occluded-windows`, exported as
`CHROMIUM_ANTI_THROTTLING_ARGS`. Every Playwright project, Vitest Browser
instance and production-runtime launch inherits them.

**Why:** a browser suite commonly runs several headed windows at once. A tab
Chromium considers backgrounded has its timers coalesced to one wake-up per
second, and an occluded window or backgrounded renderer is deprioritised, so
suites time out for reasons that have nothing to do with the game.

Playwright adds the same switches to its own default arguments today, but the
profile is the package's contract with every launcher it serves: a custom
script, a launcher that does not use Playwright, or a caller that passes
`ignoreDefaultArgs`. Making the switches explicit keeps the guarantee from
depending on another tool's defaults. They do not change Page Visibility: a
backgrounded page still reports `hidden`, so a game's pause-on-hide logic
remains testable.

**Evidence:** `pnpm test:chromium` launches headed Chromium over the raw
DevTools protocol (Playwright's own switches and focus emulation would mask
the effect), opens a 50 ms timer in one tab and a second tab in front of it,
and samples the background tab for three seconds. With the profile the timer
keeps its schedule; a control case without the switches shows the one-second
throttling, which proves the scenario really backgrounds the tab.

## Vitest 4 and 5

**Decision:** the `vitest` and `@vitest/browser-playwright` peers accept
`>=4.1.10 <6`. Development runs on Vitest 5, and the packed-consumer smoke
runs once against 4.1.10 (the floor) and once against 5.0.3.

**Why:** consumers are moving to Vitest 5, and the config fragment
`defineBrowserTestConfig()` emits is valid for both majors without a code
change.
