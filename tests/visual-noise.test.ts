import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runVisualBattery } from '../src/visual-battery.js';

let cwd: string;
let baseline: string;
let committed: Buffer;
const logs: string[] = [];

function image(width = 10, height = 10, delta = 0): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(100);
  png.data[0] = 100 + delta;
  png.data[7] = 100 + delta;
  return PNG.sync.write(png);
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'visual-noise-'));
  mkdirSync(join(cwd, 'harness/__screenshots__'), { recursive: true });
  writeFileSync(join(cwd, 'harness/scene.browser.test.ts'), '// synthetic harness');
  baseline = join(cwd, 'harness/__screenshots__/scene with spaces.png');
  committed = image();
  writeFileSync(baseline, committed);
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['add', '.'], { cwd });
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'test: fixture'],
    { cwd },
  );
  logs.length = 0;
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

function run(bytes: Buffer, extra = {}, target = baseline): void {
  const script = `require('node:fs').writeFileSync(${JSON.stringify(target)}, Buffer.from('${bytes.toString('base64')}', 'base64'))`;
  runVisualBattery('harness', {
    cwd,
    ci: true,
    testCommand: { command: process.execPath, args: ['-e', script] },
    log: (message) => logs.push(message),
    error: () => undefined,
    ...extra,
  });
}

it('identical PNGs are clean', () => {
  run(committed);
  expect(logs.join('\n')).toContain('no visual drift');
});

it('1/255 noise is clean and restored to committed bytes', () => {
  run(image(10, 10, 1));
  expect(readFileSync(baseline)).toEqual(committed);
  expect(logs.join('\n')).toContain('rasterization noise (2 px within ±2)');
  expect(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })).toBe('');
});

it('a 3/255 change is drift', () => {
  const png = PNG.sync.read(committed);
  png.data[0] = 103;
  expect(() => run(PNG.sync.write(png))).toThrow(/drift/);
});

it('dimension changes are drift', () => {
  expect(() => run(image(11, 10))).toThrow(/drift/);
  writeFileSync(baseline, committed);
  expect(() => run(image(10, 11))).toThrow(/drift/);
});

it('new baselines are drift', () => {
  expect(() => run(committed, {}, join(cwd, 'harness/__screenshots__/new.png'))).toThrow(/drift/);
});

it('the channel tolerance is inclusive and configurable', () => {
  run(image(10, 10, 2));
  expect(readFileSync(baseline)).toEqual(committed);
  expect(() => run(image(10, 10, 1), { maxChannelDelta: 0 })).toThrow(/drift/);
});

it('the different-pixel ratio is inclusive and configurable', () => {
  run(image(10, 10, 3), { maxDifferentPixelRatio: 0.02 });
  expect(readFileSync(baseline)).toEqual(committed);
  expect(logs.join('\n')).toContain('accepted pixel tolerance');
  expect(() => run(image(10, 10, 3), { maxDifferentPixelRatio: 0.01 })).toThrow(/drift/);
});

it('identical pixels with different PNG encoding are restored', () => {
  const encoded = PNG.sync.write(PNG.sync.read(committed), { deflateLevel: 0 });
  expect(encoded).not.toEqual(committed);
  run(encoded);
  expect(readFileSync(baseline)).toEqual(committed);
  expect(logs.join('\n')).toContain('rasterization noise (0 px');
});

it('invalid PNGs fail closed', () => {
  expect(() => run(Buffer.from('not PNG'))).toThrow(/drift/);
});

it('deleted baselines are drift', () => {
  writeFileSync(join(cwd, 'harness/__screenshots__/other.png'), committed);
  execFileSync('git', ['add', '.'], { cwd });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-qm',
      'test: second fixture',
    ],
    { cwd },
  );
  const script = `require('node:fs').unlinkSync(${JSON.stringify(baseline)})`;
  expect(() =>
    runVisualBattery('harness', {
      cwd,
      ci: true,
      testCommand: { command: process.execPath, args: ['-e', script] },
      log: () => undefined,
      error: () => undefined,
    }),
  ).toThrow(/drift/);
});

it.each([-1, 256, 1.5, NaN])('rejects invalid channel tolerance %s', (value) => {
  expect(() => run(committed, { maxChannelDelta: value })).toThrow(/maxChannelDelta/);
});

it.each([-1, 2, NaN])('rejects invalid pixel ratio %s', (value) => {
  expect(() => run(committed, { maxDifferentPixelRatio: value })).toThrow(/maxDifferentPixelRatio/);
});
