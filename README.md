# @arcade-cabinet/test-harness

Shared browser and release evidence primitives for the standalone arcade fleet.
Import only the entry point a game uses:

- `@arcade-cabinet/test-harness/playwright` for Playwright projects and strict
  preview-server configuration; install `@playwright/test`;
- `@arcade-cabinet/test-harness/silent-qa` for a peer-free,
  audio-engine-agnostic application-side runtime mute adapter;
- `@arcade-cabinet/test-harness/production-runtime` for a fresh, silent
  production-artifact or exact-live boot; install `@playwright/test`;
- `@arcade-cabinet/test-harness/chromium` for peer-free Chromium renderer and
  silence launch profiles;
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
  gpuMode: process.env.CI ? 'linux-hardware-vulkan' : 'auto',
  overrides: {
    webServer: {
      command: 'npm run build && npm run serve:e2e',
      reuseExistingServer: false,
    },
  },
});
```

Chromium is headed by default locally and in CI. Linux CI must provide a
display with `xvfb-run`; it should not change the browser to headless simply to
make WebGL start. The default `auto` profile lets Chromium select the native
renderer (including Metal on macOS). `software` is an explicit SwiftShader
fallback. `linux-hardware-vulkan` applies the reviewed Mesa/ANGLE flags and
`EGL_PLATFORM=surfaceless` for a runner that exposes `/dev/dri/renderD128`.

Vitest's interactive UI is disabled by default even though the Chromium window
remains visible. This gives Playwright a fixed viewport and a deterministic
device scale of 1, so a headed macOS run does not silently recapture visual
baselines at the host Retina scale. Pass `ui: true` only for an interactive
debugging session.

A Gitea runner job using the hardware profile must install
`mesa-vulkan-drivers` and `xvfb`, require the render device with
`test -c /dev/dri/renderD128`, and run the browser command under
`xvfb-run --auto-servernum`. Use `requireHardwareWebGL()` in the journey itself
so a green test cannot silently fall back to SwiftShader or llvmpipe. The
assertion also fails closed when the browser withholds its unmasked renderer.

`deviceTiers` declares the available matrix, while the default fast gate runs
only its first tier. Run `MULTIVIEW=1 pnpm exec playwright test` (or
`VISUAL=1 ...`) to include every declared tier.

Every browser launched by `definePlaywrightConfig()` or
`defineBrowserTestConfig()` receives Chromium's `--mute-audio` argument as a
defense-in-depth guard, including projects with custom launch options. The
application must also expose a non-persistent mute mode so tests fail closed
before interacting with it:

```ts
import { activateSilentQa } from '@arcade-cabinet/test-harness/silent-qa';
import { Howler } from 'howler';

// Evaluate before the rest of the application/audio graph.
export const silentQaActive = activateSilentQa(() => Howler.mute(true));
```

`activateSilentQa()` detects `?muted` by presence, invokes the consumer-owned
audio-engine callback, and only then publishes
`<html data-audio-mode="muted-test">`. It never reads or writes saved audio
preferences. Consumers use its boolean return value or `isSilentQaActive()` to
prevent later preference restoration from overriding the page-lifetime mute.

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
adapters, but new games use the fleet defaults. There is no audible-debug
exception: verify audio behavior through programmatic state, mocks, or analyser
assertions while agent-controlled playback remains muted.

Keep `reuseExistingServer` false for fleet evidence and assert the game identity
before exercising a journey. A process from another repository on a familiar
port must never be accepted as proof.

Before publishing the package, run `pnpm test:package` to pack it and verify the
peer-free root, Playwright/production-runtime, and Vitest Browser consumer
boundaries in clean temporary installs.

## Production runtime verification

`verifyProductionRuntime()` turns a successful build into runtime evidence. It
always launches a fresh headed Chromium process with `--mute-audio`, navigates through
`openSilentGame()`, and fails on page errors, console errors, failed requests,
HTTP errors, an inactive silent-QA marker, or a changed local-storage sentinel.
The required `assertReady` callback pins game identity and the primary UI or
canvas instead of accepting any app that happens to answer on the same port.

```ts
import {
  findAvailableProductionPort,
  requireHardwareWebGL,
  verifyProductionRuntime,
} from '@arcade-cabinet/test-harness/production-runtime';

const port = await findAvailableProductionPort();

await verifyProductionRuntime({
  url: `http://127.0.0.1:${port}/`,
  gpuMode: process.env.CI ? 'linux-hardware-vulkan' : 'auto',
  server: {
    command: process.execPath,
    args: [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--host=127.0.0.1',
      `--port=${port}`,
      '--strictPort',
    ],
  },
  localStorageSentinels: { 'settings::muted': 'false' },
  assertReady: async (page) => {
    await page.getByRole('heading', { name: 'Aethelgard' }).waitFor();
    await page.locator('canvas').waitFor({ state: 'visible' });
    const { renderer } = await requireHardwareWebGL(page);
    console.log(`Aethelgard WebGL renderer: ${renderer}`);
  },
});
```

Pass `browserLaunchOptions: { headless: true }` only for a deliberately
constrained non-visual check. Release and final gameplay proof remain headed.

When `server` is present, its readiness URL must be unreachable before launch;
the verifier never reuses an arbitrary process. It owns that child process,
waits for readiness, and terminates it after either success or failure. Omit
`server` to apply the same strict gate to an already-deployed exact-live URL.
Use `findAvailableProductionPort()` for CI or any shared runner instead of a
hard-coded port. It delegates selection to `get-port`, reserves that selection
against parallel calls in the current process, and still requires the owned
server to bind with strict-port semantics so an external race fails closed.

## Visual battery contract

`runVisualBattery()` owns one canonical `__screenshots__` tree directly under
the configured harness directory. Vitest screenshot paths are relative to the
test file, so a harness must write `__screenshots__/name.png`, not a
repository-relative path such as `tests/harness/__screenshots__/name.png`. The
battery rejects any second `__screenshots__` directory nested elsewhere under
the harness tree; otherwise an apparently green run could leave an important
screenshot outside the Git diff gate.

When two renderers cannot produce byte-identical PNGs, keep strict profiles
instead of adding a pixel threshold. Pass `baselineProfile: 'linux'`; the
battery compares `__screenshots__/linux/` and exposes the same value to Vite as
`VITE_VISUAL_BASELINE_PROFILE`. Screenshot helpers should include that optional
directory in their path:

```ts
const profile = import.meta.env.VITE_VISUAL_BASELINE_PROFILE?.trim();
const path = profile ? `__screenshots__/${profile}/scene.png` : '__screenshots__/scene.png';
```

`baselinesDir` names the baseline root. When it is combined with
`baselineProfile`, the profile is always appended below that root. For example,
`{ baselinesDir: 'visual-baselines', baselineProfile: 'linux' }` owns and diffs
`visual-baselines/linux/`.

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
