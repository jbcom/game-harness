import { execFile } from 'node:child_process';

/**
 * Reaches the DevTools endpoint of a debuggable Android WebView over `adb`, so
 * the same Chromium drivers used in the browser, `game-harness/touch` among
 * them, can run against the installed app.
 *
 * Needs `adb` on the machine and a debuggable WebView in the running app
 * (a debug build; Capacitor enables WebView debugging in debug builds).
 * Nothing here runs a shell: `adb` is spawned directly with validated
 * arguments, because `adb shell` joins its arguments into one command line on
 * the device.
 */

export interface AndroidWebViewForwardOptions {
  /** The application id of the running app, for example `com.example.game`. */
  appId: string;
  /** The device serial for `adb -s`. Required only when more than one device is attached. */
  serial?: string;
  /** The `adb` executable. Defaults to `adb` on `PATH`. */
  adbPath?: string;
  /** Local TCP port to forward to. Defaults to 0, which lets `adb` choose a free one. */
  localPort?: number;
  /** Time allowed for each `adb` call. Defaults to 15 seconds. */
  timeoutMs?: number;
  /** Replaces the `adb` runner: receives the arguments after the executable, returns stdout. */
  runAdb?: (args: readonly string[]) => Promise<string>;
}

export interface AndroidWebViewForward {
  /** `http://127.0.0.1:<port>`: pass it to Playwright's `chromium.connectOverCDP()`. */
  endpoint: string;
  port: number;
  /** The abstract socket name that was forwarded, `webview_devtools_remote_<pid>`. */
  socket: string;
  /** The app process that owns the WebView. */
  pid: number;
  /** Removes the port forward. Calling it again does nothing. */
  close(): Promise<void>;
}

/** Thrown for invalid options, a failed `adb` call, and an app without a debuggable WebView. */
export class AndroidWebViewError extends Error {
  /** What `adb` printed on stderr, when the error comes from a failed `adb` call. */
  readonly stderr: string;

  constructor(message: string, options?: { cause?: unknown; stderr?: string }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AndroidWebViewError';
    this.stderr = options?.stderr ?? '';
  }
}

const APP_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;
const SERIAL = /^[A-Za-z0-9._:-]+$/u;
const DEFAULT_TIMEOUT_MS = 15_000;
const SOCKET_PREFIX = 'webview_devtools_remote_';

function createRunner(
  options: AndroidWebViewForwardOptions,
): (args: readonly string[]) => Promise<string> {
  if (options.runAdb) return options.runAdb;
  const adb = options.adbPath ?? 'adb';
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(adb, [...args], { timeout, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) {
          reject(
            new AndroidWebViewError(
              `adb ${args.join(' ')} failed: ${stderr.trim() || error.message}`,
              { cause: error, stderr: stderr.trim() },
            ),
          );
        } else {
          resolve(stdout);
        }
      });
    });
}

/**
 * Finds the WebView DevTools socket of a running app and forwards it to a
 * local port. Connect a driver to `endpoint`, then call `close()`.
 *
 * ```ts
 * const forward = await forwardAndroidWebView({ appId: 'com.example.game' });
 * const browser = await chromium.connectOverCDP(forward.endpoint);
 * const page = browser.contexts()[0].pages()[0];
 * const touch = await createScriptedTouch(page);
 * ```
 */
export async function forwardAndroidWebView(
  options: AndroidWebViewForwardOptions,
): Promise<AndroidWebViewForward> {
  if (!APP_ID.test(options.appId)) {
    throw new AndroidWebViewError(
      `invalid application id ${JSON.stringify(options.appId)}: expected a dotted package name`,
    );
  }
  if (options.serial !== undefined && !SERIAL.test(options.serial)) {
    throw new AndroidWebViewError(`invalid device serial ${JSON.stringify(options.serial)}`);
  }
  const localPort = options.localPort ?? 0;
  if (!Number.isInteger(localPort) || localPort < 0 || localPort > 65_535) {
    throw new AndroidWebViewError('localPort must be a whole port number from 0 to 65535');
  }

  const run = createRunner(options);
  const device = options.serial === undefined ? [] : ['-s', options.serial];

  let pids: string[];
  try {
    pids = (await run([...device, 'shell', 'pidof', options.appId])).match(/\d+/gu) ?? [];
  } catch (error) {
    // `pidof` exits non-zero, silently, when nothing matches. Anything adb
    // itself reported (no device, offline, unauthorised) is the real cause.
    if (error instanceof AndroidWebViewError && error.stderr !== '') throw error;
    pids = [];
  }
  if (pids.length === 0) {
    throw new AndroidWebViewError(`${options.appId} is not running on the device`);
  }

  // The full socket name is kept: a build may suffix it, and the forward must
  // name the socket that exists, not one assembled from the pid.
  const sockets = [
    ...(await run([...device, 'shell', 'cat', '/proc/net/unix'])).matchAll(
      new RegExp(`@(${SOCKET_PREFIX}(\\d+)\\S*)`, 'gu'),
    ),
  ].map((match) => ({ name: match[1] as string, pid: match[2] as string }));
  const found = pids
    .map((candidate) => sockets.find((socket) => socket.pid === candidate))
    .find((socket) => socket !== undefined);
  if (found === undefined) {
    throw new AndroidWebViewError(
      `${options.appId} (pid ${pids.join(', ')}) has no WebView DevTools socket: install a ` +
        `debuggable build with WebView debugging enabled (sockets present: ${sockets.map((candidate) => candidate.name).join(', ') || 'none'})`,
    );
  }
  const { name: socket, pid } = found;

  // A fixed port must be free: --no-rebind makes a collision fail instead of
  // silently taking the port from another client, whose mapping close() would
  // then remove. Port 0 asks adb for an unused port and cannot collide.
  const forwarded = await run([
    ...device,
    'forward',
    ...(localPort === 0 ? [] : ['--no-rebind']),
    `tcp:${localPort}`,
    `localabstract:${socket}`,
  ]);
  const reported = forwarded.trim();
  const port = localPort === 0 && /^\d+$/u.test(reported) ? Number(reported) : localPort;
  if (port < 1 || port > 65_535) {
    throw new AndroidWebViewError(
      `adb forward did not report a local port (got ${JSON.stringify(reported)})`,
    );
  }

  let closed = false;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    port,
    socket,
    pid: Number(pid),
    async close() {
      if (closed) return;
      await run([...device, 'forward', '--remove', `tcp:${port}`]);
      // Only a removal that worked counts, so a failed one can be retried.
      closed = true;
    },
  };
}
