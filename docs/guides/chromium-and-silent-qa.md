---
title: Chromium launch profile & Silent QA
description: The peer-free primitives behind every silent browser launch.
---

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
own internals, or a non-Playwright automation layer). It resolves one of
three renderer policies (`auto` leaves selection to Chromium; `software`
opts into SwiftShader explicitly; `linux-hardware-vulkan` applies the
reviewed Mesa/ANGLE flags plus `EGL_PLATFORM=surfaceless` for a runner
exposing `/dev/dri/renderD128`) and always de-duplicates and appends
`--mute-audio` last, so a caller-supplied arg list can never accidentally
drop the silence guard.

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
preferences. Consumers use its boolean return value or `isSilentQaActive()`
to prevent later preference restoration from overriding the page-lifetime
mute. If the audio engine mutes asynchronously, await
`activateSilentQaAsync()`; passing a promise-returning callback to the
synchronous function throws instead of publishing a premature readiness
marker.

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
exception: verify audio behavior through programmatic state, mocks, or
analyser assertions while agent-controlled playback remains muted.

Keep `reuseExistingServer` false for release evidence and assert the game
identity before exercising a journey. A process from another repository on a
familiar port must never be accepted as proof.
