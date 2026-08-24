---
title: Playwright
description: Deterministic ports, strict-port preview servers, and silent Chromium launches.
---

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
