import { setTimeout as delay } from 'node:timers/promises';

/**
 * Scripted touch for Chromium: real touch events from the DevTools protocol
 * (`Input.dispatchTouchEvent`), so the page sees genuine `pointerType: "touch"`
 * pointer events and touch events, with the browser's own hit testing, touch
 * slop and gesture recognition. The same driver serves a Playwright page and
 * an Android WebView reached over DevTools (see `game-harness/android-webview`).
 *
 * Everything is structural: nothing here imports Playwright.
 */

/** A point in CSS pixels, relative to the page viewport. */
export interface TouchPoint {
  x: number;
  y: number;
}

export interface TouchBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Anything with a viewport box, such as a Playwright `Locator`. A touch lands on its centre. */
export interface TouchLocator {
  boundingBox(): Promise<TouchBox | null>;
}

export type TouchTarget = TouchPoint | TouchLocator;

/** The part of a DevTools protocol session the driver uses. A Playwright `CDPSession` fits. */
export interface TouchCdpSession {
  send(method: string, params?: object): Promise<unknown>;
  detach?(): Promise<void>;
}

/** The part of a Playwright `Page` the driver uses to open its own protocol session. */
export interface TouchPage {
  context(): { newCDPSession(page: never): Promise<TouchCdpSession> };
}

/** Time source, swappable so tests can run without real waiting. */
export interface TouchClock {
  /** Monotonic milliseconds. */
  now(): number;
  /** Wall-clock milliseconds since the Unix epoch. */
  epochMs(): number;
  /** Resolves once `now()` has reached `deadlineMs`; never earlier. */
  sleepUntil(deadlineMs: number): Promise<void>;
}

export const systemTouchClock: TouchClock = {
  now: () => performance.now(),
  epochMs: () => performance.timeOrigin + performance.now(),
  async sleepUntil(deadlineMs) {
    for (let remaining = deadlineMs - performance.now(); remaining > 0;) {
      await delay(remaining);
      remaining = deadlineMs - performance.now();
    }
  },
};

export type TouchEventType = 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';

/** One protocol event the driver sent. Times are milliseconds since the session was created. */
export interface TouchTraceEntry {
  type: TouchEventType;
  /**
   * The finger this event is about; other fingers that were down are not
   * listed. Null for `touchCancel`, which ends every finger at once.
   */
  finger: number | null;
  x: number | null;
  y: number | null;
  /** When the script said the event happens. Gaps between planned times are exactly the durations asked for. */
  plannedMs: number;
  /** When the event was actually sent. Never earlier than planned; later when the machine was slow. */
  actualMs: number;
}

export interface ScriptedTouchOptions {
  /**
   * `scheduled` (default) stamps each event with its planned time, corrected
   * for the browser's clock, so the page sees the exact durations asked for
   * (`event.timeStamp` gaps) even when the host is slow. `dispatch` sends no
   * stamp and lets the browser stamp each event on arrival.
   */
  timestamps?: 'scheduled' | 'dispatch';
  /** Defaults to {@link systemTouchClock}. */
  clock?: TouchClock;
}

export interface TapOptions {
  /** Time between touch down and touch up. Defaults to 50. */
  pressMs?: number;
}

export interface DoubleTapOptions extends TapOptions {
  /** Time from the first touch up to the second touch down. Defaults to 100. */
  gapMs?: number;
  /** Where the second tap lands. Defaults to the first target. */
  secondTarget?: TouchTarget;
}

export interface HoldOptions {
  /** How long the finger stays down, from the touch-down event. */
  durationMs: number;
  /** Lift the finger afterwards. Defaults to true; pass false to keep it down and read the page. */
  release?: boolean;
}

export interface MoveOptions {
  /** Total travel time across all legs. Defaults to 16 ms per step, about one frame. */
  durationMs?: number;
  /** Largest distance between two consecutive move events, in CSS pixels. Defaults to 8. */
  stepPx?: number;
  /** Move events per leg, instead of deriving them from `stepPx`. */
  steps?: number;
}

export interface PressDragOptions extends MoveOptions {
  /** Time the finger rests on the start before moving. Defaults to 0. */
  holdMs?: number;
  /** Time the finger rests on the end before lifting. Defaults to 0. */
  settleMs?: number;
  /** Lift the finger at the end. Defaults to true; pass false to keep it down and read the page. */
  release?: boolean;
}

/** One finger on the screen. Await each call before the next. */
export interface TouchFinger {
  readonly id: number;
  readonly position: Readonly<TouchPoint>;
  readonly released: boolean;
  /** Moves along one target or through several in order, as a series of move events. */
  moveTo(target: TouchTarget | readonly TouchTarget[], options?: MoveOptions): Promise<void>;
  /** Keeps the finger down for `ms` more milliseconds. */
  hold(ms: number): Promise<void>;
  release(): Promise<void>;
}

export interface ScriptedTouch {
  /** Every event sent so far, in order. */
  readonly trace: readonly TouchTraceEntry[];
  /** Puts a finger down and leaves it there. */
  press(target: TouchTarget): Promise<TouchFinger>;
  tap(target: TouchTarget, options?: TapOptions): Promise<void>;
  /** Two taps; the second lands `gapMs` after the first lifts. */
  doubleTap(target: TouchTarget, options?: DoubleTapOptions): Promise<void>;
  hold(target: TouchTarget, options: HoldOptions): Promise<TouchFinger>;
  /** Presses on `from`, moves to `to` (or through each of several targets) and lifts. */
  pressDrag(
    from: TouchTarget,
    to: TouchTarget | readonly TouchTarget[],
    options?: PressDragOptions,
  ): Promise<TouchFinger>;
  /**
   * Ends every finger that is down the way the system does when it takes a
   * gesture over: the page sees `pointercancel`. The protocol cannot cancel
   * one finger alone.
   */
  cancel(): Promise<void>;
  /** Waits `ms` without touching, measured from now. */
  wait(ms: number): Promise<void>;
  /** Cancels any finger still down, and closes the protocol session when this driver opened it. */
  close(): Promise<void>;
}

/** Thrown for invalid arguments, a page without touch support, and misuse of a finger. */
export class ScriptedTouchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ScriptedTouchError';
  }
}

const DEFAULT_TAP_PRESS_MS = 50;
const DEFAULT_DOUBLE_TAP_GAP_MS = 100;
const DEFAULT_STEP_PX = 8;
/** One frame at 60 Hz. */
const FRAME_MS = 16;
/** After this much idle time the planned timeline is moved up to the present. */
const IDLE_REBASE_MS = 250;

function requireDuration(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ScriptedTouchError(`${name} must be a finite number of milliseconds, 0 or more`);
  }
}

async function resolvePoint(target: TouchTarget): Promise<TouchPoint> {
  if ('boundingBox' in target) {
    const box = await target.boundingBox();
    if (box === null) {
      throw new ScriptedTouchError('touch target has no bounding box: it is not in the page');
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    throw new ScriptedTouchError(`touch point (${target.x}, ${target.y}) must use finite numbers`);
  }
  return { x: target.x, y: target.y };
}

interface PathStep extends TouchPoint {
  atMs: number;
}

/** Plans move events from `start` through `waypoints`, with times relative to the first leg's start. */
function planPath(
  start: TouchPoint,
  waypoints: readonly TouchPoint[],
  options: MoveOptions,
): { steps: PathStep[]; totalMs: number } {
  const stepPx = options.stepPx ?? DEFAULT_STEP_PX;
  if (!Number.isFinite(stepPx) || stepPx <= 0) {
    throw new ScriptedTouchError('stepPx must be a finite number of pixels above 0');
  }
  if (options.steps !== undefined && (!Number.isInteger(options.steps) || options.steps < 1)) {
    throw new ScriptedTouchError('steps must be a whole number, 1 or more');
  }
  if (options.durationMs !== undefined) requireDuration('durationMs', options.durationMs);

  const legs: { from: TouchPoint; to: TouchPoint; length: number; steps: number }[] = [];
  let from = start;
  for (const to of waypoints) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length > 0) {
      legs.push({ from, to, length, steps: options.steps ?? Math.ceil(length / stepPx) });
    }
    from = to;
  }
  const totalLength = legs.reduce((sum, leg) => sum + leg.length, 0);
  const totalSteps = legs.reduce((sum, leg) => sum + leg.steps, 0);
  const totalMs = options.durationMs ?? totalSteps * FRAME_MS;

  const steps: PathStep[] = [];
  let legStartMs = 0;
  for (const leg of legs) {
    const legMs = (totalMs * leg.length) / totalLength;
    for (let index = 1; index <= leg.steps; index += 1) {
      const fraction = index / leg.steps;
      steps.push({
        x: index === leg.steps ? leg.to.x : leg.from.x + (leg.to.x - leg.from.x) * fraction,
        y: index === leg.steps ? leg.to.y : leg.from.y + (leg.to.y - leg.from.y) * fraction,
        atMs: legStartMs + legMs * fraction,
      });
    }
    legStartMs += legMs;
  }
  return { steps, totalMs };
}

interface FingerState {
  id: number;
  x: number;
  y: number;
  released: boolean;
}

class TouchSession implements ScriptedTouch {
  readonly trace: TouchTraceEntry[] = [];
  private readonly fingers = new Map<number, FingerState>();
  private nextFingerId = 1;
  private plannedMs = 0;
  private busy = false;
  private closed = false;
  private readonly originMs: number;

  constructor(
    private readonly session: TouchCdpSession,
    private readonly ownsSession: boolean,
    private readonly clock: TouchClock,
    private readonly epochOriginMs: number | null,
  ) {
    this.originMs = clock.now();
  }

  private elapsed(): number {
    return this.clock.now() - this.originMs;
  }

  /** Serialises operations and moves a stale planned timeline up to the present. */
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) throw new ScriptedTouchError('this touch session is closed');
    if (this.busy) {
      throw new ScriptedTouchError(
        'a touch operation is still running: await each call before starting the next',
      );
    }
    this.busy = true;
    try {
      if (this.elapsed() - this.plannedMs > IDLE_REBASE_MS) this.plannedMs = this.elapsed();
      return await operation();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Sends one protocol event. Start and move list every finger that is down; an
   * end lists the finger that lifted; a cancel lists none and ends them all.
   */
  private async emit(
    type: TouchEventType,
    finger: FingerState | null,
    plannedMs: number,
  ): Promise<void> {
    await this.clock.sleepUntil(this.originMs + plannedMs);
    const actualMs = this.elapsed();
    let listed: Iterable<FingerState> = this.fingers.values();
    if (type === 'touchEnd') listed = [finger as FingerState];
    if (type === 'touchCancel') listed = [];
    await this.session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [...listed].map(({ id, x, y }) => ({ id, x, y })),
      ...(this.epochOriginMs === null
        ? {}
        : { timestamp: (this.epochOriginMs + plannedMs) / 1000 }),
    });
    this.trace.push({
      type,
      finger: finger?.id ?? null,
      x: finger?.x ?? null,
      y: finger?.y ?? null,
      plannedMs,
      actualMs,
    });
  }

  /** Waits `ms` from now on the wall clock and advances the planned timeline by exactly `ms`. */
  private async pause(ms: number): Promise<void> {
    requireDuration('duration', ms);
    const wallTarget = this.elapsed() + ms;
    this.plannedMs += ms;
    await this.clock.sleepUntil(this.originMs + wallTarget);
  }

  private async down(point: TouchPoint): Promise<TouchHandle> {
    const state: FingerState = { id: this.nextFingerId, ...point, released: false };
    this.nextFingerId += 1;
    this.fingers.set(state.id, state);
    await this.emit('touchStart', state, this.plannedMs);
    return new TouchHandle(this, state);
  }

  private async lift(state: FingerState): Promise<void> {
    await this.emit('touchEnd', state, this.plannedMs);
    state.released = true;
    this.fingers.delete(state.id);
  }

  private async cancelAll(): Promise<void> {
    if (this.fingers.size === 0) return;
    await this.emit('touchCancel', null, this.plannedMs);
    for (const state of this.fingers.values()) state.released = true;
    this.fingers.clear();
  }

  private async travel(
    state: FingerState,
    targets: readonly TouchTarget[],
    options: MoveOptions,
  ): Promise<void> {
    const waypoints = await Promise.all(targets.map(resolvePoint));
    const startMs = this.plannedMs;
    const wallStartMs = this.elapsed();
    const { steps, totalMs } = planPath(state, waypoints, options);
    // A move that goes nowhere still takes the time it was asked to take.
    if (steps.length === 0) await this.pause(totalMs);
    for (const step of steps) {
      state.x = step.x;
      state.y = step.y;
      this.plannedMs = startMs + step.atMs;
      // The wall clock follows the same schedule from the start of the move, so
      // a slow step is made up by the next rather than stretching the drag.
      await this.clock.sleepUntil(this.originMs + wallStartMs + step.atMs);
      await this.emit('touchMove', state, this.plannedMs);
    }
  }

  private guardFinger(state: FingerState): void {
    if (state.released) throw new ScriptedTouchError(`finger ${state.id} is already released`);
  }

  // Operations a TouchHandle calls back into.

  moveFinger(
    state: FingerState,
    target: TouchTarget | readonly TouchTarget[],
    options: MoveOptions,
  ): Promise<void> {
    return this.run(async () => {
      this.guardFinger(state);
      await this.travel(state, isTargetList(target) ? target : [target], options);
    });
  }

  holdFinger(state: FingerState, ms: number): Promise<void> {
    return this.run(async () => {
      this.guardFinger(state);
      await this.pause(ms);
    });
  }

  liftFinger(state: FingerState): Promise<void> {
    return this.run(async () => {
      this.guardFinger(state);
      await this.lift(state);
    });
  }

  // ScriptedTouch

  press(target: TouchTarget): Promise<TouchFinger> {
    return this.run(async () => this.down(await resolvePoint(target)));
  }

  private async tapOnce(target: TouchTarget, pressMs: number): Promise<void> {
    const handle = await this.down(await resolvePoint(target));
    await this.pause(pressMs);
    await this.lift(handle.state);
  }

  async tap(target: TouchTarget, options: TapOptions = {}): Promise<void> {
    const pressMs = options.pressMs ?? DEFAULT_TAP_PRESS_MS;
    requireDuration('pressMs', pressMs);
    return this.run(() => this.tapOnce(target, pressMs));
  }

  async doubleTap(target: TouchTarget, options: DoubleTapOptions = {}): Promise<void> {
    const pressMs = options.pressMs ?? DEFAULT_TAP_PRESS_MS;
    const gapMs = options.gapMs ?? DEFAULT_DOUBLE_TAP_GAP_MS;
    requireDuration('pressMs', pressMs);
    requireDuration('gapMs', gapMs);
    return this.run(async () => {
      await this.tapOnce(target, pressMs);
      await this.pause(gapMs);
      await this.tapOnce(options.secondTarget ?? target, pressMs);
    });
  }

  async hold(target: TouchTarget, options: HoldOptions): Promise<TouchFinger> {
    requireDuration('durationMs', options.durationMs);
    return this.run(async () => {
      const handle = await this.down(await resolvePoint(target));
      await this.pause(options.durationMs);
      if (options.release !== false) await this.lift(handle.state);
      return handle;
    });
  }

  async pressDrag(
    from: TouchTarget,
    to: TouchTarget | readonly TouchTarget[],
    options: PressDragOptions = {},
  ): Promise<TouchFinger> {
    const holdMs = options.holdMs ?? 0;
    const settleMs = options.settleMs ?? 0;
    requireDuration('holdMs', holdMs);
    requireDuration('settleMs', settleMs);
    return this.run(async () => {
      const handle = await this.down(await resolvePoint(from));
      if (holdMs > 0) await this.pause(holdMs);
      await this.travel(handle.state, isTargetList(to) ? to : [to], options);
      if (settleMs > 0) await this.pause(settleMs);
      if (options.release !== false) await this.lift(handle.state);
      return handle;
    });
  }

  cancel(): Promise<void> {
    return this.run(() => this.cancelAll());
  }

  wait(ms: number): Promise<void> {
    return this.run(() => this.pause(ms));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.run(() => this.cancelAll());
    } finally {
      this.closed = true;
      if (this.ownsSession) await this.session.detach?.();
    }
  }
}

function isTargetList(
  target: TouchTarget | readonly TouchTarget[],
): target is readonly TouchTarget[] {
  return Array.isArray(target);
}

class TouchHandle implements TouchFinger {
  constructor(
    private readonly owner: TouchSession,
    readonly state: FingerState,
  ) {}

  get id(): number {
    return this.state.id;
  }

  get position(): Readonly<TouchPoint> {
    return { x: this.state.x, y: this.state.y };
  }

  get released(): boolean {
    return this.state.released;
  }

  moveTo(target: TouchTarget | readonly TouchTarget[], options: MoveOptions = {}): Promise<void> {
    return this.owner.moveFinger(this.state, target, options);
  }

  hold(ms: number): Promise<void> {
    return this.owner.holdFinger(this.state, ms);
  }

  release(): Promise<void> {
    return this.owner.liftFinger(this.state);
  }
}

interface ProbeResult {
  result?: { value?: { touchPoints?: number; now?: number } };
  exceptionDetails?: { text?: string };
}

/**
 * Opens a scripted-touch driver on a Chromium page.
 *
 * Pass a Playwright `Page` (the driver opens and, on `close()`, detaches its
 * own protocol session) or an already-open protocol session, for example one
 * reached over DevTools on an Android WebView. The page must have touch
 * support: create the Playwright context with `hasTouch: true` (and
 * `isMobile: true` for a phone), otherwise this rejects instead of driving a
 * page that a phone player would see differently.
 */
export async function createScriptedTouch(
  source: TouchPage | TouchCdpSession,
  options: ScriptedTouchOptions = {},
): Promise<ScriptedTouch> {
  const clock = options.clock ?? systemTouchClock;
  const ownsSession = !('send' in source);
  const session = 'send' in source ? source : await source.context().newCDPSession(source as never);

  try {
    const before = clock.epochMs();
    const probe = (await session.send('Runtime.evaluate', {
      expression: '({ touchPoints: navigator.maxTouchPoints, now: Date.now() })',
      returnByValue: true,
    })) as ProbeResult;
    const after = clock.epochMs();
    const value = probe.result?.value;
    if (probe.exceptionDetails || value?.touchPoints === undefined || value.now === undefined) {
      throw new ScriptedTouchError(
        `cannot read the page's touch support: ${probe.exceptionDetails?.text ?? 'no result'}`,
      );
    }
    if (value.touchPoints < 1) {
      throw new ScriptedTouchError(
        'this page has no touch support (navigator.maxTouchPoints is 0): create the browser ' +
          'context with hasTouch: true, and isMobile: true for a phone',
      );
    }
    // The browser's clock may differ from this host's (a phone certainly does);
    // scheduled stamps are expressed in the browser's.
    const skewMs = value.now - (before + after) / 2;
    const scheduled = (options.timestamps ?? 'scheduled') === 'scheduled';
    const epochOriginMs = scheduled ? clock.epochMs() + skewMs : null;
    return new TouchSession(session, ownsSession, clock, epochOriginMs);
  } catch (error) {
    if (ownsSession) await session.detach?.();
    throw error;
  }
}
