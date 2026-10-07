import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * A headed Chromium driven over the raw DevTools protocol.
 *
 * Playwright is deliberately not the driver here: it launches Chromium with
 * its own anti-throttling switches and enables focus emulation on every page
 * it controls, which keeps pages visible. Either would mask exactly what these
 * tests measure, so only Playwright's downloaded browser binary is reused.
 */
export interface RawChromium {
  /** Opens a tab in the existing window and returns its attached session id. */
  openTab(url: string): Promise<string>;
  /** Opens a foreground tab without attaching to it. */
  openForegroundTab(url: string): Promise<void>;
  /** Evaluates an expression in an attached tab and returns its JSON value. */
  evaluate<T>(sessionId: string, expression: string): Promise<T>;
  close(): Promise<void>;
}

interface PendingCall {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

interface ProtocolMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

const LAUNCH_TIMEOUT_MS = 30_000;

function waitForDevToolsUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error(`Chromium did not expose DevTools in time:\n${output}`)),
      LAUNCH_TIMEOUT_MS,
    );
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /DevTools listening on (ws:\/\/\S+)/u.exec(output);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited with ${code} before DevTools was ready:\n${output}`));
    });
  });
}

export async function launchRawChromium(args: readonly string[]): Promise<RawChromium> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'game-harness-chromium-'));
  const child = spawn(
    chromium.executablePath(),
    [
      ...args,
      // Hosted Linux runners restrict the user namespaces Chromium's sandbox
      // needs; Playwright disables the sandbox there for the same reason.
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));

  const removeProfile = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exited;
    }
    rmSync(userDataDir, { recursive: true, force: true });
  };

  let socket: WebSocket;
  try {
    socket = new WebSocket(await waitForDevToolsUrl(child));
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('DevTools socket failed')), {
        once: true,
      });
    });
  } catch (error) {
    await removeProfile();
    throw error;
  }

  let nextId = 0;
  const pending = new Map<number, PendingCall>();
  socket.addEventListener('message', (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as ProtocolMessage;
    const call = message.id === undefined ? undefined : pending.get(message.id);
    if (!call || message.id === undefined) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result ?? {});
  });

  const send = (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      nextId += 1;
      pending.set(nextId, { resolve, reject });
      socket.send(JSON.stringify({ id: nextId, method, params, sessionId }));
    });

  return {
    async openTab(url) {
      const { targetId } = await send('Target.createTarget', { url });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      // A freshly created target may not have a JavaScript context yet on a
      // slow host; wait until its document has loaded before handing it out.
      const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
      for (;;) {
        try {
          const response = await send(
            'Runtime.evaluate',
            { expression: 'document.readyState', returnByValue: true },
            String(sessionId),
          );
          if ((response.result as { value?: unknown }).value === 'complete') break;
        } catch (error) {
          if (!/execution context/u.test(String(error)) || Date.now() > deadline) throw error;
        }
        if (Date.now() > deadline) throw new Error(`tab did not finish loading: ${url}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return String(sessionId);
    },
    async openForegroundTab(url) {
      await send('Target.createTarget', { url });
    },
    async evaluate<T>(sessionId: string, expression: string) {
      const response = await send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      );
      const exception = response.exceptionDetails as { text?: string } | undefined;
      if (exception) throw new Error(`evaluation failed: ${exception.text ?? expression}`);
      return (response.result as { value: T }).value;
    },
    async close() {
      socket.close();
      await removeProfile();
    },
  };
}
