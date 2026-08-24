---
title: Lighthouse presets & release ladder
description: Immutable Lighthouse CI assertions and a thin ordered-step release orchestrator.
---

## Lighthouse CI presets

```ts
// lighthouserc.mjs
import { lighthouseAssertions } from '@jbdevprimary/game-harness/lighthouse';

export default lighthouseAssertions('game-default', {
  url: ['http://localhost/index.html', 'http://localhost/settings/index.html'],
  assertions: { 'categories:performance': ['warn', { minScore: 0.5 }] },
});
```

`lighthouseAssertions()` returns a `lighthouserc.json`-shaped config object
for a named preset, with `overrides` merged on top (assertion overrides are
merged key-by-key on top of the preset's own; every other override field
replaces it wholesale). The only shipped preset, `'game-default'`, is a
production `lighthouserc.json` verbatim: performance/accessibility/best-practices
assertions at warn level (a score dip surfaces in CI logs without
hard-blocking a merge on Lighthouse's inherent run-to-run variance), with SEO
and PWA assertions off since these are single-page game shells with no SEO
surface and no installable-PWA requirement. To keep `lighthouserc.json` as
static JSON instead of a `.mjs` config, run this once locally and paste the
printed object — the factory has no runtime dependency on the consumer's
environment beyond the `overrides` you pass.

## Release ladder orchestrator

```ts
import { verifyReleaseLadder } from '@jbdevprimary/game-harness/release-ladder';
import { execSync } from 'node:child_process';

const result = await verifyReleaseLadder([
  { name: 'lint', run: () => execSync('pnpm lint', { stdio: 'inherit' }) },
  {
    name: 'typecheck',
    run: () => execSync('pnpm typecheck', { stdio: 'inherit' }),
  },
  { name: 'test', run: () => execSync('pnpm test', { stdio: 'inherit' }) },
  { name: 'build', run: () => execSync('pnpm build', { stdio: 'inherit' }) },
]);

process.exit(result.ok ? 0 : 1);
```

`verifyReleaseLadder()` is a thin orchestrator for a `verify:*` release
ladder — an ordered list of named steps, each a plain sync or async function,
run in sequence and stopped at the first failure with a labeled summary. It
generalizes the pattern of many discrete `node scripts/verify-X.mjs` files
composed via a shell `&&` chain into one reusable primitive: a step can
inline its logic or delegate to an existing script via `execSync`. It never
throws — it returns a `ReleaseLadderResult` (`{ ok, ranSteps, failedStep?,
error? }`) so the caller decides how to report or exit;
`process.exit(result.ok ? 0 : 1)` is the CLI convention. Pass `{ log, error
}` to redirect the default `console.log`/`console.error` output (both
prefixed with `[verify]`).
