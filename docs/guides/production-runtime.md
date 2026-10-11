---
title: Production runtime verification
description: Turn a successful build into runtime evidence with a fresh, silent, fail-closed browser session.
---

`verifyProductionRuntime()` turns a successful build into runtime evidence. It
launches a fresh Chromium process with `--mute-audio` and uses headed mode by
default,
navigates through `openSilentGame()`, and fails on page errors, console
errors, failed requests, HTTP errors, an inactive silent-QA marker, or a
changed local-storage sentinel. The required `assertReady` callback pins game
identity and the primary UI or canvas instead of accepting any app that
happens to answer on the same port.

```ts
import {
  findAvailableProductionPort,
  requireHardwareWebGL,
  verifyProductionRuntime,
} from 'game-harness/production-runtime';

const port = await findAvailableProductionPort();

await verifyProductionRuntime({
  url: `http://127.0.0.1:${port}/`,
  gpuMode: process.platform === 'linux' && process.env.CI ? 'linux-hardware-vulkan' : 'auto',
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
  captureWebGLContextEvents: true,
  localStorageSentinels: { 'settings::muted': 'false' },
  assertReady: async (page) => {
    await page.getByRole('heading', { name: 'My Game' }).waitFor();
    const canvasSelector = '#scene-canvas canvas';
    await page.locator(canvasSelector).waitFor({ state: 'visible' });
    const { renderer } = await requireHardwareWebGL(page, canvasSelector);
    console.log(`WebGL renderer: ${renderer}`);
  },
});
```

Use an owner selector instead of generic `canvas` when the page has multiple
canvases. A failed hardware preflight retains
`readWebGLCanvasDiagnostics()` output in its error message: selector ownership,
context kind and loss state, raw GL error, context attributes, and generic plus
unmasked renderer values. `captureWebGLContextEvents: true` records lost and
restored events before navigation without preventing them or changing renderer
policy.

Pass `browserLaunchOptions: { headless: true }` only for a deliberately
constrained non-visual check. Release and final gameplay proof remain headed.

When `server` is present, its readiness URL must be unreachable before
launch; the verifier never reuses an arbitrary process. It owns that child
process, waits for readiness, and terminates it after either success or
failure. Omit `server` to apply the same strict gate to an already-deployed
exact-live URL. Every reachable readiness probe cancels its response body
after recording the status, including non-OK retry responses. A long polling
loop must not retain response streams or connections while it waits for the
owned server. Use `findAvailableProductionPort()` for CI or any shared runner
instead of a hard-coded port. It delegates selection to `get-port`, reserves
that selection against parallel calls in the current process, and still
requires the owned server to bind with strict-port semantics so an external
race fails closed.
