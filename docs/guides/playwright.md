---
title: Playwright
description: Deterministic ports, strict-port preview servers, and silent Chromium launches.
---

```ts
import { definePlaywrightConfig } from 'game-harness/playwright';

export default definePlaywrightConfig({
  port: 4391,
  deviceTiers: ['desktop', 'mobile'],
  gpuMode: process.platform === 'linux' && process.env.CI ? 'linux-hardware-vulkan' : 'auto',
  webServerCommand: (port) =>
    `pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
});
```

The configured `port` is the stable local-development port. On GitHub or
Gitea Actions, the factory derives a deterministic port from repository, run,
and job identity so concurrent workflows cannot accidentally share the same
preview. Every Playwright config reload in the parent and worker processes
resolves the same value. `PLAYWRIGHT_PORT` or `PW_PORT` remains an exact
override. A rare cross-process/hash collision still fails closed because the
preview must use strict-port semantics; it never reuses a reachable process.

Playwright 1.62 forces coloured output in its web-server and worker children.
If the invoking shell exports `NO_COLOR`, Node warns that the variable is
ignored once Playwright adds `FORCE_COLOR=1`. During config evaluation the
factory therefore removes only the already-ignored `NO_COLOR` value from the
Playwright process environment before those children are spawned. This does
not modify the parent shell, and every other environment variable and
warning remains intact.

Use `webServerCommand(port)` when a consumer needs build or
asset-preparation steps around its preview. The callback receives the
already-resolved local or CI-isolated port. A literal
`overrides.webServer.command` remains supported, but a command that
hard-codes its own port bypasses isolation and is not valid release evidence.

Chromium is headed by default locally and in CI. Linux CI must provide a
display with `xvfb-run`; it should not change the browser to headless simply
to make WebGL start. The default `auto` profile lets Chromium select the
native renderer (including Metal on macOS). `software` is an explicit
SwiftShader fallback. `linux-hardware-vulkan` applies the reviewed
Mesa/ANGLE flags and `EGL_PLATFORM=surfaceless` for a runner that exposes
`/dev/dri/renderD128`.

A Gitea runner job using the hardware profile must install
`mesa-vulkan-drivers` and `xvfb`, require the render device with
`test -c /dev/dri/renderD128`, and run the browser command under
`xvfb-run --auto-servernum`. Use `requireHardwareWebGL()` in the journey
itself so a green test cannot silently fall back to SwiftShader or llvmpipe.
The assertion also fails closed when the browser withholds its unmasked
renderer.

`deviceTiers` declares the available matrix, while the default fast gate runs
only its first tier. Run `MULTIVIEW=1 pnpm exec playwright test` (or
`VISUAL=1 ...`) to include every declared tier.

| Tier            | Projects                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| `desktop`       | `desktop` (1280 x 720)                                                     |
| `mobile`        | `mobile` (Pixel 7 descriptor)                                              |
| `tablet`        | `tablet` (iPad Mini descriptor)                                            |
| `foldable`      | `foldable-portrait` (840 x 2120), `foldable-landscape` (2120 x 840), DPR 3 |
| `foldable-open` | `oneplus-open-unfolded-portrait`, `oneplus-open-unfolded-landscape`        |
| `ultrawide`     | `ultrawide` (3440 x 1440)                                                  |

`foldable` is the folded, tall form factor with a synthetic viewport.
`foldable-open` is the unfolded book-style foldable, measured on a real
OnePlus Open (Chrome 154, 2026-10-06). Both postures are near-square (aspect
ratio <= 1.3, short edge >= 600 CSS px, so 821 / 765 = 1.07 and
883 / 703 = 1.26). Folded and phone layouts of the device are out of scope.

The same measurements are exported as `ONEPLUS_OPEN_DEVICES`, a map of
Playwright Test `use` options you can use directly:

```ts
import { ONEPLUS_OPEN_DEVICES } from 'game-harness/playwright';

const device = ONEPLUS_OPEN_DEVICES['oneplus-open-unfolded-portrait'];

test.use({ ...device });
// Capacitor fullscreen WebView (browser chrome removed): viewport = screen.
test.use({ ...device, viewport: device.contextOptions.screen });
```

Both share deviceScaleFactor 2.7625, `isMobile`, `hasTouch`, and the measured
user agent
`Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36`.

| Device                            | `viewport` (browser) | `screen` (fullscreen WebView) |
| --------------------------------- | -------------------- | ----------------------------- |
| `oneplus-open-unfolded-portrait`  | 821 x 765            | 821 x 884                     |
| `oneplus-open-unfolded-landscape` | 883 x 703            | 884 x 821                     |

The measured `screen` size is stored under `contextOptions.screen`, not as a
top-level `screen` key: Playwright Test has no top-level `screen` option, so a
literal `use: { screen }` fails the typecheck (TS2353) and is not applied, while
`contextOptions.screen` type-checks and is forwarded to the browser context.
Safe-area insets are 0 in the browser for both postures; Playwright cannot
emulate `env(safe-area-inset-*)` in any case.
