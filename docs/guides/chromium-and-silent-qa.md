---
title: Chromium launch profile & Silent QA
description: The peer-free primitives behind every silent browser launch.
---

```ts
import { chromium } from '@playwright/test';
import { createChromiumLaunchProfile } from 'game-harness/chromium';

const { args, env } = createChromiumLaunchProfile({
  gpuMode: process.platform === 'linux' && process.env.CI ? 'linux-hardware-vulkan' : 'auto',
});
const browser = await chromium.launch({ args, env, headless: false });
```

`createChromiumLaunchProfile()` is the peer-free primitive behind both
`definePlaywrightConfig()` and `defineBrowserTestConfig()` — use it directly
when driving Chromium yourself (a custom launch script, `production-runtime`'s
own internals, or a non-Playwright automation layer). It resolves one of
four renderer policies (`auto` leaves selection to Chromium; `software`
opts into SwiftShader explicitly; `linux-hardware-vulkan` applies the
reviewed Mesa/ANGLE flags plus `EGL_PLATFORM=surfaceless` for a runner
exposing `/dev/dri/renderD128`; `macos-hardware-metal` asks ANGLE for its
Metal backend with `--use-angle=metal --ignore-gpu-blocklist`, which a
headless Chromium on an Apple Silicon Mac with no window session honours by
using the real GPU) and always de-duplicates and appends
`--mute-audio` last, so a caller-supplied arg list can never accidentally
drop the silence guard.

Every profile also carries `CHROMIUM_ANTI_THROTTLING_ARGS`:
`--disable-background-timer-throttling`, `--disable-renderer-backgrounding`
and `--disable-backgrounding-occluded-windows`. When several headed windows
run at once, Chromium would otherwise coalesce a background tab's timers to
one wake-up per second and deprioritise occluded windows, and suites time out
for reasons unrelated to the game. Page Visibility is unaffected: a
backgrounded page still reports `hidden`, so pause-on-hide logic stays
testable.

Every browser launched by `definePlaywrightConfig()` or
`defineBrowserTestConfig()` receives Chromium's `--mute-audio` argument as a
defense-in-depth guard, including projects with custom launch options. The
application must also expose a non-persistent mute mode so tests fail closed
before interacting with it:

```ts
import { activateSilentQa } from 'game-harness/silent-qa';
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
import { openSilentGame } from 'game-harness/playwright';

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

## Native first bootstrap

An identical native APK can opt into silence through its initial launch URL.
`resolveSilentQaSearch()` awaits a consumer-supplied launch reader, validates
the absolute URL, and copies only the mute request from an explicitly accepted
route into the browser query. It has no native, audio, DOM or storage dependency.

```ts
import { resolveSilentQaSearch } from 'game-harness/silent-qa';

const search = await resolveSilentQaSearch({
  search: window.location.search,
  nativeLaunch: {
    readUrl: async () => (await NativeApp.getLaunchUrl())?.url,
    accepts: (url) => url.protocol === 'example:' && url.hostname === 'qa' && url.pathname === '/',
  },
});
activateSilentQa(muteBothEnginesWithoutPersisting, { search });
mountGame();
```

The consumer owns platform detection and the accepted route. Omit `nativeLaunch`
on web. Ordinary launches without a URL or without the mute parameter retain the
original browser query. Other native parameters (debug, progression, entitlement)
are never imported. Malformed URLs and reader/policy errors reject: display a
bootstrap failure and a retry action; never catch them by mounting unmuted.
Await resolution and activate the engine override **before** rendering any game
control, binding gameplay input or initializing audio. The resolver itself does
not publish the readiness marker; only successful engine activation can do so.

For Capacitor Android, `App.getLaunchUrl()` reads the cached initial intent URI.
A QA runner may cold-start the explicit component with intent data, for example
`adb shell am start -W -n example.app/.MainActivity -a android.intent.action.VIEW -d 'example://qa/?muted=1'`.
Explicit component dispatch and the actual WebView marker still require native
runtime proof. Warm `appUrlOpen` events are a separate lifecycle contract; do not
assume `getLaunchUrl()` changes on warm resume. A runner must assert the runtime
marker before any gameplay interaction and preserve saved audio preferences.
