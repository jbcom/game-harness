/**
 * Playwright `globalSetup` that gives headed Chromium a display on Linux.
 *
 * Peer-free: it imports nothing from Playwright, so the module can be named
 * directly as a `globalSetup` path. On Linux it starts `Xvfb` on a free
 * display chosen by the server (`-displayfd`), publishes it as
 * `process.env.DISPLAY` and returns a teardown that stops it. On every other
 * platform it does nothing, because a headed window there uses the desktop
 * session (macOS, Windows).
 */
import { spawn as spawnProcess } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { Readable, type Writable } from 'node:stream';

/** Environment variable that overrides the Xvfb binary used by the default export. */
export const XVFB_PATH_ENV = 'GAME_HARNESS_XVFB_PATH';

const DEFAULT_XVFB_COMMAND = 'Xvfb';
const DEFAULT_SCREEN = '1920x1200x24';

/** The stdio layout Xvfb needs: fd 3 is the pipe `-displayfd 3` reports the display number on. */
export type XvfbStdio = readonly ['ignore', 'ignore', 'inherit', 'pipe'];

/** The part of a child process this module drives; Node's `ChildProcess` satisfies it. */
export interface XvfbProcess extends EventEmitter {
  readonly stdio: readonly (Readable | Writable | null | undefined)[];
  kill(signal?: NodeJS.Signals): boolean;
}

/** Spawns the Xvfb process. Injectable so tests need no real X server. */
export type XvfbSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly stdio: XvfbStdio },
) => XvfbProcess;

/** Stops the Xvfb that `setupXvfb()` started and restores the previous `DISPLAY`. */
export type XvfbTeardown = () => Promise<void>;

export interface XvfbSetupOptions {
  /**
   * Xvfb binary. Resolution order: this option, then the
   * `GAME_HARNESS_XVFB_PATH` environment variable, then `Xvfb` resolved from
   * `PATH` (typically `/usr/bin/Xvfb`).
   */
  xvfbPath?: string;
  /** Screen geometry as `WIDTHxHEIGHTxDEPTH`. Defaults to `1920x1200x24`. */
  screen?: string;
  /** Platform to decide against. Defaults to `process.platform`. */
  platform?: string;
  /** Environment to read `GAME_HARNESS_XVFB_PATH` from and publish `DISPLAY` to. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Process spawner. Defaults to `node:child_process` `spawn`. */
  spawn?: XvfbSpawn;
}

const defaultSpawn: XvfbSpawn = (command, args, options) =>
  spawnProcess(command, args, { stdio: [...options.stdio] });

/**
 * Starts Xvfb on Linux and returns its teardown; resolves `undefined` on every
 * other platform. Rejects, leaving `DISPLAY` untouched, when Xvfb cannot start
 * or exits before reporting its display.
 */
export async function setupXvfb(options: XvfbSetupOptions = {}): Promise<XvfbTeardown | undefined> {
  if ((options.platform ?? process.platform) !== 'linux') return undefined;

  const env = options.env ?? process.env;
  const command = options.xvfbPath ?? env[XVFB_PATH_ENV] ?? DEFAULT_XVFB_COMMAND;
  const child = (options.spawn ?? defaultSpawn)(
    command,
    ['-displayfd', '3', '-screen', '0', options.screen ?? DEFAULT_SCREEN, '-nolisten', 'tcp'],
    { stdio: ['ignore', 'ignore', 'inherit', 'pipe'] },
  );

  let hasExited = false;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      hasExited = true;
      resolve();
    });
  });

  let displayNumber: number;
  try {
    displayNumber = await readDisplayNumber(child, command);
  } catch (error) {
    if (!hasExited) child.kill('SIGTERM');
    throw error;
  }

  const previousDisplay = env.DISPLAY;
  env.DISPLAY = `:${displayNumber}`;

  let tornDown: Promise<void> | undefined;
  return () => {
    tornDown ??= (async () => {
      if (!hasExited) {
        child.kill('SIGTERM');
        await exited;
      }
      if (previousDisplay === undefined) delete env.DISPLAY;
      else env.DISPLAY = previousDisplay;
    })();
    return tornDown;
  };
}

/**
 * Builds a Playwright `globalSetup` with the options bound. Use it from your
 * own setup file to change the screen or binary:
 * `export default createXvfbGlobalSetup({ screen: '1280x720x24' });`
 */
export function createXvfbGlobalSetup(
  options: XvfbSetupOptions = {},
): () => Promise<XvfbTeardown | undefined> {
  return () => setupXvfb(options);
}

/**
 * Ready-made `globalSetup`: `globalSetup: 'game-harness/playwright/xvfb-setup'`
 * (Playwright resolves a bare specifier from the config directory when no
 * local file of that name exists). Playwright passes its resolved config as an argument; it carries no Xvfb
 * options, so it is ignored. Use `GAME_HARNESS_XVFB_PATH` or
 * `createXvfbGlobalSetup()` to customise.
 */
const xvfbGlobalSetup = createXvfbGlobalSetup();
export default xvfbGlobalSetup;

function readDisplayNumber(child: XvfbProcess, command: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    child.once('error', (error: Error) => {
      reject(new Error(`Could not start Xvfb at ${command}: ${error.message}`));
    });
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      reject(
        new Error(
          `Xvfb exited before reporting a display (${signal ? `signal ${signal}` : `code ${String(code)}`}).`,
        ),
      );
    });

    const pipe = child.stdio[3];
    if (!(pipe instanceof Readable)) {
      reject(new Error('Xvfb did not expose a -displayfd pipe on fd 3.'));
      return;
    }
    pipe.setEncoding('utf8');
    let output = '';
    pipe.on('data', (chunk: string) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline < 0) return;
      const reported = output.slice(0, newline).trim();
      if (/^\d+$/u.test(reported)) resolve(Number(reported));
      else reject(new Error(`Xvfb reported an invalid display number "${reported}".`));
    });
    pipe.on('end', () => {
      reject(new Error('Xvfb closed the -displayfd pipe before reporting a display.'));
    });
  });
}
