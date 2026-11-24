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
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AndroidWebViewError';
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
              { cause: error },
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
  } catch {
    // `pidof` exits non-zero when nothing matches.
    pids = [];
  }
  if (pids.length === 0) {
    throw new AndroidWebViewError(`${options.appId} is not running on the device`);
  }

  const sockets = [
    ...(await run([...device, 'shell', 'cat', '/proc/net/unix'])).matchAll(
      new RegExp(`@${SOCKET_PREFIX}(\\d+)`, 'gu'),
    ),
  ].map((match) => match[1]);
  const pid = pids.find((candidate) => sockets.includes(candidate));
  if (pid === undefined) {
    throw new AndroidWebViewError(
      `${options.appId} (pid ${pids.join(', ')}) has no WebView DevTools socket: install a ` +
        `debuggable build with WebView debugging enabled (sockets present: ${sockets.join(', ') || 'none'})`,
    );
  }

  const socket = `${SOCKET_PREFIX}${pid}`;
  const forwarded = await run([
    ...device,
    'forward',
    `tcp:${localPort}`,
    `localabstract:${socket}`,
  ]);
  const port = localPort === 0 ? Number.parseInt(forwarded.trim(), 10) : localPort;
  if (!Number.isInteger(port) || port < 1) {
    throw new AndroidWebViewError(
      `adb forward did not report a local port (got ${JSON.stringify(forwarded.trim())})`,
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
