---
title: Subject pictures
description: Render one subject to a transparent PNG at fixed sizes with the software renderer, and detect when a picture has gone stale.
---

A subject picture is one thing, alone on a transparent ground, rendered to a
PNG: a product shot, an icon, an inventory image. Two entry points cover it.

- `game-harness/subject-capture` renders the pictures. It needs
  `@playwright/test`.
- `game-harness/subject-pictures` (also re-exported from the package root)
  hashes what a picture was rendered from and checks committed pictures against
  it. It is peer-free, so a build's staleness check runs where no browser is
  installed.

`game-harness/visual-battery` does not do this. It runs a game's own Vitest
harnesses and compares the screenshots they write against committed baselines;
it never launches a browser, sizes a viewport or controls transparency. Use the
battery to catch rendering drift in a scene, and `subject-capture` to produce a
shipped picture.

## Capture

The game owns a page that draws exactly one subject on a transparent
background, chosen by its address:

```ts
import { captureSubject } from 'game-harness/subject-capture';
import { hashSubjectSourceFiles } from 'game-harness/subject-pictures';

const sourceSha256 = hashSubjectSourceFiles(['src/models/shovel.ts', 'src/models/palette.ts']);

const { pictures, renderer } = await captureSubject({
  subject: 'shovel',
  url: ({ width }) => `http://127.0.0.1:4173/lab.html?subject=shovel&size=${width}`,
  sizes: [256, 512],
  outDir: 'src/ui/assets/pictures',
  sourceSha256,
  ready: (page) => page.waitForFunction('window.labReady === true'),
});
```

Each size gets a fresh page with a viewport of exactly that size at device
scale 1. After `ready` resolves the harness waits `settleFrames` animation
frames (default 2), then screenshots with `omitBackground`, so the page and any
WebGL canvas must keep their background transparent (`alpha: true` on the
context). Pass `selector` to capture one element instead of the viewport; it
must be exactly the capture size.

Each returned picture is a `SubjectPictureRecord` (`subject`, `path`, `width`,
`height`, `sha256`, `sourceSha256`) plus its `bytes`. Commit the PNGs and store
the records wherever the project keeps its asset manifest.

### What it refuses

The capture fails closed instead of writing a picture that cannot be trusted:

- under the default `software` renderer profile, a WebGL renderer that is not
  SwiftShader;
- a picture whose size is not the requested size;
- a picture in which nothing drew (every pixel transparent);
- a picture with no transparent pixel at all, which means an opaque page or
  canvas background;
- invalid options: an unsafe subject name, a malformed source hash, empty,
  fractional, oversized or repeated sizes.

### Determinism

Draw the subject as a still frame: `animations: 'disabled'` stops CSS
animations only, so a page that keeps animating gives different bytes on each
run.

The launch goes through the shared silent profile (`createChromiumLaunchProfile`)
with `gpuMode: 'software'`, which is ANGLE's SwiftShader backend, headless by
default. Two fresh launches on one platform with one Chromium build give the
same bytes, and the package's own test pins that. Bytes are not claimed to match
across platforms or Chromium versions: run the capture on the one host (a render
host or a pinned CI image) that owns the committed pictures.

## Staleness

A picture is stale when its subject changed. `hashSubjectSources()` hashes
named byte sources independent of their order (each name and length is part of
the hash); `hashSubjectSourceFiles()` does the same for files, naming them by
POSIX path relative to `cwd`. Pin line endings with `.gitattributes` if sources
are checked out on Windows.

```ts
import { assertSubjectPicturesFresh } from 'game-harness/subject-pictures';

assertSubjectPicturesFresh(records, {
  rootDir: process.cwd(),
  sourceHashes: { shovel: hashSubjectSourceFiles(['src/models/shovel.ts']) },
  sizes: [256, 512],
});
```

`checkSubjectPictures()` returns the problems instead of throwing:

| Kind              | Meaning                                                  |
| ----------------- | -------------------------------------------------------- |
| `stale`           | The subject's source no longer matches the recorded hash |
| `missing-record`  | A subject, or one expected size of it, has no picture    |
| `missing-file`    | A recorded picture file does not exist                   |
| `modified`        | The file differs from the recorded bytes                 |
| `wrong-size`      | Not a PNG, or its dimensions differ from the record      |
| `unknown-subject` | A record names a subject that has no current source hash |

`assertSubjectPicturesFresh()` throws one `SubjectPictureError`, carrying every
problem in `error.problems`.
