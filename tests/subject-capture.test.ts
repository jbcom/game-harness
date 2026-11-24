import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHROMIUM_ANTI_THROTTLING_ARGS } from '../src/chromium-launch.js';
import { captureSubject, SubjectCaptureError } from '../src/subject-capture.js';
import { sha256Hex } from '../src/subject-pictures.js';

vi.mock('@playwright/test', () => ({ chromium: { launch: vi.fn() } }));

const SOURCE = 'a'.repeat(64);

type Pixel = [number, number, number, number];

/** A PNG whose corner pixel is `corner` and every other pixel is `fill`. */
function png(width: number, height: number, fill: Pixel, corner: Pixel = fill): Buffer {
  const image = new PNG({ width, height });
  for (let index = 0; index < width * height; index += 1) {
    image.data.set(index === 0 ? corner : fill, index * 4);
  }
  return PNG.sync.write(image);
}

const SUBJECT_PIXELS: Pixel = [128, 64, 26, 255];
const CLEAR: Pixel = [0, 0, 0, 0];
const squarePng = (size: number): Buffer => png(size, size, SUBJECT_PIXELS, CLEAR);

interface WebGLStub {
  RENDERER: number;
  getExtension: (name: string) => { UNMASKED_RENDERER_WEBGL: number } | null;
  getParameter: (parameter: number) => string;
}

/** Stubs the DOM the in-page callbacks use, so their bodies run in this node process. */
function stubDom(contexts: { webgl2?: WebGLStub | null; webgl?: WebGLStub | null }) {
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: (kind: 'webgl2' | 'webgl') => contexts[kind] ?? null,
    }),
  });
  const frames: number[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frames.push(1);
    callback();
    return 1;
  });
  return frames;
}

function unmasked(renderer: string): WebGLStub {
  return {
    RENDERER: 1,
    getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 2 }),
    getParameter: (parameter) => (parameter === 2 ? renderer : 'WebKit WebGL'),
  };
}

function createBrowser(screenshots: Buffer[]) {
  const subjectPages: ReturnType<typeof createPage>[] = [];
  const probePage = createPage(() => Buffer.alloc(0));
  const queue = [...screenshots];
  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn(async (options?: unknown) => {
      if (options === undefined) return probePage;
      const page = createPage(() => queue.shift() ?? Buffer.alloc(0));
      subjectPages.push(page);
      return page;
    }),
  };
  vi.mocked(chromium.launch).mockResolvedValue(browser as never);
  return { browser, probePage, subjectPages };
}

function createPage(screenshot: () => Buffer) {
  const page = {
    close: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(async (callback: (argument?: unknown) => unknown, argument?: unknown) =>
      callback(argument),
    ),
    goto: vi.fn().mockResolvedValue(null),
    locator: vi.fn(() => ({ screenshot: vi.fn(async () => screenshot()) })),
    screenshot: vi.fn(async () => screenshot()),
  };
  return page;
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'game-harness-capture-unit-'));
  stubDom({
    webgl2: unmasked('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)'),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(chromium.launch).mockReset();
  rmSync(workDir, { recursive: true, force: true });
});

function base(overrides: Record<string, unknown> = {}) {
  return {
    subject: 'shovel',
    url: 'http://127.0.0.1/lab',
    sizes: [64],
    outDir: join(workDir, 'pictures'),
    rootDir: workDir,
    sourceSha256: SOURCE,
    ...overrides,
  };
}

describe('captureSubject options', () => {
  it.each([
    [
      'a subject name that is not a file-name token',
      { subject: '../shovel' },
      /invalid subject name/u,
    ],
    ['an empty subject name', { subject: '' }, /invalid subject name/u],
    ['a source hash that is not SHA-256 hex', { sourceSha256: 'abc' }, /sourceSha256/u],
    ['no sizes', { sizes: [] }, /sizes must not be empty/u],
    ['a zero size', { sizes: [0] }, /whole pixels/u],
    ['a fractional height', { sizes: [{ width: 64, height: 1.5 }] }, /whole pixels/u],
    ['an enormous size', { sizes: [20_000] }, /whole pixels/u],
    ['a repeated size', { sizes: [64, { width: 64, height: 64 }] }, /listed twice/u],
    ['negative settle frames', { settleFrames: -1 }, /settleFrames/u],
    ['fractional settle frames', { settleFrames: 0.5 }, /settleFrames/u],
  ])('rejects %s before launching a browser', async (_name, overrides, message) => {
    await expect(captureSubject(base(overrides))).rejects.toThrow(message);
    await expect(captureSubject(base(overrides))).rejects.toBeInstanceOf(SubjectCaptureError);
    expect(chromium.launch).not.toHaveBeenCalled();
  });
});

describe('captureSubject', () => {
  it('launches the silent software profile headless and returns recorded, written pictures', async () => {
    const { browser, subjectPages } = createBrowser([
      squarePng(64),
      png(80, 40, SUBJECT_PIXELS, CLEAR),
    ]);
    const result = await captureSubject(
      base({ sizes: [64, { width: 80, height: 40 }], outDir: join(workDir, 'nested', 'pictures') }),
    );

    const launch = vi.mocked(chromium.launch).mock.calls[0]?.[0];
    expect(launch?.headless).toBe(true);
    expect(launch?.args?.slice(0, 4)).toEqual([
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ]);
    expect(launch?.args).toEqual(expect.arrayContaining([...CHROMIUM_ANTI_THROTTLING_ARGS]));
    expect(launch?.args?.at(-1)).toBe('--mute-audio');

    expect(result.renderer).toMatch(/SwiftShader/u);
    expect(result.subject).toBe('shovel');
    expect(result.pictures.map((picture) => [picture.path, picture.width, picture.height])).toEqual(
      [
        ['nested/pictures/shovel-64.png', 64, 64],
        ['nested/pictures/shovel-80x40.png', 80, 40],
      ],
    );
    for (const picture of result.pictures) {
      expect(readFileSync(join(workDir, picture.path)).equals(picture.bytes)).toBe(true);
      expect(picture.sha256).toBe(sha256Hex(picture.bytes));
      expect(picture.sourceSha256).toBe(SOURCE);
    }
    expect(browser.newPage).toHaveBeenCalledWith({
      viewport: { width: 80, height: 40 },
      deviceScaleFactor: 1,
    });
    expect(subjectPages[0]?.goto).toHaveBeenCalledWith('http://127.0.0.1/lab', {
      waitUntil: 'load',
    });
    expect(subjectPages[0]?.screenshot).toHaveBeenCalledWith({
      type: 'png',
      omitBackground: true,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    });
    expect(subjectPages.every((page) => page.close.mock.calls.length === 1)).toBe(true);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('waits the requested animation frames after the ready hook', async () => {
    const frames = stubDom({ webgl2: unmasked('SwiftShader') });
    createBrowser([squarePng(64)]);
    const order: string[] = [];
    await captureSubject(
      base({
        settleFrames: 3,
        ready: async (_page: unknown, size: unknown) => {
          order.push(`ready ${JSON.stringify(size)}`);
          expect(frames).toHaveLength(0);
        },
      }),
    );
    expect(order).toEqual(['ready {"width":64,"height":64}']);
    expect(frames).toHaveLength(3);
  });

  it('settles two frames by default and none when asked for zero', async () => {
    const frames = stubDom({ webgl2: unmasked('SwiftShader') });
    createBrowser([squarePng(64)]);
    await captureSubject(base());
    expect(frames).toHaveLength(2);

    frames.length = 0;
    createBrowser([squarePng(64)]);
    await captureSubject(base({ settleFrames: 0 }));
    expect(frames).toHaveLength(0);
  });

  it('computes the page address from the size and captures a selector through its locator', async () => {
    const { subjectPages } = createBrowser([squarePng(64)]);
    const sizes: unknown[] = [];
    await captureSubject(
      base({
        url: (size: unknown) => {
          sizes.push(size);
          return 'http://127.0.0.1/lab?size=64';
        },
        selector: '#subject',
      }),
    );
    expect(sizes).toEqual([{ width: 64, height: 64 }]);
    expect(subjectPages[0]?.goto).toHaveBeenCalledWith('http://127.0.0.1/lab?size=64', {
      waitUntil: 'load',
    });
    expect(subjectPages[0]?.locator).toHaveBeenCalledWith('#subject');
    expect(subjectPages[0]?.screenshot).not.toHaveBeenCalled();
  });

  it('records paths relative to the current directory by default', async () => {
    createBrowser([squarePng(64)]);
    vi.spyOn(process, 'cwd').mockReturnValue(workDir);
    const { rootDir: _rootDir, ...options } = base();
    const result = await captureSubject(options);
    expect(result.pictures[0]?.path).toBe('pictures/shovel-64.png');
  });

  it('passes caller launch options through but never lets them unmute or reorder the profile', async () => {
    createBrowser([squarePng(64)]);
    await captureSubject(
      base({
        gpuMode: 'auto',
        launchOptions: {
          headless: false,
          args: ['--force-device-scale-factor=1', '--mute-audio'],
          env: { TEST_SENTINEL: 'kept' },
          executablePath: '/opt/chromium',
        },
      }),
    );
    const launch = vi.mocked(chromium.launch).mock.calls[0]?.[0];
    expect(launch).toMatchObject({ headless: false, executablePath: '/opt/chromium' });
    expect(launch?.args).toContain('--force-device-scale-factor=1');
    expect(launch?.args?.filter((argument) => argument === '--mute-audio')).toHaveLength(1);
    expect(launch?.args?.at(-1)).toBe('--mute-audio');
    expect(launch?.env).toMatchObject({ TEST_SENTINEL: 'kept' });
  });

  it('refuses a renderer that is not SwiftShader under the software profile', async () => {
    stubDom({ webgl2: unmasked('Apple M2 Max') });
    const { browser, probePage } = createBrowser([squarePng(64)]);
    await expect(captureSubject(base())).rejects.toThrow(
      /needs SwiftShader but WebGL reported "Apple M2 Max"/u,
    );
    expect(probePage.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(browser.newPage).toHaveBeenCalledTimes(1);
  });

  it('does not judge the renderer for other profiles, and falls back to webgl1 and the masked name', async () => {
    stubDom({
      webgl2: null,
      webgl: {
        RENDERER: 7,
        getExtension: () => null,
        getParameter: (parameter) => (parameter === 7 ? 'masked renderer' : 'other'),
      },
    });
    createBrowser([squarePng(64)]);
    const result = await captureSubject(base({ gpuMode: 'auto' }));
    expect(result.renderer).toBe('masked renderer');
  });

  it('captures a subject that needs no WebGL when the browser has none', async () => {
    stubDom({});
    createBrowser([squarePng(64)]);
    const result = await captureSubject(base());
    expect(result.renderer).toBeNull();
  });

  it('fails closed on a picture of the wrong size', async () => {
    const { browser, subjectPages } = createBrowser([squarePng(32)]);
    await expect(captureSubject(base())).rejects.toThrow(
      /shovel-64\.png came out 32x32, not 64x64/u,
    );
    expect(subjectPages[0]?.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('writes nothing when a later size fails, so no half-replaced set is left behind', async () => {
    createBrowser([squarePng(64), squarePng(32)]);
    await expect(captureSubject(base({ sizes: [64, 128] }))).rejects.toThrow(/came out 32x32/u);
    expect(existsSync(join(workDir, 'pictures'))).toBe(false);
  });

  it('fails closed on a picture of a width that matches but a height that does not', async () => {
    createBrowser([png(64, 32, SUBJECT_PIXELS, CLEAR)]);
    await expect(captureSubject(base())).rejects.toThrow(/came out 64x32/u);
  });

  it('fails closed on a picture in which nothing drew', async () => {
    createBrowser([png(64, 64, CLEAR)]);
    await expect(captureSubject(base())).rejects.toThrow(/fully transparent/u);
  });

  it('fails closed on a picture with an opaque background', async () => {
    createBrowser([png(64, 64, SUBJECT_PIXELS)]);
    await expect(captureSubject(base())).rejects.toThrow(/no transparent pixel/u);
  });

  it('closes the browser when navigation fails', async () => {
    const { browser, subjectPages } = createBrowser([squarePng(64)]);
    browser.newPage.mockImplementationOnce(async () => createPage(() => Buffer.alloc(0)));
    const failing = createPage(() => Buffer.alloc(0));
    failing.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));
    browser.newPage.mockImplementationOnce(async () => failing);
    await expect(captureSubject(base())).rejects.toThrow(/ERR_CONNECTION_REFUSED/u);
    expect(failing.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(subjectPages).toHaveLength(0);
  });
});
