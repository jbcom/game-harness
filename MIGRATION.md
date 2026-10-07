# Migrating from a scoped `test-harness` package

Game Harness grew out of a scoped package published privately as
`@your-scope/test-harness`. Every capability of that package now lives here, under
the same export names and subpaths. This guide maps each import, option and
binary, and lists the few places where Game Harness is stricter. The reasoning
behind each difference is in [docs/decisions.md](docs/decisions.md).

## 1. Swap the dependency

```sh
pnpm remove @your-scope/test-harness
pnpm add -D game-harness
```

Game Harness is on the public npm registry, so a registry mapping for the old
scope is no longer needed once nothing else uses it. Keep the peers you
already install: `@playwright/test` for `/playwright` and
`/production-runtime`, and `vitest` with `@vitest/browser-playwright` for
`/vitest`. Vitest 4 (from 4.1.10) and Vitest 5 are both supported. Node 22 or
newer is required.

## 2. Rewrite imports

Only the package name changes. Every subpath and named export is the same.

| Before                                        | After                             |
| --------------------------------------------- | --------------------------------- |
| `@your-scope/test-harness`                    | `game-harness`                    |
| `@your-scope/test-harness/vitest`             | `game-harness/vitest`             |
| `@your-scope/test-harness/playwright`         | `game-harness/playwright`         |
| `@your-scope/test-harness/silent-qa`          | `game-harness/silent-qa`          |
| `@your-scope/test-harness/production-runtime` | `game-harness/production-runtime` |
| `@your-scope/test-harness/chromium`           | `game-harness/chromium`           |
| `@your-scope/test-harness/lighthouse`         | `game-harness/lighthouse`         |
| `@your-scope/test-harness/release-ladder`     | `game-harness/release-ladder`     |
| `@your-scope/test-harness/visual-battery`     | `game-harness/visual-battery`     |
| `@your-scope/test-harness/package.json`       | `game-harness/package.json`       |

A single search and replace of the specifier prefix is enough:

```sh
git grep -lz '@your-scope/test-harness' | xargs -0 perl -pi -e 's#\@your-scope/test-harness#game-harness#g'
```

Replace `your-scope` in these commands with the scope your project installed
the package under.

### Export by export

| Subpath               | Exports (identical names)                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root                  | `lighthouseAssertions`, `LighthouseAssertionsOverrides`, `LighthouseCiConfig`, `verifyReleaseLadder`, `ReleaseLadderStep`, `ReleaseLadderResult`, `VerifyReleaseLadderOptions`, `runVisualBattery`, `VisualBatteryError`, `VisualBatteryOptions`                                                                      |
| `/vitest`             | `defineBrowserTestConfig`, `BrowserTestConfigOptions`, `BrowserInstance`                                                                                                                                                                                                                                              |
| `/playwright`         | `definePlaywrightConfig`, `PlaywrightConfigOptions`, `DeviceTier`, `resolvePlaywrightPort`, `ResolvePlaywrightPortOptions`, `silentTestUrl`, `SilentTestUrlOptions`, `SilentQueryValue`, `openSilentGame`, `OpenSilentGameOptions`                                                                                    |
| `/silent-qa`          | `activateSilentQa`, `isSilentQaRequested`, `isSilentQaActive`, `_resetSilentQaForTests`, `ActivateSilentQaOptions`, `SilentQaMarkerTarget`, `SILENT_QA_QUERY_PARAMETER`, `SILENT_QA_QUERY_VALUE`, `SILENT_QA_MARKER_ATTRIBUTE`, `SILENT_QA_MARKER_VALUE`                                                              |
| `/production-runtime` | `verifyProductionRuntime`, `ProductionRuntimeOptions`, `ProductionRuntimeServerOptions`, `ProductionRuntimeResult`, `ProductionRuntimeIssue`, `ProductionRuntimeVerificationError`, `findAvailableProductionPort`, `AvailableProductionPortOptions`, `readWebGLRenderer`, `requireHardwareWebGL`, `WebGLRendererInfo` |
| `/chromium`           | `createChromiumLaunchProfile`, `ChromiumLaunchProfileOptions`, `ChromiumLaunchProfile`, `ChromiumGpuMode`, `ChromiumEnvironment`                                                                                                                                                                                      |
| `/lighthouse`         | `lighthouseAssertions`, `LighthouseAssertionsOverrides`, `LighthouseCiConfig`, `LighthousePreset`                                                                                                                                                                                                                     |
| `/release-ladder`     | `verifyReleaseLadder`, `ReleaseLadderStep`, `ReleaseLadderResult`, `VerifyReleaseLadderOptions`                                                                                                                                                                                                                       |
| `/visual-battery`     | `runVisualBattery`, `VisualBatteryError`, `VisualBatteryOptions`                                                                                                                                                                                                                                                      |

New in Game Harness: `activateSilentQaAsync` (`/silent-qa`),
`VisualBatteryCommand` (`/visual-battery` and root) and
`CHROMIUM_ANTI_THROTTLING_ARGS` (`/chromium`).

Modified PNG baselines now use decoded RGBA comparisons instead of byte equality.
`maxChannelDelta` defaults to 2 and `maxDifferentPixelRatio` to 0, so every
pixel beyond ±2 is drift. Noise-only files are restored to committed bytes;
dimensions and new/deleted files still fail. Use `maxChannelDelta: 0` for exact
decoded pixels. CLI flags are `--max-channel-delta` and
`--max-different-pixel-ratio`; see the visual-battery guide for their ranges.

## 3. Options

Every option keeps its name and meaning:

| Options type                     | Options                                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserTestConfigOptions`       | `contextOptions`, `gpuArgs`, `gpuMode`, `headless`, `ui`, `instances`, `optimizeDeps`, `setupFiles`, `name`, `include`, `fileParallelism`                                           |
| `PlaywrightConfigOptions`        | `testDir`, `basePath`, `port`, `webServerCommand`, `gpuMode`, `headless`, `deviceTiers`, `extraProjects`, `journeySpecs`, `ciTimeoutMultiplier`, `overrides`                        |
| `SilentTestUrlOptions`           | `muteQueryParameter`, `muteQueryValue`                                                                                                                                              |
| `OpenSilentGameOptions`          | `markerSelector`, `markerAttribute`, `markerValue`, `markerTimeout`, `navigationOptions`                                                                                            |
| `ResolvePlaywrightPortOptions`   | `localPort`, `environment`                                                                                                                                                          |
| `ProductionRuntimeOptions`       | `url`, `server`, `browserLaunchOptions`, `gpuMode`, `pageOptions`, `silentParameters`, `silentOptions`, `localStorageSentinels`, `assertReady`, `assertSilentState`, `settleTimeMs` |
| `ProductionRuntimeServerOptions` | `command`, `args`, `cwd`, `env`, `readyUrl`, `startupTimeoutMs`, `shutdownTimeoutMs`                                                                                                |
| `AvailableProductionPortOptions` | `host`                                                                                                                                                                              |
| `ActivateSilentQaOptions`        | `search`, `queryParameter`, `markerTarget`, `markerAttribute`, `markerValue`                                                                                                        |
| `VisualBatteryOptions`           | `ci`, `cwd`, `testCommand`, `baselinesDir`, `baselineProfile`, `isolatedHarnessFiles`, `maxChannelDelta`, `maxDifferentPixelRatio`, `log`, `error`                                  |
| `LighthouseAssertionsOverrides`  | `staticDistDir`, `url`, `numberOfRuns`, `assertions`                                                                                                                                |
| `ChromiumLaunchProfileOptions`   | `gpuMode`, `args`, `env`                                                                                                                                                            |
| `VerifyReleaseLadderOptions`     | `log`, `error`                                                                                                                                                                      |

Environment variables are unchanged: `CI`, `MULTIVIEW`, `VISUAL`, `JOURNEY`,
`PLAYWRIGHT_PORT`, `PW_PORT`, `PW_HEADLESS`, `PW_REUSE_SERVER`,
`PW_CHROMIUM_CHANNEL` and `VITE_VISUAL_BASELINE_PROFILE`.

## 4. Binary

| Before                        | After                         |
| ----------------------------- | ----------------------------- |
| `test-harness-visual-battery` | `game-harness-visual-battery` |

The old binary name is still installed as an alias, so scripts keep working,
but new scripts should use `game-harness-visual-battery`. Arguments are the
same (`[harness-directory] [--ci]`). Unknown flags or a second directory now
exit with code 2 instead of being ignored.

## 5. Where Game Harness is stricter

These are the only changes that can make a previously passing setup fail.
Each one fails loudly at configuration time with a message naming the
problem.

| Situation                                                                                     | What to do                                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testCommand` relies on a shell: `'FOO=1 pnpm test:browser'`, `&&`, pipes or quoted arguments | Move the shell logic into a package script and pass its name (`'pnpm test:visual'`), or pass `{ command: 'pnpm', args: ['test:browser'] }`. No shell is ever started. |
| `PLAYWRIGHT_PORT` or `PW_PORT` set to a non-port value                                        | Fix or unset it. Game Harness throws instead of falling back to the derived port.                                                                                     |
| `activateSilentQa` given a callback that returns a promise                                    | Use `await activateSilentQaAsync(mute)`. The readiness marker then appears only after the mute has resolved.                                                          |
| `basePath` containing `?`, `#`, `.`/`..` segments or encoded slashes                          | Pass a plain pathname. Leading, trailing and repeated slashes are normalized for you.                                                                                 |
| Empty `deviceTiers`, an unknown tier, or `ciTimeoutMultiplier` that is not positive           | Pass at least one of `desktop`, `mobile`, `tablet`, `foldable`, `ultrawide`, and a positive multiplier.                                                               |
| Empty Vitest `name`, `instances` or `include`                                                 | Omit the option to get the default, or pass a non-empty value.                                                                                                        |
| Lighthouse override with an empty `staticDistDir`, an empty `url` list, or `numberOfRuns < 1` | Omit the override or pass a valid value.                                                                                                                              |
| Code that builds a `LighthouseCiConfig` by hand without `ci.collect.staticDistDir`            | Add it. The result of `lighthouseAssertions()` always includes it.                                                                                                    |
| `baselinesDir` absolute, or harness or baseline directory outside `cwd`                       | Use a path relative to, and inside, `cwd`.                                                                                                                            |
| A visual-battery run that writes no PNG baselines                                             | It now fails. Make sure the harness actually takes screenshots.                                                                                                       |

## 6. Behaviour you get for free

- Every launch profile adds `--disable-background-timer-throttling`,
  `--disable-renderer-backgrounding` and
  `--disable-backgrounding-occluded-windows`, so background and occluded
  windows keep their timers on schedule when several headed browsers run at
  once. If a custom launch passes its own `args`, they are merged with these,
  and `--mute-audio` is still applied last.
- Harness files run in a sorted, deterministic order.
- Visual-battery commands run without a shell, with Windows `.cmd` shims
  resolved for you.

## 7. Verify

Run the consumer's own full gate (type check, unit tests, browser tests and
end-to-end tests). A green unit run alone does not prove the browser
configuration still loads.
