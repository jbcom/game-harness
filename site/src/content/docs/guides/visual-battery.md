---
title: Visual battery
description: Deterministic, fail-closed screenshot baseline orchestration.
---

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

When two renderers cannot produce byte-identical PNGs, keep strict profiles
instead of adding a pixel threshold. Pass `baselineProfile: 'linux'`; the
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
const canvas = document.querySelector('canvas');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('canvas missing');
await page.elementLocator(canvas).screenshot({ path: '__screenshots__/scene.png' });
```

If a canvas baseline is stable alone but changes after other harnesses have
run in the same long-lived Chromium process, isolate that file so it gets a
fresh browser process while the remaining files stay in one fast batch:

```ts
runVisualBattery('tests/harness', {
  isolatedHarnessFiles: ['scene.browser.test.tsx'],
});
```
