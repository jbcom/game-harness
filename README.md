# @jbdevprimary/game-harness

Shared browser and release-evidence primitives for TypeScript browser games.
Import only the entry point a game uses:

- `@jbdevprimary/game-harness/playwright` for Playwright projects and strict
  preview-server configuration; install `@playwright/test`;
- `@jbdevprimary/game-harness/silent-qa` for a peer-free,
  audio-engine-agnostic application-side runtime mute adapter;
- `@jbdevprimary/game-harness/production-runtime` for a fresh, silent
  production-artifact or exact-live boot; install `@playwright/test`;
- `@jbdevprimary/game-harness/chromium` for peer-free Chromium renderer and
  silence launch profiles;
- `@jbdevprimary/game-harness/vitest` for Vitest Browser Mode; install
  `vitest` and `@vitest/browser-playwright`;
- `@jbdevprimary/game-harness`, `/lighthouse`, `/release-ladder`, and
  `/visual-battery` for peer-free verification utilities.

Framework peers are intentionally optional at install time and are never loaded
by the package root. Each consumer must install the peers required by the
framework entry point it imports. A Playwright-only game, for example, installs
`@playwright/test` but does not need Vitest or `@vitest/browser-playwright`.

## Current release matrix

The package is built and packed with Node 24.19.0, pnpm 11.21.0, and Node's
bundled npm 11.17.0. Its current conformance matrix is Playwright 1.62.1 and
Vitest Browser 4.1.10. Package-boundary consumers run with a credential-free
HOME and npm configuration, install only the peer family needed by each entry
point, and exercise ESM, CommonJS, types, the CLI, silent runtime markers, and
headed Chromium launch profiles. A metadata-only dependency bump is not
release evidence.

Every packed release carries this README and the package-local MIT license.

## Playwright example

```ts
import { definePlaywrightConfig } from '@jbdevprimary/game-harness/playwright';

export default definePlaywrightConfig({
  port: 4391,
  deviceTiers: ['desktop', 'mobile'],
  gpuMode: process.env.CI ? 'linux-hardware-vulkan' : 'auto',
  webServerCommand: (port) =>
    `pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
});
```

The configured `port` is the stable local-development port. On GitHub or Gitea
Actions, the factory derives a deterministic port from repository, run, and job
identity so concurrent workflows cannot accidentally share the same preview.
Every Playwright config reload in the parent and worker processes resolves the
same value. `PLAYWRIGHT_PORT` or `PW_PORT` remains an exact override. A rare
cross-process/hash collision still fails closed because the preview must use
strict-port semantics; it never reuses a reachable process.

Playwright 1.62 forces coloured output in its web-server and worker children.
If the invoking shell exports `NO_COLOR`, Node warns that the variable is
ignored once Playwright adds `FORCE_COLOR=1`. During config evaluation the
factory therefore removes only the already-ignored `NO_COLOR` value from the
Playwright process environment before those children are spawned. This does
not modify the parent shell, and every other environment variable and warning
remains intact.

Use `webServerCommand(port)` when a consumer needs build or asset-preparation
steps around its preview. The callback receives the already-resolved local or
CI-isolated port. A literal `overrides.webServer.command` remains supported,
but a command that hard-codes its own port bypasses isolation and is not valid
release evidence.

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

## Vitest Browser Mode example

```ts
import { defineConfig } from 'vitest/config';
import { defineBrowserTestConfig } from '@jbdevprimary/game-harness/vitest';

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: 'unit', environment: 'node', include: ['tests/unit/**'] } },
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

## Chromium launch profile

```ts
import { chromium } from '@playwright/test';
import { createChromiumLaunchProfile } from '@jbdevprimary/game-harness/chromium';

const { args, env } = createChromiumLaunchProfile({
  gpuMode: process.env.CI ? 'linux-hardware-vulkan' : 'auto',
});
const browser = await chromium.launch({ args, env, headless: false });
```

`createChromiumLaunchProfile()` is the peer-free primitive behind both
`definePlaywrightConfig()` and `defineBrowserTestConfig()` — use it directly
when driving Chromium yourself (a custom launch script, `production-runtime`'s
own internals, or a non-Playwright automation layer). It resolves one of three
renderer policies (`auto` leaves selection to Chromium; `software` opts into
SwiftShader explicitly; `linux-hardware-vulkan` applies the reviewed
Mesa/ANGLE flags plus `EGL_PLATFORM=surfaceless` for a runner exposing
`/dev/dri/renderD128`) and always de-duplicates and appends `--mute-audio`
last, so a caller-supplied arg list can never accidentally drop the silence
guard.

Every browser launched by `definePlaywrightConfig()` or
`defineBrowserTestConfig()` receives Chromium's `--mute-audio` argument as a
defense-in-depth guard, including projects with custom launch options. The
application must also expose a non-persistent mute mode so tests fail closed
before interacting with it:

```ts
import { activateSilentQa } from '@jbdevprimary/game-harness/silent-qa';
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
import { openSilentGame } from '@jbdevprimary/game-harness/playwright';

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
adapters, but new games use these defaults. There is no audible-debug
exception: verify audio behavior through programmatic state, mocks, or analyser
assertions while agent-controlled playback remains muted.

Keep `reuseExistingServer` false for release evidence and assert the game identity
before exercising a journey. A process from another repository on a familiar
port must never be accepted as proof.

Before publishing the package, run `pnpm test:package` under the exact release
toolchain. The verifier rejects any npm other than the bundled npm 11.17.0 and
uses that packer directly from the package directory to verify the peer-free
root, Playwright/production-runtime, and Vitest Browser consumer boundaries in
clean temporary installs. The guarded publication workflow repeats that exact
source pack twice and requires byte identity before publishing. It also
generates and compares three independent normalized SBOMs through the pnpm
11.21.0 CycloneDX 1.7
`--lockfile-only --prod --exclude-peers --no-optional` SBOM for the shipped
runtime: one component and the root dependency edge to `get-port`. Required
Playwright and optional Vitest Browser peers remain manifest and clean-consumer
contracts rather than being mislabeled as bundled components. Source epoch,
lockfile, package-tree, release-input, and archive provenance make the canonical
SBOM and checksum set reproducible on retries.

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
} from '@jbdevprimary/game-harness/production-runtime';

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
    await page.getByRole('heading', { name: 'My Game' }).waitFor();
    await page.locator('canvas').waitFor({ state: 'visible' });
    const { renderer } = await requireHardwareWebGL(page);
    console.log(`WebGL renderer: ${renderer}`);
  },
});
```

Pass `browserLaunchOptions: { headless: true }` only for a deliberately
constrained non-visual check. Release and final gameplay proof remain headed.

When `server` is present, its readiness URL must be unreachable before launch;
the verifier never reuses an arbitrary process. It owns that child process,
waits for readiness, and terminates it after either success or failure. Omit
`server` to apply the same strict gate to an already-deployed exact-live URL.
Every reachable readiness probe cancels its response body after recording the
status, including non-OK retry responses. A long polling loop must not retain
response streams or connections while it waits for the owned server.
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

## Lighthouse CI presets

```ts
// lighthouserc.mjs
import { lighthouseAssertions } from '@jbdevprimary/game-harness/lighthouse';

export default lighthouseAssertions('game-default', {
  url: ['http://localhost/index.html', 'http://localhost/settings/index.html'],
  assertions: { 'categories:performance': ['warn', { minScore: 0.5 }] },
});
```

`lighthouseAssertions()` returns a `lighthouserc.json`-shaped config object
for a named preset, with `overrides` merged on top (assertion overrides are
merged key-by-key on top of the preset's own; every other override field
replaces it wholesale). The only shipped preset, `'game-default'`, is a
production `lighthouserc.json` verbatim: performance/accessibility/best-practices
assertions at warn level (a score dip surfaces in CI logs without hard-blocking
a merge on Lighthouse's inherent run-to-run variance), with SEO and PWA
assertions off since these are single-page game shells with no SEO surface and
no installable-PWA requirement. To keep `lighthouserc.json` as static JSON
instead of a `.mjs` config, run this once locally and paste the printed
object — the factory has no runtime dependency on the consumer's environment
beyond the `overrides` you pass.

## Release ladder orchestrator

```ts
import { verifyReleaseLadder } from '@jbdevprimary/game-harness/release-ladder';
import { execSync } from 'node:child_process';

const result = await verifyReleaseLadder([
  { name: 'lint', run: () => execSync('pnpm lint', { stdio: 'inherit' }) },
  { name: 'typecheck', run: () => execSync('pnpm typecheck', { stdio: 'inherit' }) },
  { name: 'test', run: () => execSync('pnpm test', { stdio: 'inherit' }) },
  { name: 'build', run: () => execSync('pnpm build', { stdio: 'inherit' }) },
]);

process.exit(result.ok ? 0 : 1);
```

`verifyReleaseLadder()` is a thin orchestrator for a `verify:*` release
ladder — an ordered list of named steps, each a plain sync or async function,
run in sequence and stopped at the first failure with a labeled summary. It
generalizes the pattern of many discrete `node scripts/verify-X.mjs` files
composed via a shell `&&` chain into one reusable primitive: a step can inline
its logic or delegate to an existing script via `execSync`. It never throws —
it returns a `ReleaseLadderResult` (`{ ok, ranSteps, failedStep?, error? }`) so
the caller decides how to report or exit; `process.exit(result.ok ? 0 : 1)` is
the CLI convention. Pass `{ log, error }` to redirect the default
`console.log`/`console.error` output (both prefixed with `[verify]`).
