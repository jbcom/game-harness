---
title: Visual battery
description: Deterministic, fail-closed screenshot baseline orchestration.
---

Modified PNGs are decoded and compared against `HEAD` pixel by pixel.
`maxChannelDelta` defaults to 2 (integer 0–255): a pixel differs only when
its maximum absolute RGBA channel delta exceeds this tolerance.
`maxDifferentPixelRatio` defaults to 0 (range 0–1): any pixel beyond the
channel tolerance is drift. Dimension changes, new/deleted baselines, and
unreadable PNGs always count as drift. Accepted renders are restored to
committed bytes; noise-only files log `rasterization noise (N px within ±2)`.
The CI dirty-start check still rejects all uncommitted baseline changes.

```ts
runVisualBattery('tests/harness', {
  ci: true,
  maxChannelDelta: 2,
  maxDifferentPixelRatio: 0,
});
```

CLI equivalents: `--max-channel-delta 2 --max-different-pixel-ratio 0`.
Use a channel delta of 0 for exact decoded pixels. Raising the ratio explicitly
permits some pixels beyond the tolerance; do so deliberately.

Run the default harness directory in update mode, or enforce committed
baselines in CI:

```sh
pnpm exec game-harness-visual-battery tests/harness
pnpm exec game-harness-visual-battery tests/harness --ci
```

`test-harness-visual-battery` remains as a compatibility alias. Programmatic
callers can pass `testCommand: { command, args }`; the executable and
discovered harness paths are invoked directly rather than interpolated
through a shell.

`runVisualBattery()` owns one canonical `__screenshots__` tree directly under
the configured harness directory. Vitest screenshot paths are relative to the
test file, so a harness must write `__screenshots__/name.png`, not a
repository-relative path such as `tests/harness/__screenshots__/name.png`.
The battery rejects any second `__screenshots__` directory nested elsewhere
under the harness tree; otherwise an apparently green run could leave an
important screenshot outside the Git diff gate.

When renderers produce genuinely different pixels, keep separate profiles.
Pass `baselineProfile: 'linux'`; the
battery compares `__screenshots__/linux/` and exposes the same value to Vite
as `VITE_VISUAL_BASELINE_PROFILE`. Screenshot helpers should include that
optional directory in their path:

```ts
const profile = import.meta.env.VITE_VISUAL_BASELINE_PROFILE?.trim();
const path = profile ? `__screenshots__/${profile}/scene.png` : '__screenshots__/scene.png';
```

`baselinesDir` names the baseline root. When it is combined with
`baselineProfile`, the profile is always appended below that root. For
example, `{ baselinesDir: 'visual-baselines', baselineProfile: 'linux' }`
owns and diffs `visual-baselines/linux/`.

For WebGL scenes, capture the canvas locator instead of the full browser
page:

```ts
await page.locator('canvas').screenshot({ path: '__screenshots__/scene.png' });
```

If a canvas baseline is stable alone but changes after other harnesses have
run in the same long-lived Chromium process, isolate that file so it gets a
fresh browser process while the remaining files stay in one fast batch:

```ts
runVisualBattery('tests/harness', {
  isolatedHarnessFiles: ['scene.browser.test.tsx'],
});
```
