import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureSubject } from '../../src/subject-capture.js';
import {
  assertSubjectPicturesFresh,
  hashSubjectSources,
  SubjectPictureError,
} from '../../src/subject-pictures.js';

const headless = process.env.HEAVY_BROWSER_HEADLESS === '1';
const launchOptions = { headless };

/**
 * A subject drawn by WebGL on a transparent canvas: an opaque square covering
 * the middle half of whatever size the viewport is, in a colour that proves
 * the pixels came from the GPU path and not from the page.
 */
function subjectPage(background: string): string {
  return `data:text/html,${encodeURIComponent(`<!doctype html>
<body style="margin:0;background:${background}">
<canvas id="subject" style="display:block"></canvas>
<script>
  const canvas = document.getElementById('subject');
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(canvas.width / 4, canvas.height / 4, canvas.width / 2, canvas.height / 2);
  gl.clearColor(0.5, 0.25, 0.1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  window.subjectReady = true;
</script></body>`)}`;
}

function pixel(png: PNG, x: number, y: number): number[] {
  const offset = (y * png.width + x) * 4;
  return Array.from(png.data.subarray(offset, offset + 4));
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'game-harness-capture-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('subject capture in a real browser', () => {
  it('renders one subject to transparent PNGs at each size, with SwiftShader', async () => {
    const sourceSha256 = hashSubjectSources([{ path: 'shovel.ts', bytes: 'mesh' }]);
    const result = await captureSubject({
      subject: 'shovel',
      url: subjectPage('transparent'),
      sizes: [64, 128],
      outDir: join(workDir, 'pictures'),
      rootDir: workDir,
      sourceSha256,
      ready: async (page) => {
        await page.waitForFunction(
          () => (window as unknown as { subjectReady?: boolean }).subjectReady,
        );
      },
      launchOptions,
    });

    expect(result.renderer).toMatch(/swiftshader/iu);
    expect(result.pictures.map((picture) => [picture.path, picture.width, picture.height])).toEqual(
      [
        ['pictures/shovel-64.png', 64, 64],
        ['pictures/shovel-128.png', 128, 128],
      ],
    );
    for (const picture of result.pictures) {
      expect(readFileSync(join(workDir, picture.path)).equals(picture.bytes)).toBe(true);
      const png = PNG.sync.read(picture.bytes);
      expect(pixel(png, 1, 1)).toEqual([0, 0, 0, 0]);
      const centre = pixel(png, png.width / 2, png.height / 2);
      expect(centre[3]).toBe(255);
      expect(Math.abs((centre[0] ?? 0) - 128)).toBeLessThanOrEqual(1);
      expect(Math.abs((centre[2] ?? 0) - 26)).toBeLessThanOrEqual(1);
    }

    // The records feed the staleness check: current source passes, a changed one does not.
    const records = result.pictures.map(({ bytes: _bytes, ...record }) => record);
    expect(() =>
      assertSubjectPicturesFresh(records, {
        rootDir: workDir,
        sourceHashes: { shovel: sourceSha256 },
        sizes: [64, 128],
      }),
    ).not.toThrow();
    expect(() =>
      assertSubjectPicturesFresh(records, {
        rootDir: workDir,
        sourceHashes: { shovel: hashSubjectSources([{ path: 'shovel.ts', bytes: 'new mesh' }]) },
      }),
    ).toThrow(SubjectPictureError);
  });

  it('gives identical bytes from two fresh browser launches', async () => {
    const capture = () =>
      captureSubject({
        subject: 'shovel',
        url: subjectPage('transparent'),
        sizes: [96],
        outDir: join(workDir, 'pictures'),
        rootDir: workDir,
        sourceSha256: 'a'.repeat(64),
        launchOptions,
      });
    const first = await capture();
    const second = await capture();
    expect(second.pictures[0]?.sha256).toBe(first.pictures[0]?.sha256);
    expect(second.pictures[0]?.bytes.equals(first.pictures[0]?.bytes ?? Buffer.alloc(0))).toBe(
      true,
    );
  });

  it('captures a chosen element and passes the size to a url function', async () => {
    const sizes: number[] = [];
    const result = await captureSubject({
      subject: 'shovel',
      url: ({ width }) => {
        sizes.push(width);
        return subjectPage('transparent');
      },
      selector: '#subject',
      sizes: [{ width: 80, height: 40 }],
      outDir: join(workDir, 'pictures'),
      rootDir: workDir,
      sourceSha256: 'a'.repeat(64),
      launchOptions,
    });
    expect(sizes).toEqual([80]);
    expect(result.pictures[0]).toMatchObject({
      path: 'pictures/shovel-80x40.png',
      width: 80,
      height: 40,
    });
  });

  it('fails closed when the page background is opaque', async () => {
    await expect(
      captureSubject({
        subject: 'shovel',
        url: subjectPage('white'),
        sizes: [64],
        outDir: join(workDir, 'pictures'),
        sourceSha256: 'a'.repeat(64),
        launchOptions,
      }),
    ).rejects.toThrow(/has no transparent pixel/u);
  });
});
