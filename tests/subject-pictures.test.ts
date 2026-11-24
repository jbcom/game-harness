import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertSubjectPicturesFresh,
  checkSubjectPictures,
  hashSubjectSourceFiles,
  hashSubjectSources,
  sha256Hex,
  SubjectPictureError,
  type SubjectPictureRecord,
} from '../src/subject-pictures.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'game-harness-pictures-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function png(width: number, height: number): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(7);
  return PNG.sync.write(image);
}

function writePicture(path: string, width: number, height: number): SubjectPictureRecord {
  const bytes = png(width, height);
  mkdirSync(join(root, 'pictures'), { recursive: true });
  writeFileSync(join(root, path), bytes);
  return {
    subject: 'shovel',
    path,
    width,
    height,
    sha256: sha256Hex(bytes),
    sourceSha256: 'a'.repeat(64),
  };
}

describe('hashSubjectSources', () => {
  it('is stable for the same sources whatever order they are listed in', () => {
    const forward = hashSubjectSources([
      { path: 'b.ts', bytes: 'two' },
      { path: 'a.ts', bytes: new Uint8Array([1, 2, 3]) },
    ]);
    const reversed = hashSubjectSources([
      { path: 'a.ts', bytes: new Uint8Array([1, 2, 3]) },
      { path: 'b.ts', bytes: 'two' },
    ]);
    expect(forward).toMatch(/^[0-9a-f]{64}$/u);
    expect(reversed).toBe(forward);
  });

  it('changes when a byte, a name or the set of sources changes', () => {
    const base = hashSubjectSources([{ path: 'a.ts', bytes: 'one' }]);
    expect(hashSubjectSources([{ path: 'a.ts', bytes: 'One' }])).not.toBe(base);
    expect(hashSubjectSources([{ path: 'b.ts', bytes: 'one' }])).not.toBe(base);
    expect(
      hashSubjectSources([
        { path: 'a.ts', bytes: 'one' },
        { path: 'b.ts', bytes: '' },
      ]),
    ).not.toBe(base);
  });

  it('does not let a boundary between name and bytes alias another source set', () => {
    expect(hashSubjectSources([{ path: 'ab', bytes: 'c' }])).not.toBe(
      hashSubjectSources([{ path: 'a', bytes: 'bc' }]),
    );
  });

  it('rejects an empty list and a repeated path', () => {
    expect(() => hashSubjectSources([])).toThrow(SubjectPictureError);
    expect(() =>
      hashSubjectSources([
        { path: 'a.ts', bytes: '1' },
        { path: 'a.ts', bytes: '2' },
      ]),
    ).toThrow(/repeated/u);
  });
});

describe('hashSubjectSourceFiles', () => {
  it('hashes files by their path relative to cwd, matching the in-memory form', () => {
    mkdirSync(join(root, 'models'), { recursive: true });
    writeFileSync(join(root, 'models', 'shovel.ts'), 'mesh');
    writeFileSync(join(root, 'models', 'shared.ts'), 'palette');
    expect(hashSubjectSourceFiles(['models/shovel.ts', 'models/shared.ts'], { cwd: root })).toBe(
      hashSubjectSources([
        { path: 'models/shovel.ts', bytes: 'mesh' },
        { path: 'models/shared.ts', bytes: 'palette' },
      ]),
    );
  });

  it('normalises Windows separators so one source hashes the same on every platform', () => {
    mkdirSync(join(root, 'models'), { recursive: true });
    writeFileSync(join(root, 'models', 'shovel.ts'), 'mesh');
    expect(hashSubjectSourceFiles(['models\\shovel.ts'], { cwd: root })).toBe(
      hashSubjectSources([{ path: 'models/shovel.ts', bytes: 'mesh' }]),
    );
  });

  it('fails closed on a source file that does not exist', () => {
    expect(() => hashSubjectSourceFiles(['models/gone.ts'], { cwd: root })).toThrow(
      /cannot read subject source "models\/gone\.ts"/u,
    );
  });

  it.each(['/etc/hostname', 'C:/models/shovel.ts', '../models/shovel.ts', 'models/../../x.ts'])(
    'refuses %s, which would put this machine into the hash',
    (path) => {
      expect(() => hashSubjectSourceFiles([path], { cwd: root })).toThrow(/inside cwd/u);
    },
  );

  it('defaults cwd to the process directory', () => {
    expect(hashSubjectSourceFiles(['package.json'])).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('checkSubjectPictures', () => {
  it('passes when every picture is present, unmodified and rendered from the current source', () => {
    const record = writePicture('pictures/shovel-256.png', 256, 256);
    const check = checkSubjectPictures([record], {
      rootDir: root,
      sourceHashes: { shovel: record.sourceSha256 },
      sizes: [256],
    });
    expect(check).toEqual({ ok: true, problems: [] });
  });

  it('reports a picture rendered from an older source as stale', () => {
    const record = writePicture('pictures/shovel-256.png', 256, 256);
    const check = checkSubjectPictures([record], {
      rootDir: root,
      sourceHashes: { shovel: 'b'.repeat(64) },
    });
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual([
      expect.objectContaining({ kind: 'stale', subject: 'shovel', path: record.path }),
    ]);
  });

  it('reports a subject with no picture and a subject missing a size', () => {
    const record = writePicture('pictures/shovel-256.png', 256, 256);
    const check = checkSubjectPictures([record], {
      rootDir: root,
      sourceHashes: { shovel: record.sourceSha256, bucket: 'c'.repeat(64) },
      sizes: [256, 512],
    });
    expect(check.problems.map((problem) => [problem.kind, problem.subject])).toEqual([
      ['missing-record', 'bucket'],
      ['missing-record', 'bucket'],
      ['missing-record', 'shovel'],
    ]);
    expect(check.problems.map((problem) => problem.width)).toEqual([256, 512, 512]);
  });

  it('requires only one record per subject when no sizes are named', () => {
    const check = checkSubjectPictures([], {
      rootDir: root,
      sourceHashes: { bucket: 'c'.repeat(64) },
    });
    expect(check.problems).toEqual([expect.objectContaining({ kind: 'missing-record' })]);
    expect(check.problems[0]).not.toHaveProperty('width');
  });

  it('reports a recorded picture whose file is gone', () => {
    const record = { ...writePicture('pictures/shovel-256.png', 256, 256), path: 'pictures/x.png' };
    const check = checkSubjectPictures([record], {
      rootDir: root,
      sourceHashes: { shovel: record.sourceSha256 },
    });
    expect(check.problems).toEqual([expect.objectContaining({ kind: 'missing-file' })]);
  });

  it('reports a picture edited after it was recorded, even when it is still a PNG', () => {
    const record = writePicture('pictures/shovel-256.png', 256, 256);
    const edited = png(256, 256);
    edited[edited.length - 20] = (edited[edited.length - 20] ?? 0) ^ 0xff;
    writeFileSync(join(root, record.path), edited);
    const check = checkSubjectPictures([record], {
      rootDir: root,
      sourceHashes: { shovel: record.sourceSha256 },
    });
    expect(check.problems).toEqual([expect.objectContaining({ kind: 'modified' })]);
  });

  it('reports a file that is not a PNG, or whose size differs from its record', () => {
    const notPng = Buffer.from('not a picture at all, just text that is long enough to read');
    mkdirSync(join(root, 'pictures'), { recursive: true });
    writeFileSync(join(root, 'pictures/text.png'), notPng);
    const text: SubjectPictureRecord = {
      subject: 'shovel',
      path: 'pictures/text.png',
      width: 256,
      height: 256,
      sha256: sha256Hex(notPng),
      sourceSha256: 'a'.repeat(64),
    };
    const small = writePicture('pictures/small.png', 128, 128);
    const check = checkSubjectPictures([text, { ...small, width: 256, height: 256 }], {
      rootDir: root,
      sourceHashes: { shovel: 'a'.repeat(64) },
    });
    expect(check.problems.map((problem) => problem.kind)).toEqual(['wrong-size', 'wrong-size']);
    expect(check.problems[0]?.detail).toMatch(/not a PNG/u);
    expect(check.problems[1]?.detail).toMatch(/128x128/u);
  });

  it('reports a file with a PNG signature but no header chunk, and accepts explicit sizes', () => {
    const headless = Buffer.concat([png(4, 4).subarray(0, 8), Buffer.alloc(32, 1)]);
    mkdirSync(join(root, 'pictures'), { recursive: true });
    writeFileSync(join(root, 'pictures/headless.png'), headless);
    const record: SubjectPictureRecord = {
      subject: 'shovel',
      path: 'pictures/headless.png',
      width: 4,
      height: 4,
      sha256: sha256Hex(headless),
      sourceSha256: 'a'.repeat(64),
    };
    const check = checkSubjectPictures([record], {
      rootDir: root,
      sourceHashes: { shovel: 'a'.repeat(64) },
      sizes: [{ width: 4, height: 4 }],
    });
    expect(check.problems).toEqual([
      expect.objectContaining({ kind: 'wrong-size', detail: expect.stringContaining('not a PNG') }),
    ]);
  });

  it('reports a record for a subject that no longer exists', () => {
    const record = writePicture('pictures/shovel-256.png', 256, 256);
    const check = checkSubjectPictures([record], { rootDir: root, sourceHashes: {} });
    expect(check.problems).toEqual([expect.objectContaining({ kind: 'unknown-subject' })]);
  });

  it('resolves picture paths against the current directory by default', () => {
    const check = checkSubjectPictures(
      [
        {
          subject: 'shovel',
          path: 'definitely/not/here.png',
          width: 1,
          height: 1,
          sha256: 'd'.repeat(64),
          sourceSha256: 'e'.repeat(64),
        },
      ],
      { sourceHashes: { shovel: 'e'.repeat(64) } },
    );
    expect(check.problems).toEqual([expect.objectContaining({ kind: 'missing-file' })]);
  });
});

describe('assertSubjectPicturesFresh', () => {
  it('returns quietly when nothing is stale', () => {
    const record = writePicture('pictures/shovel-256.png', 256, 256);
    expect(() =>
      assertSubjectPicturesFresh([record], {
        rootDir: root,
        sourceHashes: { shovel: record.sourceSha256 },
      }),
    ).not.toThrow();
  });

  it('throws one error that names every problem', () => {
    const record = writePicture('pictures/shovel-256.png', 256, 256);
    expect(() =>
      assertSubjectPicturesFresh([record], {
        rootDir: root,
        sourceHashes: { shovel: 'f'.repeat(64), bucket: 'f'.repeat(64) },
      }),
    ).toThrow(/2 subject pictures.*stale.*shovel.*missing-record.*bucket/su);
  });

  it('uses the singular for one problem', () => {
    expect(() =>
      assertSubjectPicturesFresh([], { rootDir: root, sourceHashes: { bucket: 'f'.repeat(64) } }),
    ).toThrow(/1 subject picture is not/u);
  });
});
