import * as timers from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  createScriptedTouch,
  ScriptedTouchError,
  type ScriptedTouchOptions,
  systemTouchClock,
  type TouchCdpSession,
  type TouchClock,
} from '../src/touch.js';

vi.mock('node:timers/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:timers/promises')>();
  return { ...actual, setTimeout: vi.fn(actual.setTimeout) };
});

/** A clock that only moves when something sleeps or a send takes time, so no test really waits. */
function virtualClock(startEpochMs = 1_700_000_000_000) {
  const state = { t: 0 };
  const clock: TouchClock = {
    now: () => state.t,
    epochMs: () => startEpochMs + state.t,
    sleepUntil: async (deadline) => {
      if (deadline > state.t) state.t = deadline;
    },
  };
  return { clock, state };
}

interface Sent {
  type: string;
  touchPoints: { id: number; x: number; y: number }[];
  timestamp?: number;
}

interface FakeOptions {
  touchPoints?: number;
  browserAheadMs?: number;
  probe?: unknown;
  latencyMs?: number;
}

function fakeSession(options: FakeOptions = {}) {
  const { clock, state } = virtualClock();
  const sent: Sent[] = [];
  const session = {
    send: vi.fn(async (method: string, params?: object) => {
      if (method === 'Runtime.evaluate') {
        return (
          options.probe ?? {
            result: {
              value: {
                touchPoints: options.touchPoints ?? 5,
                now: clock.epochMs() + (options.browserAheadMs ?? 0),
              },
            },
          }
        );
      }
      state.t += options.latencyMs ?? 0;
      sent.push(params as Sent);
      return {};
    }),
    detach: vi.fn().mockResolvedValue(undefined),
  } satisfies TouchCdpSession;
  return { session, sent, clock, state };
}

async function open(options: FakeOptions = {}, touchOptions: ScriptedTouchOptions = {}) {
  const fake = fakeSession(options);
  const touch = await createScriptedTouch(fake.session, { clock: fake.clock, ...touchOptions });
  return { ...fake, touch };
}

describe('createScriptedTouch', () => {
  it('opens its own protocol session from a page and detaches it on close', async () => {
    const fake = fakeSession();
    const newCDPSession = vi.fn().mockResolvedValue(fake.session);
    const page = { context: () => ({ newCDPSession }) };
    const touch = await createScriptedTouch(page, { clock: fake.clock });
    expect(newCDPSession).toHaveBeenCalledWith(page);
    await touch.close();
    expect(fake.session.detach).toHaveBeenCalledOnce();
  });

  it('leaves a session it was handed attached, and tolerates a session that cannot detach', async () => {
    const { session, touch } = await open();
    await touch.close();
    expect(session.detach).not.toHaveBeenCalled();

    const fake = fakeSession();
    const bare = { send: fake.session.send };
    const bareTouch = await createScriptedTouch(bare, { clock: fake.clock });
    await bareTouch.close();
    const page = { context: () => ({ newCDPSession: async () => bare }) };
    await (await createScriptedTouch(page, { clock: fake.clock })).close();
  });

  it('refuses a page without touch support and detaches the session it opened', async () => {
    const fake = fakeSession({ touchPoints: 0 });
    const page = { context: () => ({ newCDPSession: async () => fake.session }) };
    await expect(createScriptedTouch(page, { clock: fake.clock })).rejects.toThrow(
      /hasTouch: true/u,
    );
    expect(fake.session.detach).toHaveBeenCalledOnce();

    const handed = fakeSession({ touchPoints: 0 });
    await expect(createScriptedTouch(handed.session, { clock: handed.clock })).rejects.toThrow(
      ScriptedTouchError,
    );
    expect(handed.session.detach).not.toHaveBeenCalled();
  });

  it.each([
    ['an exception in the page', { exceptionDetails: { text: 'boom' } }, /boom/u],
    ['an empty result', {}, /no result/u],
    ['a result without touch points', { result: { value: { now: 1 } } }, /no result/u],
    ['a result without a clock', { result: { value: { touchPoints: 1 } } }, /no result/u],
  ])('rejects %s when reading touch support', async (_name, probe, message) => {
    const fake = fakeSession({ probe });
    await expect(createScriptedTouch(fake.session, { clock: fake.clock })).rejects.toThrow(message);
  });

  it('uses the system clock by default', async () => {
    const fake = fakeSession();
    const touch = await createScriptedTouch(fake.session);
    await touch.tap({ x: 1, y: 1 }, { pressMs: 0 });
    expect(fake.sent.map((event) => event.type)).toEqual(['touchStart', 'touchEnd']);
  });
});

describe('systemTouchClock', () => {
  it('sleeps until a deadline without returning early, and returns at once for a past one', async () => {
    const before = systemTouchClock.now();
    await systemTouchClock.sleepUntil(before + 20);
    expect(systemTouchClock.now()).toBeGreaterThanOrEqual(before + 20);
    expect(Math.abs(systemTouchClock.epochMs() - Date.now())).toBeLessThan(50);
  });

  it('starts no timer for a deadline that has already passed', async () => {
    vi.mocked(timers.setTimeout).mockClear();
    await systemTouchClock.sleepUntil(systemTouchClock.now() - 1_000);
    expect(timers.setTimeout).not.toHaveBeenCalled();
  });

  it('keeps sleeping when a timer fires early', async () => {
    const real = performance.now.bind(performance);
    const start = real();
    let calls = 0;
    // The first two readings say the deadline is still ahead after a sleep.
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      calls += 1;
      return calls <= 2 ? start : real();
    });
    await systemTouchClock.sleepUntil(start + 5);
    spy.mockRestore();
    expect(real()).toBeGreaterThanOrEqual(start + 5);
    expect(calls).toBeGreaterThan(2);
  });
});

describe('tap and double tap', () => {
  it('puts a finger down and lifts it after exactly pressMs of planned time', async () => {
    const { touch, sent } = await open({ latencyMs: 3 });
    await touch.tap({ x: 120, y: 320 }, { pressMs: 50 });
    expect(sent.map((event) => [event.type, event.touchPoints])).toEqual([
      ['touchStart', [{ id: 1, x: 120, y: 320 }]],
      ['touchEnd', [{ id: 1, x: 120, y: 320 }]],
    ]);
    const [down, up] = touch.trace;
    expect(up?.plannedMs).toBe((down?.plannedMs ?? 0) + 50);
    // The send took 3 ms, so the lift goes out 50 ms after the down was sent, never sooner.
    expect(up?.actualMs).toBe((down?.actualMs ?? 0) + 53);
  });

  it('defaults to a 50 ms press', async () => {
    const { touch } = await open();
    await touch.tap({ x: 1, y: 1 });
    expect(touch.trace.map((entry) => entry.plannedMs)).toEqual([0, 50]);
  });

  it('double taps with the requested gap, a quick one or the slowest allowed', async () => {
    for (const gapMs of [100, 5_000]) {
      const { touch } = await open();
      await touch.doubleTap({ x: 10, y: 20 }, { gapMs });
      expect(touch.trace.map((entry) => [entry.type, entry.plannedMs])).toEqual([
        ['touchStart', 0],
        ['touchEnd', 50],
        ['touchStart', 50 + gapMs],
        ['touchEnd', 100 + gapMs],
      ]);
    }
  });

  it('defaults to a 100 ms gap and can land the second tap elsewhere', async () => {
    const { touch, sent } = await open();
    await touch.doubleTap({ x: 10, y: 20 }, { pressMs: 30, secondTarget: { x: 40, y: 50 } });
    expect(touch.trace.map((entry) => entry.plannedMs)).toEqual([0, 30, 130, 160]);
    expect(sent.map((event) => event.touchPoints[0]?.x)).toEqual([10, 10, 40, 40]);
  });

  it('stamps events with their planned time in the browser clock', async () => {
    const { touch, sent, clock } = await open({ browserAheadMs: 5_000 });
    const origin = clock.epochMs();
    await touch.tap({ x: 1, y: 1 }, { pressMs: 50 });
    expect(sent[0]?.timestamp).toBeCloseTo((origin + 5_000) / 1000, 6);
    expect(sent[1]?.timestamp).toBeCloseTo((origin + 5_050) / 1000, 6);
  });

  it('sends no stamp when asked to let the browser stamp events', async () => {
    const { touch, sent } = await open({}, { timestamps: 'dispatch' });
    await touch.tap({ x: 1, y: 1 });
    expect(sent.every((event) => !('timestamp' in event))).toBe(true);
  });
});

describe('hold', () => {
  it('keeps the finger down for the duration and lifts it by default', async () => {
    const { touch, sent } = await open({ latencyMs: 2 });
    const finger = await touch.hold({ x: 5, y: 6 }, { durationMs: 600 });
    expect(finger.released).toBe(true);
    expect(sent.map((event) => event.type)).toEqual(['touchStart', 'touchEnd']);
    const [down, up] = touch.trace;
    expect(up?.plannedMs).toBe((down?.plannedMs ?? 0) + 600);
    expect(up?.actualMs ?? 0).toBeGreaterThanOrEqual((down?.actualMs ?? 0) + 600);
  });

  it('leaves the finger down on request and lets the caller extend, then release it', async () => {
    const { touch, sent } = await open();
    const finger = await touch.hold({ x: 5, y: 6 }, { durationMs: 100, release: false });
    expect(finger).toMatchObject({ id: 1, position: { x: 5, y: 6 }, released: false });
    expect(sent.map((event) => event.type)).toEqual(['touchStart']);
    await finger.hold(400);
    await finger.release();
    expect(touch.trace.map((entry) => entry.plannedMs)).toEqual([0, 500]);
    expect(finger.released).toBe(true);
  });
});

describe('press-drag', () => {
  it('moves in steps no longer than stepPx and ends exactly on the target', async () => {
    const { touch, sent } = await open();
    await touch.pressDrag({ x: 100, y: 400 }, { x: 300, y: 430 }, { stepPx: 12, durationMs: 400 });
    const moves = sent.filter((event) => event.type === 'touchMove');
    expect(moves).toHaveLength(Math.ceil(Math.hypot(200, 30) / 12));
    let previous = { x: 100, y: 400 };
    for (const move of moves) {
      const point = move.touchPoints[0] ?? previous;
      expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeLessThanOrEqual(12.0001);
      previous = point;
    }
    expect(previous).toEqual({ id: 1, x: 300, y: 430 });
    expect(sent.at(-1)).toMatchObject({ type: 'touchEnd', touchPoints: [{ x: 300, y: 430 }] });
    // The travel takes exactly durationMs of planned time.
    expect(touch.trace.at(-1)?.plannedMs).toBeCloseTo(400, 6);
  });

  it('rests before moving and before lifting, and defaults to one frame per step', async () => {
    const { touch } = await open();
    await touch.pressDrag(
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { holdMs: 120, stepPx: 100, settleMs: 30 },
    );
    expect(touch.trace.map((entry) => [entry.type[5], entry.plannedMs])).toEqual([
      ['S', 0],
      ['M', 120 + 16],
      ['M', 120 + 32],
      ['E', 120 + 32 + 30],
    ]);
  });

  it('goes through several targets in order, sharing the time by length', async () => {
    const { touch, sent } = await open();
    await touch.pressDrag(
      { x: 0, y: 0 },
      [
        { x: 30, y: 0 },
        { x: 30, y: 40 },
      ],
      { stepPx: 10 },
    );
    const moves = sent.filter((event) => event.type === 'touchMove');
    expect(moves.map((event) => event.touchPoints[0]?.y)).toEqual([0, 0, 0, 10, 20, 30, 40]);
    expect(moves.at(2)?.touchPoints[0]?.x).toBe(30);
    expect(touch.trace.at(-1)?.plannedMs).toBe(7 * 16);
  });

  it('takes a fixed number of steps per leg when asked', async () => {
    const { touch, sent } = await open();
    await touch.pressDrag({ x: 0, y: 0 }, { x: 90, y: 0 }, { steps: 3 });
    expect(
      sent.filter((event) => event.type === 'touchMove').map((event) => event.touchPoints[0]?.x),
    ).toEqual([30, 60, 90]);
  });

  it('can leave the finger down at the end for the caller to read the page and move on', async () => {
    const { touch, sent } = await open();
    const finger = await touch.pressDrag(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { release: false, steps: 1 },
    );
    expect(finger.released).toBe(false);
    expect(finger.position).toEqual({ x: 10, y: 0 });
    await finger.moveTo({ x: 10, y: 24 }, { stepPx: 24 });
    await finger.release();
    expect(sent.map((event) => event.type)).toEqual([
      'touchStart',
      'touchMove',
      'touchMove',
      'touchEnd',
    ]);
  });

  it('skips repeated points and still takes the time asked for when it goes nowhere', async () => {
    const { touch, sent } = await open();
    const finger = await touch.press({ x: 5, y: 5 });
    await finger.moveTo([{ x: 5, y: 5 }], { durationMs: 80 });
    await finger.moveTo(
      [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 5 },
      ],
      { steps: 1, durationMs: 40 },
    );
    expect(sent.map((event) => event.type)).toEqual(['touchStart', 'touchMove']);
    expect(touch.trace.at(-1)?.plannedMs).toBe(120);
    await finger.moveTo({ x: 15, y: 5 });
    expect(sent).toHaveLength(2);
  });
});

describe('several fingers', () => {
  it('lists every finger on start and move, the finger that lifted on end, and none on cancel', async () => {
    const { touch, sent } = await open();
    const first = await touch.press({ x: 10, y: 10 });
    const second = await touch.press({ x: 200, y: 300 });
    await first.moveTo({ x: 10, y: 18 }, { steps: 1 });
    await second.release();
    await touch.cancel();

    expect(second.id).toBe(2);
    expect(sent.map((event) => [event.type, event.touchPoints.map((point) => point.id)])).toEqual([
      ['touchStart', [1]],
      ['touchStart', [1, 2]],
      ['touchMove', [1, 2]],
      ['touchEnd', [2]],
      ['touchCancel', []],
    ]);
    expect(sent[2]?.touchPoints).toEqual([
      { id: 1, x: 10, y: 18 },
      { id: 2, x: 200, y: 300 },
    ]);
    expect(first.released).toBe(true);
    expect(touch.trace.at(-1)).toMatchObject({
      type: 'touchCancel',
      finger: null,
      x: null,
      y: null,
    });
  });

  it('sends nothing when cancelling with no finger down', async () => {
    const { touch, sent } = await open();
    await touch.cancel();
    expect(sent).toEqual([]);
  });
});

describe('targets', () => {
  it('lands on the centre of a located box', async () => {
    const { touch, sent } = await open();
    await touch.tap({ boundingBox: async () => ({ x: 100, y: 300, width: 60, height: 40 }) });
    expect(sent[0]?.touchPoints[0]).toEqual({ id: 1, x: 130, y: 320 });
  });

  it('rejects a target that is not in the page, and non-finite points', async () => {
    const { touch, sent } = await open();
    await expect(touch.tap({ boundingBox: async () => null })).rejects.toThrow(/no bounding box/u);
    await expect(touch.tap({ x: Number.NaN, y: 1 })).rejects.toThrow(/finite/u);
    await expect(touch.tap({ x: 1, y: Number.POSITIVE_INFINITY })).rejects.toThrow(/finite/u);
    expect(sent).toEqual([]);
  });
});

describe('invalid options and misuse', () => {
  it.each([
    [
      'a negative press',
      (t: Awaited<ReturnType<typeof open>>['touch']) => t.tap({ x: 1, y: 1 }, { pressMs: -1 }),
      /pressMs/u,
    ],
    [
      'a NaN gap',
      (t: Awaited<ReturnType<typeof open>>['touch']) =>
        t.doubleTap({ x: 1, y: 1 }, { gapMs: Number.NaN }),
      /gapMs/u,
    ],
    [
      'a negative double-tap press',
      (t: Awaited<ReturnType<typeof open>>['touch']) =>
        t.doubleTap({ x: 1, y: 1 }, { pressMs: -5 }),
      /pressMs/u,
    ],
    [
      'an infinite hold',
      (t: Awaited<ReturnType<typeof open>>['touch']) =>
        t.hold({ x: 1, y: 1 }, { durationMs: Number.POSITIVE_INFINITY }),
      /durationMs/u,
    ],
    ['a negative wait', (t: Awaited<ReturnType<typeof open>>['touch']) => t.wait(-1), /duration/u],
    [
      'a negative rest',
      (t: Awaited<ReturnType<typeof open>>['touch']) =>
        t.pressDrag({ x: 1, y: 1 }, { x: 2, y: 2 }, { holdMs: -1 }),
      /holdMs/u,
    ],
    [
      'a negative settle',
      (t: Awaited<ReturnType<typeof open>>['touch']) =>
        t.pressDrag({ x: 1, y: 1 }, { x: 2, y: 2 }, { settleMs: -1 }),
      /settleMs/u,
    ],
    [
      'a zero step size',
      (t: Awaited<ReturnType<typeof open>>['touch']) =>
        t.pressDrag({ x: 1, y: 1 }, { x: 2, y: 2 }, { stepPx: 0 }),
      /stepPx/u,
    ],
    [
      'a NaN step size',
      (t: Awaited<ReturnType<typeof open>>['touch']) =>
        t.pressDrag({ x: 1, y: 1 }, { x: 2, y: 2 }, { stepPx: Number.NaN }),
      /stepPx/u,
    ],
    [
      'a fractional step count',
      (t: Awaited<ReturnType<typeof open>>['touch']) =>
        t.pressDrag({ x: 1, y: 1 }, { x: 2, y: 2 }, { steps: 1.5 }),
      /steps/u,
    ],
    [
      'a zero step count',
      (t: Awaited<ReturnType<typeof open>>['touch']) =>
        t.pressDrag({ x: 1, y: 1 }, { x: 2, y: 2 }, { steps: 0 }),
      /steps/u,
    ],
    [
      'a negative travel time',
      (t: Awaited<ReturnType<typeof open>>['touch']) =>
        t.pressDrag({ x: 1, y: 1 }, { x: 2, y: 2 }, { durationMs: -1 }),
      /durationMs/u,
    ],
  ])('rejects %s', async (_name, act, message) => {
    const { touch } = await open();
    await expect(act(touch)).rejects.toThrow(message);
    await expect(act(touch)).rejects.toBeInstanceOf(ScriptedTouchError);
  });

  it('rejects an operation started while another is still running', async () => {
    const fake = fakeSession();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const touch = await createScriptedTouch(fake.session, { clock: fake.clock });
    const slow = touch.tap({
      boundingBox: async () => {
        await gate;
        return { x: 1, y: 1, width: 2, height: 2 };
      },
    });
    await expect(touch.tap({ x: 1, y: 1 })).rejects.toThrow(/still running/u);
    release();
    await slow;
    await touch.tap({ x: 1, y: 1 });
  });

  it('refuses to use a finger that has lifted', async () => {
    const { touch } = await open();
    const finger = await touch.press({ x: 1, y: 1 });
    await finger.release();
    await expect(finger.release()).rejects.toThrow(/finger 1 is already released/u);
    await expect(finger.hold(10)).rejects.toThrow(/already released/u);
    await expect(finger.moveTo({ x: 5, y: 5 })).rejects.toThrow(/already released/u);
  });

  it('refuses every call once closed, and closing twice is harmless', async () => {
    const { touch, sent } = await open();
    const finger = await touch.press({ x: 1, y: 1 });
    await touch.close();
    await touch.close();
    expect(sent.map((event) => event.type)).toEqual(['touchStart', 'touchCancel']);
    expect(finger.released).toBe(true);
    await expect(touch.tap({ x: 1, y: 1 })).rejects.toThrow(/closed/u);
  });

  it('lets a running operation finish on close, then cancels the finger it left down', async () => {
    const fake = fakeSession();
    const page = { context: () => ({ newCDPSession: async () => fake.session }) };
    const touch = await createScriptedTouch(page, { clock: fake.clock });
    const running = touch.hold({ x: 1, y: 1 }, { durationMs: 400, release: false });
    const closing = touch.close();
    await expect(touch.tap({ x: 2, y: 2 })).rejects.toThrow(/closed/u);
    await Promise.all([running, closing]);
    expect(fake.sent.map((event) => event.type)).toEqual(['touchStart', 'touchCancel']);
    expect(fake.session.detach).toHaveBeenCalledOnce();
    await touch.close();
    expect(fake.session.detach).toHaveBeenCalledOnce();
  });

  it('closes cleanly when the running operation fails', async () => {
    const fake = fakeSession();
    const touch = await createScriptedTouch(fake.session, { clock: fake.clock });
    const failing = touch.tap({ boundingBox: async () => null });
    const closing = touch.close();
    await expect(failing).rejects.toThrow(/no bounding box/u);
    await expect(closing).resolves.toBeUndefined();
  });

  it('does not list a finger the browser never received when its start fails', async () => {
    const { touch, sent, session } = await open();
    session.send.mockRejectedValueOnce(new Error('target closed'));
    await expect(touch.press({ x: 1, y: 1 })).rejects.toThrow(/target closed/u);
    const finger = await touch.press({ x: 5, y: 5 });
    expect(finger.id).toBe(2);
    expect(sent[0]?.touchPoints).toEqual([{ id: 2, x: 5, y: 5 }]);
  });

  it('still closes and detaches when cancelling the last finger fails', async () => {
    const fake = fakeSession();
    const page = { context: () => ({ newCDPSession: async () => fake.session }) };
    const touch = await createScriptedTouch(page, { clock: fake.clock });
    await touch.press({ x: 1, y: 1 });
    fake.session.send.mockRejectedValueOnce(new Error('target closed'));
    await expect(touch.close()).rejects.toThrow(/target closed/u);
    expect(fake.session.detach).toHaveBeenCalledOnce();
    await expect(touch.wait(1)).rejects.toThrow(/closed/u);
  });
});

describe('failures mid-gesture', () => {
  function failOn(session: { send: ReturnType<typeof vi.fn> }, ...types: string[]) {
    const original = session.send.getMockImplementation() as (
      method: string,
      params?: { type?: string },
    ) => Promise<unknown>;
    session.send.mockImplementation(async (method: string, params?: { type?: string }) => {
      if (params?.type !== undefined && types.includes(params.type)) {
        throw new Error('target closed');
      }
      return original(method, params);
    });
  }

  it('keeps the last position the browser received when a move fails to send', async () => {
    const { touch, session, sent } = await open();
    const finger = await touch.press({ x: 10, y: 10 });
    failOn(session, 'touchMove');
    await expect(finger.moveTo({ x: 20, y: 10 }, { steps: 1 })).rejects.toThrow(/target closed/u);
    expect(finger.position).toEqual({ x: 10, y: 10 });
    await touch.press({ x: 50, y: 50 });
    expect(sent.at(-1)?.touchPoints).toEqual([
      { id: 1, x: 10, y: 10 },
      { id: 2, x: 50, y: 50 },
    ]);
  });

  it('validates a whole drag before the finger goes down', async () => {
    const { touch, sent } = await open();
    await expect(touch.pressDrag({ x: 1, y: 1 }, { x: 9, y: 9 }, { stepPx: 0 })).rejects.toThrow(
      /stepPx/u,
    );
    await expect(
      touch.pressDrag({ x: 1, y: 1 }, { boundingBox: async () => null }),
    ).rejects.toThrow(/no bounding box/u);
    expect(sent).toEqual([]);
  });

  it('lifts only the dragging finger when a step fails after the start', async () => {
    const { touch, session, sent } = await open();
    const other = await touch.press({ x: 200, y: 200 });
    failOn(session, 'touchMove');
    await expect(touch.pressDrag({ x: 1, y: 1 }, { x: 9, y: 9 })).rejects.toThrow(/target closed/u);
    expect(sent.map((event) => [event.type, event.touchPoints.map((point) => point.id)])).toEqual([
      ['touchStart', [1]],
      ['touchStart', [1, 2]],
      ['touchEnd', [2]],
    ]);
    expect(other.released).toBe(false);
  });

  it('still reports the original failure when the cleanup lift fails too', async () => {
    const { touch, session } = await open();
    failOn(session, 'touchMove', 'touchEnd');
    await expect(touch.pressDrag({ x: 1, y: 1 }, { x: 9, y: 9 })).rejects.toThrow(/target closed/u);
  });

  it('keeps cleanup retryable when cancelling fails on a session the caller owns', async () => {
    const { touch, session, sent } = await open();
    await touch.press({ x: 1, y: 1 });
    failOn(session, 'touchCancel');
    await expect(touch.close()).rejects.toThrow(/target closed/u);
    session.send.mockImplementation(async (_method: string, params?: object) => {
      sent.push(params as Sent);
      return {};
    });
    await touch.close();
    expect(sent.map((event) => event.type)).toEqual(['touchStart', 'touchCancel']);
    await expect(touch.tap({ x: 1, y: 1 })).rejects.toThrow(/closed/u);
  });
});

describe('move planning', () => {
  it('refuses a move that would need an unreasonable number of steps', async () => {
    const { touch, sent } = await open();
    await expect(
      touch.pressDrag({ x: 0, y: 0 }, { x: 1, y: 0 }, { stepPx: Number.MIN_VALUE }),
    ).rejects.toThrow(/more than 10000 steps/u);
    await expect(
      touch.pressDrag({ x: 0, y: 0 }, { x: 50_000, y: 0 }, { stepPx: 1 }),
    ).rejects.toThrow(/more than 10000 steps/u);
    expect(sent).toEqual([]);
  });

  it('spaces steps one frame apart per leg when no duration is given', async () => {
    const { touch } = await open();
    await touch.pressDrag(
      { x: 0, y: 0 },
      [
        { x: 1, y: 0 },
        { x: 10, y: 0 },
      ],
      { steps: 1 },
    );
    expect(
      touch.trace.filter((entry) => entry.type === 'touchMove').map((e) => e.plannedMs),
    ).toEqual([16, 32]);
  });
});

describe('planned time after idle', () => {
  it('does not count the time a slow send took as idle time', async () => {
    const { touch } = await open({ latencyMs: 300 });
    const finger = await touch.press({ x: 1, y: 1 });
    await finger.hold(100);
    await finger.release();
    expect(touch.trace.map((entry) => entry.plannedMs)).toEqual([0, 100]);
  });

  it('moves the plan up to the present when the script paused for a long time', async () => {
    const { touch, state } = await open();
    await touch.tap({ x: 1, y: 1 });
    state.t += 10_000;
    await touch.tap({ x: 1, y: 1 });
    expect(touch.trace.map((entry) => entry.plannedMs)).toEqual([0, 50, 10_050, 10_100]);
  });

  it('keeps the plan exact when the pause is short', async () => {
    const { touch, state } = await open();
    await touch.tap({ x: 1, y: 1 });
    state.t += 100;
    await touch.tap({ x: 1, y: 1 });
    expect(touch.trace.map((entry) => entry.plannedMs)).toEqual([0, 50, 50, 100]);
  });
});
