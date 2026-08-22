import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { type Browser, chromium, type Page } from '@playwright/test';
import getPort from 'get-port';
import { type ChromiumGpuMode, createChromiumLaunchProfile } from './chromium-launch.js';
import {
  type OpenSilentGameOptions,
  openSilentGame,
  type SilentQueryValue,
} from './playwright-config.js';

type BrowserLaunchOptions = NonNullable<Parameters<typeof chromium.launch>[0]>;
type BrowserPageOptions = Parameters<Browser['newPage']>[0];

export interface ProductionRuntimeServerOptions {
  /** Executable to launch directly. Shell command strings are intentionally unsupported. */
  command: string;
  /** Arguments passed directly to `command`. Use the server's strict-port option. */
  args?: readonly string[];
  /** Child working directory. Defaults to the current process directory. */
  cwd?: string;
  /** Environment additions or overrides for the child process. */
  env?: Readonly<NodeJS.ProcessEnv>;
  /** URL polled for readiness. Defaults to the runtime `url`. */
  readyUrl?: string;
  /** Maximum startup time. Defaults to 15 seconds. */
  startupTimeoutMs?: number;
  /** Graceful shutdown time before SIGKILL. Defaults to 5 seconds. */
  shutdownTimeoutMs?: number;
}

export interface ProductionRuntimeOptions {
  /** Production artifact or exact-live URL to verify. */
  url: string;
  /** Optional owned preview server. Existing processes are never reused. */
  server?: ProductionRuntimeServerOptions;
  /** Chromium options. `--mute-audio` is always de-duplicated and applied last. */
  browserLaunchOptions?: BrowserLaunchOptions;
  /** Renderer profile. Defaults to native Chromium selection (`auto`). */
  gpuMode?: ChromiumGpuMode;
  /** Options for the fresh browser page. */
  pageOptions?: BrowserPageOptions;
  /** Extra query parameters composed with the mandatory runtime mute. */
  silentParameters?: Readonly<Record<string, SilentQueryValue>>;
  /** Silent marker/query overrides. The marker timeout defaults to 15 seconds here. */
  silentOptions?: OpenSilentGameOptions;
  /** Values written before application code and required to remain byte-for-byte unchanged. */
  localStorageSentinels?: Readonly<Record<string, string | null>>;
  /** Required game-specific identity plus primary UI/canvas assertions. */
  assertReady: (page: Page) => Promise<void>;
  /** Optional engine-specific assertion such as `window.Howler._muted === true`. */
  assertSilentState?: (page: Page) => Promise<void>;
  /** Brief post-ready observation window for deferred runtime errors. Defaults to 250 ms. */
  settleTimeMs?: number;
}

export interface ProductionRuntimeResult {
  finalUrl: string;
  localStorage: Record<string, string | null>;
}

export interface ProductionRuntimeIssue {
  kind: 'console' | 'http' | 'pageerror' | 'requestfailed';
  message: string;
  url?: string;
}

export interface AvailableProductionPortOptions {
  /** Loopback interface used by the owned preview server. Defaults to IPv4 localhost. */
  host?: string;
}

export class ProductionRuntimeVerificationError extends Error {
  readonly issues: readonly ProductionRuntimeIssue[];

  constructor(message: string, issues: readonly ProductionRuntimeIssue[] = [], cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ProductionRuntimeVerificationError';
    this.issues = issues;
  }
}

/**
 * Finds and process-reserves an available loopback port for an owned production
 * preview. The reservation prevents parallel verifier setup in this process
 * from selecting the same port; the preview must still bind with strict-port
 * semantics so an external race fails closed.
 */
export async function findAvailableProductionPort(
  options: AvailableProductionPortOptions = {},
): Promise<number> {
  return getPort({ host: options.host ?? '127.0.0.1', reserve: true });
}

interface ProbeResult {
  ok: boolean;
  reachable: boolean;
  status?: number;
}

async function probe(url: string): Promise<ProbeResult> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    const result = { reachable: true, ok: response.ok, status: response.status };
    try {
      await response.body?.cancel();
    } catch {
      // Reachability is already proven. A stream-cleanup failure must not make
      // an occupied address look free or make a ready server look unreachable.
    }
    return result;
  } catch {
    return { reachable: false, ok: false };
  }
}

function childExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (childExited(child)) return true;

  return new Promise((resolve) => {
    const finish = (exited: boolean): void => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

async function stopServer(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (childExited(child)) return;
  if (!child.kill('SIGTERM')) return;
  if (await waitForChildExit(child, timeoutMs)) return;
  if (!child.kill('SIGKILL')) return;
  await waitForChildExit(child, 1_000);
}

async function startServer(
  options: ProductionRuntimeServerOptions,
  runtimeUrl: string,
): Promise<ChildProcess> {
  const readyUrl = options.readyUrl ?? runtimeUrl;
  const before = await probe(readyUrl);
  if (before.reachable) {
    throw new ProductionRuntimeVerificationError(
      `runtime readiness URL is already reachable; refusing to reuse another process: ${readyUrl}`,
    );
  }

  const spawnOptions: SpawnOptions = {
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'inherit', 'inherit'],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  };
  const child = spawn(options.command, [...(options.args ?? [])], spawnOptions);
  let spawnError: Error | undefined;
  child.once('error', (error) => {
    spawnError = error;
  });

  const timeoutMs = options.startupTimeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new ProductionRuntimeVerificationError(
          `runtime server failed to start: ${spawnError.message}`,
          [],
          spawnError,
        );
      }
      if (childExited(child)) {
        throw new ProductionRuntimeVerificationError(
          `runtime server exited before readiness (code=${String(child.exitCode)}, signal=${String(child.signalCode)})`,
        );
      }
      const result = await probe(readyUrl);
      if (result.ok) return child;
      await delay(100);
    }
    throw new ProductionRuntimeVerificationError(
      `runtime server did not become ready within ${timeoutMs} ms: ${readyUrl}`,
    );
  } catch (error) {
    await stopServer(child, options.shutdownTimeoutMs ?? 5_000);
    throw error;
  }
}

function formatIssues(issues: readonly ProductionRuntimeIssue[]): string {
  return issues
    .map((issue) => {
      const location = issue.url ? ` (${issue.url})` : '';
      return `[${issue.kind}] ${issue.message}${location}`;
    })
    .join('\n');
}

function mutedLaunchOptions(
  options: BrowserLaunchOptions | undefined,
  gpuMode: ChromiumGpuMode | undefined,
): BrowserLaunchOptions {
  const profile = createChromiumLaunchProfile({
    ...(gpuMode === undefined ? {} : { gpuMode }),
    ...(options?.args === undefined ? {} : { args: options.args }),
    ...(options?.env === undefined ? {} : { env: options.env }),
  });
  return {
    ...options,
    ...profile,
    headless: options?.headless ?? false,
  };
}

export interface WebGLRendererInfo {
  renderer: string;
  vendor: string;
  /** True only when Chromium exposed `WEBGL_debug_renderer_info`. */
  unmasked: boolean;
}

const SOFTWARE_RENDERER_PATTERN =
  /swiftshader|llvmpipe|software rasterizer|microsoft basic render driver|angle.*(?:warp|software)/i;

/** Reads the unmasked WebGL renderer already attached to the selected game canvas. */
export async function readWebGLRenderer(
  page: Page,
  canvasSelector = 'canvas',
): Promise<WebGLRendererInfo> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector);
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error(`WebGL canvas not found: ${selector}`);
    }
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!context) throw new Error(`WebGL context unavailable: ${selector}`);
    const extension = context.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(
      context.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER),
    );
    const vendor = String(context.getParameter(extension?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR));
    return { renderer, vendor, unmasked: extension !== null };
  }, canvasSelector);
}

/** Requires a real hardware-backed WebGL renderer and returns its identity. */
export async function requireHardwareWebGL(
  page: Page,
  canvasSelector = 'canvas',
): Promise<WebGLRendererInfo> {
  const info = await readWebGLRenderer(page, canvasSelector);
  if (!info.unmasked || !info.renderer.trim() || SOFTWARE_RENDERER_PATTERN.test(info.renderer)) {
    throw new ProductionRuntimeVerificationError(
      `hardware WebGL required; received ${info.unmasked ? 'unmasked' : 'masked'} renderer: ${info.renderer || '<empty>'}`,
    );
  }
  return info;
}

async function seedLocalStorage(
  page: Page,
  sentinels: Readonly<Record<string, string | null>>,
): Promise<void> {
  const entries = Object.entries(sentinels);
  if (entries.length === 0) return;
  await page.addInitScript((values: Array<[string, string | null]>) => {
    const storage = (
      globalThis as {
        localStorage: {
          removeItem(key: string): void;
          setItem(key: string, value: string): void;
        };
      }
    ).localStorage;
    for (const [key, value] of values) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
  }, entries);
}

async function readLocalStorage(
  page: Page,
  keys: readonly string[],
): Promise<Record<string, string | null>> {
  if (keys.length === 0) return {};
  return page.evaluate(
    (sentinelKeys: string[]) => {
      const storage = (
        globalThis as {
          localStorage: { getItem(key: string): string | null };
        }
      ).localStorage;
      return Object.fromEntries(sentinelKeys.map((key) => [key, storage.getItem(key)]));
    },
    [...keys],
  );
}

/**
 * Boots a built or deployed game in a fresh, fail-closed, silent Chromium and
 * requires game-specific identity/UI proof before accepting the runtime.
 */
export async function verifyProductionRuntime(
  options: ProductionRuntimeOptions,
): Promise<ProductionRuntimeResult> {
  if (!options.url.trim()) {
    throw new ProductionRuntimeVerificationError('runtime URL must not be empty');
  }
  if (typeof options.assertReady !== 'function') {
    throw new ProductionRuntimeVerificationError('assertReady must be a function');
  }

  let child: ChildProcess | undefined;
  let browser: Browser | undefined;
  const issues: ProductionRuntimeIssue[] = [];
  try {
    if (options.server) child = await startServer(options.server, options.url);

    browser = await chromium.launch(
      mutedLaunchOptions(options.browserLaunchOptions, options.gpuMode),
    );
    const page = options.pageOptions
      ? await browser.newPage(options.pageOptions)
      : await browser.newPage();
    page.on('pageerror', (error) => {
      issues.push({ kind: 'pageerror', message: error.message });
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        issues.push({ kind: 'console', message: message.text() });
      }
    });
    page.on('requestfailed', (request) => {
      issues.push({
        kind: 'requestfailed',
        message: request.failure()?.errorText ?? 'request failed without an error message',
        url: request.url(),
      });
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        issues.push({ kind: 'http', message: `HTTP ${response.status()}`, url: response.url() });
      }
    });

    const sentinels = options.localStorageSentinels ?? {};
    await seedLocalStorage(page, sentinels);

    try {
      await openSilentGame(page, options.url, options.silentParameters ?? {}, {
        markerTimeout: 15_000,
        ...options.silentOptions,
      });
      await options.assertReady(page);
      await options.assertSilentState?.(page);
      const settleTimeMs = options.settleTimeMs ?? 250;
      if (settleTimeMs > 0) await page.waitForTimeout(settleTimeMs);
    } catch (error) {
      if (issues.length > 0) {
        throw new ProductionRuntimeVerificationError(
          `production runtime failed while emitting runtime errors:\n${formatIssues(issues)}`,
          issues,
          error,
        );
      }
      throw error;
    }

    const localStorage = await readLocalStorage(page, Object.keys(sentinels));
    for (const [key, expected] of Object.entries(sentinels)) {
      const received = localStorage[key] ?? null;
      if (received !== expected) {
        throw new ProductionRuntimeVerificationError(
          `localStorage sentinel ${key} changed: expected ${String(expected)}, received ${String(received)}`,
        );
      }
    }
    if (issues.length > 0) {
      throw new ProductionRuntimeVerificationError(
        `production runtime emitted errors:\n${formatIssues(issues)}`,
        issues,
      );
    }

    return { finalUrl: page.url(), localStorage };
  } finally {
    try {
      await browser?.close();
    } finally {
      if (child) await stopServer(child, options.server?.shutdownTimeoutMs ?? 5_000);
    }
  }
}
