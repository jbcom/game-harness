import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { type ChromiumGpuMode, createChromiumLaunchProfile } from './chromium-launch.js';
import {
  sha256Hex,
  type SubjectPictureRecord,
  type SubjectPictureSize,
  subjectPictureDimensions,
} from './subject-pictures.js';

type BrowserLaunchOptions = NonNullable<Parameters<typeof chromium.launch>[0]>;

/** Pixel dimensions of one capture, passed to `url` and `ready`. */
export interface SubjectCaptureSize {
  width: number;
  height: number;
}

export interface SubjectCaptureOptions {
  /**
   * The subject's name: part of every file name and the key the picture is
   * recorded under. Letters, digits, `.`, `_` and `-`.
   */
  subject: string;
  /**
   * The page that renders the subject alone, or a function of the capture
   * size when the page takes it as input. The page must keep its own
   * background transparent (and a WebGL canvas must be created with
   * `alpha: true`): the capture fails when no pixel is transparent.
   */
  url: string | ((size: SubjectCaptureSize) => string);
  /** Square sizes in pixels, or explicit dimensions. Each is captured at device scale 1. */
  sizes: readonly SubjectPictureSize[];
  /** Directory the PNGs are written to, created when missing. */
  outDir: string;
  /** What the picture is rendered from: `hashSubjectSources()` / `hashSubjectSourceFiles()`. Recorded for the staleness check. */
  sourceSha256: string;
  /** Directory the recorded paths are relative to. Defaults to `process.cwd()`. */
  rootDir?: string;
  /**
   * Called after the page has loaded and before the capture, once per size.
   * Resolve when the subject has finished drawing (an asset loaded, a
   * "ready" flag set). The harness then waits `settleFrames` animation frames.
   * The subject should be drawn as a still frame: a page that keeps animating
   * gives different bytes on each run.
   */
  ready?: (page: Page, size: SubjectCaptureSize) => Promise<unknown>;
  /** Animation frames to wait after `ready`. Defaults to 2. */
  settleFrames?: number;
  /** Capture this element instead of the whole viewport. It must be exactly the capture size. */
  selector?: string;
  /**
   * Renderer profile. Defaults to `software`, the profile this package proves
   * byte-stable across fresh launches on one platform. With `software` the
   * capture fails when WebGL reports anything other than SwiftShader. A
   * hardware profile is allowed but makes no such promise.
   */
  gpuMode?: ChromiumGpuMode;
  /** Extra Playwright launch options. `headless` defaults to true; `--mute-audio` is always applied last. */
  launchOptions?: BrowserLaunchOptions;
}

/** A captured picture: its record, ready to commit, plus the bytes themselves. */
export interface SubjectPicture extends SubjectPictureRecord {
  bytes: Buffer;
}

export interface SubjectCaptureResult {
  subject: string;
  /** The unmasked WebGL renderer the capture ran on, or null when the browser exposed no WebGL. */
  renderer: string | null;
  pictures: SubjectPicture[];
}

/** Thrown for invalid options and for every capture that cannot be trusted. */
export class SubjectCaptureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SubjectCaptureError';
  }
}

const SUBJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const MAX_DIMENSION = 16_384;
const SOFTWARE_RENDERER = /swiftshader/iu;

function validate(options: SubjectCaptureOptions): SubjectCaptureSize[] {
  if (!SUBJECT_NAME.test(options.subject)) {
    throw new SubjectCaptureError(
      `invalid subject name ${JSON.stringify(options.subject)}: use letters, digits, ".", "_" and "-"`,
    );
  }
  if (!SHA256_HEX.test(options.sourceSha256)) {
    throw new SubjectCaptureError('sourceSha256 must be a lowercase SHA-256 hex digest');
  }
  if (options.sizes.length === 0) throw new SubjectCaptureError('sizes must not be empty');
  const sizes = options.sizes.map(subjectPictureDimensions);
  const seen = new Set<string>();
  for (const { width, height } of sizes) {
    for (const value of [width, height]) {
      if (!Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) {
        throw new SubjectCaptureError(
          `size ${width}x${height} must use whole pixels from 1 to ${MAX_DIMENSION}`,
        );
      }
    }
    const key = `${width}x${height}`;
    if (seen.has(key)) throw new SubjectCaptureError(`size ${key} is listed twice`);
    seen.add(key);
  }
  const frames = options.settleFrames ?? 2;
  if (!Number.isInteger(frames) || frames < 0) {
    throw new SubjectCaptureError('settleFrames must be a whole number of frames, 0 or more');
  }
  return sizes;
}

function pictureFileName(subject: string, { width, height }: SubjectCaptureSize): string {
  return width === height ? `${subject}-${width}.png` : `${subject}-${width}x${height}.png`;
}

/** The unmasked renderer of a throwaway WebGL context in this browser, or null without WebGL. */
async function probeRenderer(browser: Browser): Promise<string | null> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!context) return null;
      const extension = context.getExtension('WEBGL_debug_renderer_info');
      return String(context.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER));
    });
  } finally {
    await page.close();
  }
}

function verifyPicture(bytes: Buffer, size: SubjectCaptureSize, label: string): void {
  const image = PNG.sync.read(bytes);
  if (image.width !== size.width || image.height !== size.height) {
    throw new SubjectCaptureError(
      `${label} came out ${image.width}x${image.height}, not ${size.width}x${size.height}: ` +
        'the captured element must be exactly the capture size',
    );
  }
  let transparent = 0;
  let visible = 0;
  for (let offset = 3; offset < image.data.length; offset += 4) {
    if (image.data[offset] === 0) transparent += 1;
    else visible += 1;
  }
  if (visible === 0) {
    throw new SubjectCaptureError(`${label} is fully transparent: the subject did not draw`);
  }
  if (transparent === 0) {
    throw new SubjectCaptureError(
      `${label} has no transparent pixel: the page or canvas background is opaque`,
    );
  }
}

/**
 * Replaces the picture set as a unit. Every picture is staged beside its
 * destination and the existing files are copied aside first; if any step
 * fails, the files already replaced are restored, so a failure never leaves a
 * half-replaced set behind.
 */
function publishPictures(
  outDir: string,
  rootDir: string,
  pictures: readonly SubjectPicture[],
): void {
  mkdirSync(outDir, { recursive: true });
  const targets = pictures.map((picture) => resolve(rootDir, picture.path));
  const staged = targets.map((target) => `${target}.${process.pid}.new`);
  const backups = new Map<string, string>();
  const published: string[] = [];
  try {
    for (const [index, picture] of pictures.entries()) {
      writeFileSync(staged[index] as string, picture.bytes);
    }
    for (const target of targets) {
      if (existsSync(target)) {
        const backup = `${target}.${process.pid}.old`;
        copyFileSync(target, backup);
        backups.set(target, backup);
      }
    }
    for (const [index, target] of targets.entries()) {
      renameSync(staged[index] as string, target);
      published.push(target);
    }
  } catch (error) {
    // Each picture is restored on its own, so one failed restoration does not
    // strand the rest, and the copy of anything not restored is kept.
    const kept: string[] = [];
    for (const target of published) {
      const backup = backups.get(target);
      if (backup === undefined) {
        rmSync(target, { force: true });
        continue;
      }
      try {
        copyFileSync(backup, target);
      } catch {
        kept.push(backup);
      }
    }
    for (const file of backups.values()) {
      if (!kept.includes(file)) rmSync(file, { force: true });
    }
    for (const file of staged) rmSync(file, { force: true });
    if (kept.length > 0) {
      throw new SubjectCaptureError(
        `publishing the pictures failed (${(error as Error).message}) and ${kept.length} ` +
          `could not be restored; kept for recovery: ${kept.join(', ')}`,
        { cause: error },
      );
    }
    throw error;
  }
  // Published: the copies of what was replaced are no longer needed.
  for (const backup of backups.values()) rmSync(backup, { force: true });
}

/**
 * Renders one subject alone to a transparent PNG at each requested size, in a
 * fresh Chromium launched through the shared silent profile, and returns the
 * bytes with a record for the staleness check.
 *
 * It is the capture half of a product-picture pipeline; the game owns the page
 * that draws the subject. Fails closed: when WebGL reports a renderer other
 * than SwiftShader under the default `software` profile, when a picture is the
 * wrong size, fully transparent, or has no transparent pixel at all.
 *
 * Bytes are stable across runs on one platform with one Chromium build; they
 * are not claimed to match across platforms or browser versions.
 */
export async function captureSubject(
  options: SubjectCaptureOptions,
): Promise<SubjectCaptureResult> {
  const sizes = validate(options);
  const gpuMode = options.gpuMode ?? 'software';
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const outDir = resolve(options.outDir);
  const profile = createChromiumLaunchProfile({
    gpuMode,
    ...(options.launchOptions?.args ? { args: options.launchOptions.args } : {}),
    ...(options.launchOptions?.env
      ? { env: options.launchOptions.env as Record<string, string | undefined> }
      : {}),
  });

  const browser = await chromium.launch({
    ...options.launchOptions,
    ...profile,
    headless: options.launchOptions?.headless ?? true,
  });
  try {
    const renderer = await probeRenderer(browser);
    if (gpuMode === 'software' && renderer !== null && !SOFTWARE_RENDERER.test(renderer)) {
      throw new SubjectCaptureError(
        `the software profile needs SwiftShader but WebGL reported "${renderer}"`,
      );
    }

    const pictures: SubjectPicture[] = [];
    for (const size of sizes) {
      const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
      try {
        const url = typeof options.url === 'function' ? options.url(size) : options.url;
        await page.goto(url, { waitUntil: 'load' });
        await options.ready?.(page, size);
        await page.evaluate(
          (frames) =>
            new Promise<void>((done) => {
              const next = (remaining: number): void => {
                if (remaining === 0) done();
                else requestAnimationFrame(() => next(remaining - 1));
              };
              next(frames);
            }),
          options.settleFrames ?? 2,
        );
        const target = options.selector ? page.locator(options.selector) : page;
        const bytes = await target.screenshot({
          type: 'png',
          omitBackground: true,
          animations: 'disabled',
          caret: 'hide',
          scale: 'css',
        });
        const fileName = pictureFileName(options.subject, size);
        verifyPicture(bytes, size, fileName);

        pictures.push({
          subject: options.subject,
          path: relative(rootDir, resolve(outDir, fileName)).split('\\').join('/'),
          width: size.width,
          height: size.height,
          sha256: sha256Hex(bytes),
          sourceSha256: options.sourceSha256,
          bytes,
        });
      } finally {
        await page.close();
      }
    }
    // Nothing is written until every size has been captured and verified.
    publishPictures(outDir, rootDir, pictures);
    return { subject: options.subject, renderer, pictures };
  } finally {
    await browser.close();
  }
}
