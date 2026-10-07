import { afterEach, describe, expect, it } from 'vitest';
import {
  CHROMIUM_ANTI_THROTTLING_ARGS,
  createChromiumLaunchProfile,
} from '../../src/chromium-launch.js';
import { launchRawChromium, type RawChromium } from './support/raw-chromium.js';

const INTERVAL_MS = 50;
const WINDOW_MS = 3_000;
const EXPECTED_TICKS = WINDOW_MS / INTERVAL_MS;
/** Chromium aligns a throttled background tab's timers to one wake-up per second. */
const THROTTLED_GAP_MS = 900;

const TIMER_PAGE = `data:text/html,${encodeURIComponent(
  `<!doctype html><title>timer</title><script>
    window.ticks = [];
    setInterval(() => window.ticks.push(performance.now()), ${INTERVAL_MS});
  </script>`,
)}`;

interface TimerSample {
  visibility: DocumentVisibilityState;
  ticks: number;
  maxGapMs: number;
}

let browser: RawChromium | undefined;

afterEach(async () => {
  await browser?.close();
  browser = undefined;
});

/**
 * Starts a 50 ms timer in one tab, opens a second tab in front of it so the
 * first becomes a background tab, and samples the timer for three seconds.
 */
async function sampleBackgroundTimer(args: readonly string[]): Promise<TimerSample> {
  browser = await launchRawChromium(args);
  const timerTab = await browser.openTab(TIMER_PAGE);
  await browser.evaluate(
    timerTab,
    'new Promise((resolve) => setTimeout(resolve, 300)).then(() => window.ticks.length)',
  );
  await browser.openForegroundTab('about:blank');
  await browser.evaluate(
    timerTab,
    `new Promise((resolve) => {
      const settle = () => { window.ticks.length = 0; resolve(); };
      if (document.visibilityState === 'hidden') setTimeout(settle, 0);
      else document.addEventListener('visibilitychange', () => setTimeout(settle, 0), { once: true });
    })`,
  );
  await new Promise((resolve) => setTimeout(resolve, WINDOW_MS));
  return browser.evaluate<TimerSample>(
    timerTab,
    `(() => {
      const ticks = window.ticks.slice();
      let maxGapMs = 0;
      for (let index = 1; index < ticks.length; index += 1) {
        maxGapMs = Math.max(maxGapMs, ticks[index] - ticks[index - 1]);
      }
      return { visibility: document.visibilityState, ticks: ticks.length, maxGapMs };
    })()`,
  );
}

describe('Chromium launch profile in a real headed browser', () => {
  it('keeps a background tab timer on schedule', async () => {
    const sample = await sampleBackgroundTimer(createChromiumLaunchProfile().args);

    // The page really is backgrounded, and still sees it: visibility handling stays testable.
    expect(sample.visibility).toBe('hidden');
    expect(sample.maxGapMs).toBeLessThan(THROTTLED_GAP_MS / 2);
    expect(sample.ticks).toBeGreaterThanOrEqual(EXPECTED_TICKS / 2);
  });

  it('control: the same background tab is throttled without the anti-throttling switches', async () => {
    const args = createChromiumLaunchProfile().args.filter(
      (argument) => !CHROMIUM_ANTI_THROTTLING_ARGS.includes(argument),
    );
    const sample = await sampleBackgroundTimer(args);

    // Proves the scenario above actually backgrounds the tab on this machine,
    // so its passing result is evidence rather than an environment accident.
    expect(sample.visibility).toBe('hidden');
    expect(sample.maxGapMs).toBeGreaterThanOrEqual(THROTTLED_GAP_MS);
    expect(sample.ticks).toBeLessThan(EXPECTED_TICKS / 4);
  });
});
