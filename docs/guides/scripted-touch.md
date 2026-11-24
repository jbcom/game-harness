---
title: Scripted touch
description: Tap, double tap, press-drag and hold with stable timing, on a phone-sized Playwright context or an Android WebView.
---

`game-harness/touch` drives real touch input in Chromium. It sends
`Input.dispatchTouchEvent` over the DevTools protocol, so the page receives
genuine `pointerType: "touch"` pointer events and touch events, with the
browser's own hit testing, touch slop and gesture handling. Nothing is
synthesised inside the page, and nothing in the API names a game.

The same driver runs on a Playwright page and, through
`game-harness/android-webview`, on a debuggable Android WebView. Both entry
points are peer-free: they depend on a protocol session, not on Playwright's
types.

## A phone-sized page

Create the context the way a phone would be: with touch and the mobile
viewport. The driver refuses a page whose `navigator.maxTouchPoints` is 0
rather than drive a layout a phone player would never see. That is the only
thing it checks: it does not verify `isMobile`, so set it yourself for a phone
test.

```ts
import { chromium } from '@playwright/test';
import { createScriptedTouch } from 'game-harness/touch';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
await page.goto(gameUrl);

const touch = await createScriptedTouch(page);
```

The surface under the finger must opt out of browser panning with
`touch-action: none` (on the canvas, or on `html` and `body` when the canvas
does not cover the viewport). Otherwise the browser may take a drag over and the
page receives `pointercancel`, exactly as it would on a phone.

Coordinates are CSS pixels relative to the viewport. A target is a point, or
anything with `boundingBox()` such as a Playwright locator, in which case the
touch lands on its centre.

## Gestures

```ts
await touch.tap({ x: 120, y: 320 }); // 50 ms press
await touch.tap(page.getByRole('button', { name: 'Open' })); // a locator's centre

// Two taps; the second lands gapMs after the first lifts. Any gap works.
await touch.doubleTap(point, { gapMs: 100 });
await touch.doubleTap(point, { gapMs: 5_000, secondTarget: otherPoint });

// Press, move in steps of at most stepPx, lift.
await touch.pressDrag(from, to, { holdMs: 120, stepPx: 12, durationMs: 400 });
await touch.pressDrag(from, [waypointA, waypointB], { steps: 4 });

// Hold, and read the page while the finger is still down.
const finger = await touch.hold(point, { durationMs: 600, release: false });
await expectOverlayVisible(page);
await finger.release();
```

`pressDrag` and `hold` return the finger. Pass `release: false` to keep it
down, read the page mid-gesture, then continue:

```ts
const finger = await touch.press(point); // a finger stays down
await finger.moveTo(target, { stepPx: 8 }); // events along the way
await finger.hold(250); // stay down 250 ms more
const second = await touch.press(otherPoint); // a second finger, simultaneous
await second.release(); // lift one finger at a time
await finger.release();
```

To have the system take the gesture over instead, call `touch.cancel()` while
fingers are down: the page sees `pointercancel` and every finger is released,
so do not release them afterwards.

Each call must be awaited before the next starts; overlapping calls reject.
Fingers are numbered from 1 in the order they went down. The protocol cannot
cancel one finger alone, so `touch.cancel()` ends every finger that is down.
`touch.close()` cancels anything still down and, for a session the driver
opened, detaches it.

Chromium aligns `pointermove` with frames and may coalesce moves that arrive
between two frames; read `event.getCoalescedEvents()` where every intermediate
point matters. Keep `stepPx` below the distance your page treats as one unit.

## Timing

Timing is the reason this is a driver and not a handful of `setTimeout`s.

- **Planned time is exact.** The driver keeps a timeline in which each delay is
  exactly the duration asked for: `pressMs`, `gapMs`, `holdMs`, `durationMs`.
- **Event time follows the plan.** By default each event is stamped with its
  planned time, converted to the browser's clock, so `event.timeStamp` gaps
  inside the page are the requested ones even when the host is slow or busy.
  Pass `{ timestamps: 'dispatch' }` to send no stamp and let the browser stamp
  events on arrival.
- **Wall time is never early.** A delay is measured on the wall clock from the
  call, so a timer armed by the page on `pointerdown` (a press-and-hold
  recognizer, say) has always had the full duration when the next event
  arrives. A slow send makes the gesture later, never shorter.
- **Moves keep a schedule.** The steps of a drag follow one schedule from the
  start of the move, so a slow step is made up by the next instead of
  stretching the drag. The default is one step per 16 ms.
- **A trace of what happened.** `touch.trace` lists every event sent, with
  `plannedMs` and `actualMs` since the session began, so a test can assert the
  gaps it cares about and see how late a loaded machine ran.

After more than 250 ms of idle time between calls the plan is moved up to the
present, so stamps stay close to real time. A shorter idle gap between two
separate calls is not part of the plan, so use `doubleTap({ gapMs })` or
`touch.wait(ms)` between two taps whose spacing matters; both advance the plan
by exactly the time asked for.

## Android WebView

`game-harness/android-webview` finds the DevTools socket of the running app and
forwards it to a local port. Connect Playwright to it and use the same driver:

```ts
import { chromium } from '@playwright/test';
import { forwardAndroidWebView } from 'game-harness/android-webview';
import { createScriptedTouch } from 'game-harness/touch';

const forward = await forwardAndroidWebView({ appId: 'com.example.game' });
try {
  const browser = await chromium.connectOverCDP(forward.endpoint);
  try {
    const page = browser.contexts()[0].pages()[0];
    const touch = await createScriptedTouch(page);
    try {
      // ... the same gestures, in CSS pixels of the WebView's viewport ...
    } finally {
      await touch.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  await forward.close();
}
```

Requirements and limits:

- `adb` on the host and the app already running (launch it as the first-launch
  guidance in [Chromium launch profile & Silent QA](/game-harness/guides/chromium-and-silent-qa/)
  describes, so the mute marker is asserted before any gesture).
- A debuggable WebView: a debug build with WebView debugging enabled. A release
  build exposes no DevTools socket and `forwardAndroidWebView()` says so.
- With more than one device attached, pass `serial`.
- By default `adb` picks a free local port. A fixed `localPort` is forwarded with
  `--no-rebind`, so a port another client already forwards fails instead of
  being taken from it. The forward uses the socket name found on the device,
  suffix included.
- An `adb` failure such as "no devices/emulators found" is reported as such; only
  a silent `pidof` miss is reported as "not running".
- Coordinates are CSS pixels, so no device-pixel or status-bar mapping is needed.
- Verified here: the driver against Chromium reached over a DevTools endpoint
  with `connectOverCDP()` (the same path), and the `adb` sequence against a
  scripted `adb`. Not verified here: a physical device or emulator image, which
  this package's CI does not have. Run one gesture on the target device before
  relying on its timings.
