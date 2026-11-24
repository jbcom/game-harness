import { type Browser, type BrowserContext, chromium, type Page } from '@playwright/test';
import getPort from 'get-port';
import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedTouch, ScriptedTouchError } from '../../src/touch.js';

const headless = process.env.HEAVY_BROWSER_HEADLESS === '1';

/** The phone reference of the placement-mode cases: 390 x 844 CSS px, touch, mobile. */
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const;

interface Recorded {
  type: string;
  id: number;
  x: number;
  y: number;
  /** `event.timeStamp`, the browser's own event time. */
  at: number;
  /** `performance.now()` when the page handled the event. */
  seen: number;
  pointerType: string;
}

/**
 * Records every pointer event and click, and arms a 500 ms "chip" timer on
 * pointer down the way a press-and-hold recognizer does, cleared on up/cancel.
 */
const RECORDER_PAGE = `data:text/html,${encodeURIComponent(`<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html, body { margin: 0; height: 100%; touch-action: none; user-select: none; }</style>
<body>
<div id="badge" style="position:absolute;left:100px;top:300px;width:60px;height:40px;background:#888"></div>
<script>
  window.events = [];
  window.chip = false;
  let timer;
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click']) {
    addEventListener(type, (event) => {
      // A headed window under a real mouse pointer also reports mouse events.
      if (event.pointerType !== 'touch') return;
      window.events.push({ type, id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, seen: performance.now(), pointerType: event.pointerType });
      if (type === 'pointerdown') timer = setTimeout(() => { window.chip = true; }, 500);
      if (type === 'pointerup' || type === 'pointercancel') { clearTimeout(timer); }
    });
  }
</script></body>`)}`;

let browser: Browser | undefined;

afterEach(async () => {
  await browser?.close();
  browser = undefined;
});

async function openPhone(): Promise<{ page: Page; context: BrowserContext }> {
  browser = await chromium.launch({ headless });
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await page.goto(RECORDER_PAGE);
  return { page, context };
}

const events = (page: Page): Promise<Recorded[]> =>
  page.evaluate(() => (window as unknown as { events: Recorded[] }).events);

const chip = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as { chip: boolean }).chip);

describe('scripted touch on a phone-sized Playwright context', () => {
  it('taps with real touch pointer events, a click, and the exact press time', async () => {
    const { page } = await openPhone();
    const touch = await createScriptedTouch(page);
    await touch.tap({ x: 120, y: 320 }, { pressMs: 50 });
    await touch.close();

    const recorded = await events(page);
    expect(recorded.map((event) => event.type)).toEqual(['pointerdown', 'pointerup', 'click']);
    expect(recorded.every((event) => event.pointerType === 'touch')).toBe(true);
    expect(recorded.map((event) => [event.x, event.y])).toEqual([
      [120, 320],
      [120, 320],
      [120, 320],
    ]);
    // Scheduled stamps make the event-time gap the requested one, to the microsecond.
    expect((recorded[1]?.at ?? 0) - (recorded[0]?.at ?? 0)).toBeCloseTo(50, 0);
  });

  it('double taps with the requested gap, whether quick or slow', async () => {
    const { page } = await openPhone();
    const touch = await createScriptedTouch(page);
    await touch.doubleTap({ x: 120, y: 320 }, { gapMs: 100 });
    await touch.wait(0);
    await touch.doubleTap({ x: 120, y: 320 }, { gapMs: 1_200, secondTarget: { x: 130, y: 330 } });

    const downs = (await events(page)).filter((event) => event.type === 'pointerdown');
    const ups = (await events(page)).filter((event) => event.type === 'pointerup');
    expect(downs).toHaveLength(4);
    expect((downs[1]?.at ?? 0) - (ups[0]?.at ?? 0)).toBeCloseTo(100, 0);
    expect((downs[3]?.at ?? 0) - (ups[2]?.at ?? 0)).toBeCloseTo(1_200, 0);
    expect([downs[3]?.x, downs[3]?.y]).toEqual([130, 330]);
    await touch.close();
  });

  it('holds a finger down for the whole duration and lets the page read state mid-gesture', async () => {
    const { page } = await openPhone();
    const touch = await createScriptedTouch(page);

    const short = await touch.hold({ x: 120, y: 320 }, { durationMs: 300, release: false });
    expect(await chip(page)).toBe(false);
    expect(short.released).toBe(false);
    await short.release();

    const startedAt = Date.now();
    const long = await touch.hold({ x: 120, y: 320 }, { durationMs: 650, release: false });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(650);
    expect(await chip(page)).toBe(true);
    expect((await events(page)).filter((event) => event.type === 'pointerup')).toHaveLength(1);
    await long.release();
    expect((await events(page)).filter((event) => event.type === 'pointerup')).toHaveLength(2);
    await touch.close();
  });

  it('press-drags in bounded steps and finishes exactly on the target', async () => {
    const { page } = await openPhone();
    const touch = await createScriptedTouch(page);
    const finger = await touch.pressDrag(
      { x: 100, y: 400 },
      { x: 300, y: 430 },
      { holdMs: 120, stepPx: 12, durationMs: 400 },
    );
    expect(finger.released).toBe(true);

    const recorded = await events(page);
    const moves = recorded.filter((event) => event.type === 'pointermove');
    const down = recorded.find((event) => event.type === 'pointerdown');
    const up = recorded.find((event) => event.type === 'pointerup');
    expect(moves.length).toBeGreaterThanOrEqual(Math.ceil(Math.hypot(200, 30) / 12));
    let previous = { x: down?.x ?? 0, y: down?.y ?? 0 };
    for (const move of moves) {
      expect(Math.hypot(move.x - previous.x, move.y - previous.y)).toBeLessThanOrEqual(12.0001);
      previous = move;
    }
    expect([previous.x, previous.y]).toEqual([300, 430]);
    expect([up?.x, up?.y]).toEqual([300, 430]);
    // Nothing moves during the rest, and the whole drag takes the time asked for.
    expect((moves[0]?.at ?? 0) - (down?.at ?? 0)).toBeGreaterThanOrEqual(120);
    expect((up?.at ?? 0) - (down?.at ?? 0)).toBeCloseTo(120 + 400, 0);
    await touch.close();
  });

  it('keeps a second finger separate from the first and can cancel it', async () => {
    const { page } = await openPhone();
    const touch = await createScriptedTouch(page);
    const first = await touch.press({ x: 100, y: 400 });
    await first.moveTo({ x: 160, y: 400 }, { stepPx: 20 });
    const second = await touch.press({ x: 250, y: 600 });
    await second.release();
    await first.moveTo({ x: 200, y: 400 });
    await touch.cancel();
    expect(first.released).toBe(true);

    const recorded = await events(page);
    const downs = recorded.filter((event) => event.type === 'pointerdown');
    expect(new Set(downs.map((event) => event.id)).size).toBe(2);
    const secondId = downs[1]?.id;
    expect(recorded.find((event) => event.type === 'pointerup')?.id).toBe(secondId);
    expect(recorded.find((event) => event.type === 'pointercancel')?.id).toBe(downs[0]?.id);
    // The first finger kept moving after the second one went away.
    const lastMove = recorded.filter((event) => event.type === 'pointermove').at(-1);
    expect([lastMove?.id, lastMove?.x]).toEqual([downs[0]?.id, 200]);
    await expect(first.release()).rejects.toThrow(/already released/u);
    await touch.close();
  });

  it('targets the centre of an element', async () => {
    const { page } = await openPhone();
    const touch = await createScriptedTouch(page);
    await touch.tap(page.locator('#badge'));
    const down = (await events(page)).find((event) => event.type === 'pointerdown');
    expect([down?.x, down?.y]).toEqual([130, 320]);
    await touch.close();
  });

  it('works without stamps, leaving the browser to stamp each event', async () => {
    const { page } = await openPhone();
    const touch = await createScriptedTouch(page, { timestamps: 'dispatch' });
    await touch.tap({ x: 50, y: 50 });
    expect((await events(page)).map((event) => event.type)).toEqual([
      'pointerdown',
      'pointerup',
      'click',
    ]);
    await touch.close();
  });

  it('records a trace whose planned gaps are exact and whose sends are never early', async () => {
    const { page } = await openPhone();
    const touch = await createScriptedTouch(page);
    await touch.hold({ x: 120, y: 320 }, { durationMs: 200 });
    const [start, end] = touch.trace;
    expect(end?.plannedMs).toBeCloseTo((start?.plannedMs ?? 0) + 200, 6);
    expect(end?.actualMs ?? 0).toBeGreaterThanOrEqual((start?.actualMs ?? 0) + 200);
    expect((start?.actualMs ?? 0) - (start?.plannedMs ?? 0)).toBeGreaterThanOrEqual(0);
    await touch.close();
  });

  it('refuses a page that has no touch support', async () => {
    browser = await chromium.launch({ headless });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(RECORDER_PAGE);
    await expect(createScriptedTouch(page)).rejects.toThrow(ScriptedTouchError);
    await expect(createScriptedTouch(page)).rejects.toThrow(/hasTouch: true/u);
  });
});

describe('scripted touch over a DevTools endpoint, as on an Android WebView', () => {
  it('drives a page through a protocol session reached with connectOverCDP', async () => {
    const port = await getPort();
    browser = await chromium.launch({ headless, args: [`--remote-debugging-port=${port}`] });
    const remote = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    try {
      const context = remote.contexts()[0] ?? (await remote.newContext());
      const page = await context.newPage();
      const session = await context.newCDPSession(page);
      // A WebView reports touch support itself; a desktop Chromium needs it switched on.
      await session.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 5,
      });
      await page.goto(RECORDER_PAGE);

      const touch = await createScriptedTouch(session);
      await touch.hold({ x: 120, y: 320 }, { durationMs: 600, release: false });
      expect(await chip(page)).toBe(true);
      await touch.close();
      const recorded = await events(page);
      expect(recorded.map((event) => event.type)).toEqual(['pointerdown', 'pointercancel']);
      expect(recorded.every((event) => event.pointerType === 'touch')).toBe(true);
    } finally {
      await remote.close();
    }
  });
});
