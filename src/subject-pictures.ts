import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Peer-free bookkeeping for subject pictures: what a picture was rendered
 * from, and whether it still matches. Rendering lives in
 * `game-harness/subject-capture`; nothing here needs a browser, so a build's
 * staleness check can run where no browser is installed.
 */

/** A square size in pixels, or an explicit width and height. */
export type SubjectPictureSize = number | { readonly width: number; readonly height: number };

/** One committed picture and the evidence needed to detect that it went stale. */
export interface SubjectPictureRecord {
  /** The subject's name, shared by every size of its picture. */
  subject: string;
  /** Picture path, POSIX-separated, relative to the `rootDir` of the check. */
  path: string;
  width: number;
  height: number;
  /** SHA-256 of the PNG file exactly as committed. */
  sha256: string;
  /** SHA-256 of the subject's source ({@link hashSubjectSources}) when it was rendered. */
  sourceSha256: string;
}

export type SubjectPictureProblemKind =
  /** The subject's current source no longer matches the one the picture was rendered from. */
  | 'stale'
  /** The subject (or one expected size of it) has no recorded picture. */
  | 'missing-record'
  /** A recorded picture file does not exist. */
  | 'missing-file'
  /** The picture file differs from the bytes that were recorded. */
  | 'modified'
  /** The file is not a PNG, or its dimensions differ from its record. */
  | 'wrong-size'
  /** A record names a subject that has no current source hash. */
  | 'unknown-subject';

export interface SubjectPictureProblem {
  kind: SubjectPictureProblemKind;
  subject: string;
  /** Present when the problem is about a recorded picture file. */
  path?: string;
  /** Present for a `missing-record` problem about one size. */
  width?: number;
  height?: number;
  detail: string;
}

export interface SubjectPictureCheck {
  ok: boolean;
  problems: SubjectPictureProblem[];
}

export interface CheckSubjectPicturesOptions {
  /** Current source hash of every subject that must have a picture, by subject name. */
  sourceHashes: Readonly<Record<string, string>>;
  /** Directory the record paths are relative to. Defaults to `process.cwd()`. */
  rootDir?: string;
  /** Sizes every subject must have a picture at. When omitted, one record per subject suffices. */
  sizes?: readonly SubjectPictureSize[];
}

export interface HashSubjectSourceFilesOptions {
  /** Directory the source paths are relative to. Defaults to `process.cwd()`. */
  cwd?: string;
}

/** Thrown when sources cannot be hashed or {@link assertSubjectPicturesFresh} finds a problem. */
export class SubjectPictureError extends Error {
  readonly problems: readonly SubjectPictureProblem[];

  constructor(message: string, problems: readonly SubjectPictureProblem[] = []) {
    super(message);
    this.name = 'SubjectPictureError';
    this.problems = problems;
  }
}

/** Orders strings by UTF-16 code unit, the same on every machine and locale. */
function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Normalises a size to explicit pixel dimensions. */
export function subjectPictureDimensions(size: SubjectPictureSize): {
  width: number;
  height: number;
} {
  return typeof size === 'number' ? { width: size, height: size } : size;
}

export interface SubjectSourceEntry {
  /** A stable, repository-relative name. Part of the hash, so renaming a source changes it. */
  path: string;
  bytes: Uint8Array | string;
}

/**
 * Hashes everything a subject's picture is rendered from. The result does not
 * depend on the order of `entries`, and each entry's name and length are part
 * of the hash, so moving bytes between sources cannot go unnoticed.
 */
export function hashSubjectSources(entries: readonly SubjectSourceEntry[]): string {
  if (entries.length === 0) {
    throw new SubjectPictureError('a subject needs at least one source to hash');
  }
  const sorted = [...entries].sort((left, right) => compareCodePoints(left.path, right.path));
  const hash = createHash('sha256');
  let previous: string | undefined;
  for (const { path, bytes } of sorted) {
    if (path === previous) {
      throw new SubjectPictureError(`subject source path repeated: "${path}"`);
    }
    previous = path;
    const name = Buffer.from(path, 'utf8');
    const content = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
    hash.update(`${name.length}:`);
    hash.update(name);
    hash.update(`${content.length}:`);
    hash.update(content);
  }
  return hash.digest('hex');
}

/**
 * {@link hashSubjectSources} for files on disk. Paths are named in the hash
 * with POSIX separators, relative to `cwd`, so the same checkout hashes the
 * same on every platform. Line endings are not normalised: pin them with
 * `.gitattributes` if sources are checked out on Windows.
 */
export function hashSubjectSourceFiles(
  paths: readonly string[],
  options: HashSubjectSourceFilesOptions = {},
): string {
  const cwd = options.cwd ?? process.cwd();
  return hashSubjectSources(
    paths.map((path) => {
      const name = path.replaceAll('\\', '/');
      if (name.startsWith('/') || /^[A-Za-z]:/u.test(name) || name.split('/').includes('..')) {
        throw new SubjectPictureError(
          `subject source "${name}" must be a path inside cwd: an absolute or parent path would ` +
            'put this machine into the hash',
        );
      }
      try {
        return { path: name, bytes: readFileSync(resolve(cwd, name)) };
      } catch (error) {
        throw new SubjectPictureError(
          `cannot read subject source "${name}": ${(error as Error).message}`,
        );
      }
    }),
  );
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function checkRecord(
  record: SubjectPictureRecord,
  rootDir: string,
  sourceHashes: Readonly<Record<string, string>>,
): SubjectPictureProblem[] {
  const { subject, path } = record;
  const currentSource = Object.hasOwn(sourceHashes, subject) ? sourceHashes[subject] : undefined;
  if (currentSource === undefined) {
    return [
      {
        kind: 'unknown-subject',
        subject,
        path,
        detail: `${path} is recorded for "${subject}", which has no current source`,
      },
    ];
  }

  const problems: SubjectPictureProblem[] = [];
  if (currentSource !== record.sourceSha256) {
    problems.push({
      kind: 'stale',
      subject,
      path,
      detail: `${path} was rendered from a different source than "${subject}" has now`,
    });
  }

  let file: Buffer;
  try {
    file = readFileSync(resolve(rootDir, path));
  } catch {
    problems.push({ kind: 'missing-file', subject, path, detail: `${path} does not exist` });
    return problems;
  }
  if (sha256Hex(file) !== record.sha256) {
    problems.push({
      kind: 'modified',
      subject,
      path,
      detail: `${path} differs from the bytes that were recorded`,
    });
    return problems;
  }
  const dimensions = readPngDimensions(file);
  if (dimensions === undefined) {
    problems.push({ kind: 'wrong-size', subject, path, detail: `${path} is not a PNG` });
  } else if (dimensions.width !== record.width || dimensions.height !== record.height) {
    problems.push({
      kind: 'wrong-size',
      subject,
      path,
      detail: `${path} is ${dimensions.width}x${dimensions.height}, recorded as ${record.width}x${record.height}`,
    });
  }
  return problems;
}

/**
 * Compares committed pictures against the sources they should be rendered
 * from. A picture is stale when its recorded source hash differs from the
 * subject's current one. Missing pictures, edited files, wrong dimensions and
 * records for removed subjects are reported too, so a picture cannot drift
 * from its subject without the check saying so. Problems for recorded
 * pictures come first, in record order, then missing records by subject.
 */
export function checkSubjectPictures(
  records: readonly SubjectPictureRecord[],
  options: CheckSubjectPicturesOptions,
): SubjectPictureCheck {
  const rootDir = options.rootDir ?? process.cwd();
  const problems = records.flatMap((record) => checkRecord(record, rootDir, options.sourceHashes));

  const sizes = options.sizes?.map(subjectPictureDimensions);
  for (const subject of Object.keys(options.sourceHashes).sort(compareCodePoints)) {
    const own = records.filter((record) => record.subject === subject);
    if (sizes === undefined) {
      if (own.length === 0) {
        problems.push({
          kind: 'missing-record',
          subject,
          detail: `"${subject}" has no recorded picture`,
        });
      }
      continue;
    }
    for (const { width, height } of sizes) {
      if (!own.some((record) => record.width === width && record.height === height)) {
        problems.push({
          kind: 'missing-record',
          subject,
          width,
          height,
          detail: `"${subject}" has no recorded picture at ${width}x${height}`,
        });
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

/** {@link checkSubjectPictures}, throwing one {@link SubjectPictureError} that names every problem. */
export function assertSubjectPicturesFresh(
  records: readonly SubjectPictureRecord[],
  options: CheckSubjectPicturesOptions,
): void {
  const { ok, problems } = checkSubjectPictures(records, options);
  if (ok) return;
  const count = problems.length;
  const lines = problems.map((problem) => `  ${problem.kind}: ${problem.detail}`);
  throw new SubjectPictureError(
    `${count} subject ${count === 1 ? 'picture is' : 'pictures are'} not current:\n${lines.join('\n')}`,
    problems,
  );
}
