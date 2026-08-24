# AGENTS.md

This file has two audiences: an agent **consuming** `game-harness`
as a dependency in a game repository, and an agent **contributing** to this
repository itself. Read the section that matches your task.

## Consuming this package

Game Harness is release-grade browser QA primitives for TypeScript games —
silent Playwright/Vitest sessions, deterministic screenshots, production-runtime
proof, and Lighthouse gates. It is a focused library, not a test framework:
the game keeps its own journeys, assertions, art direction, and audio engine.

Full guides live at [jonbogaty.com/game-harness](https://jonbogaty.com/game-harness/);
[llms.txt](llms.txt) indexes every page. The rules below are the ones an
agent gets wrong most often.

### Install only what you use

The package root is peer-free and never loads Playwright or Vitest. Install
only the peer family for the entry point you import:

```sh
# Playwright config and production-runtime verification
pnpm add -D game-harness @playwright/test
pnpm exec playwright install chromium

# Vitest Browser Mode instead
pnpm add -D game-harness vitest @vitest/browser-playwright playwright
pnpm exec playwright install chromium

# Peer-free Lighthouse, release-ladder, or visual-battery utilities only
pnpm add -D game-harness
```

Node 22 or newer is required.

### Entry points

Import only the subpath a task needs — never import a framework subpath from
code that must stay peer-free.

| Entry point           | Use for                                                      | Requires                               |
| --------------------- | ------------------------------------------------------------ | -------------------------------------- |
| `game-harness` (root) | Lighthouse presets, release ladder, visual battery           | nothing                                |
| `/chromium`           | Renderer + mandatory `--mute-audio` launch profile           | nothing                                |
| `/silent-qa`          | Application-side runtime mute adapter and readiness marker   | nothing                                |
| `/playwright`         | Device tiers, isolated ports, strict-port preview server     | `@playwright/test`                     |
| `/production-runtime` | Fresh server/browser lifecycle, fail-closed runtime evidence | `@playwright/test`                     |
| `/vitest`             | Vitest Browser Mode config fragment                          | `vitest`, `@vitest/browser-playwright` |

Full detail: [Entry points](https://jonbogaty.com/game-harness/entry-points/).

### The silence contract is not optional

Every browser this package launches gets `--mute-audio` appended last,
regardless of caller-supplied args. That is defense in depth, not the whole
contract — the application must also call `activateSilentQa()` (or
`activateSilentQaAsync()` if muting is async) before the audio engine
initializes, so it can publish `<html data-audio-mode="muted-test">`.
`openSilentGame()` will not resolve until that marker exists. Do not add an
"audible debug mode" escape hatch; verify audio state through mocks,
analyser assertions, or programmatic engine state instead. See
[Chromium launch profile & Silent QA](https://jonbogaty.com/game-harness/guides/chromium-and-silent-qa/).

### Never hard-code a preview/dev-server port

Use `definePlaywrightConfig({ port, webServerCommand })` (or
`findAvailableProductionPort()` for `production-runtime`) instead of a
literal port in `playwright.config.ts` or a server command. On CI the
factory derives a deterministic port from repository/run/job identity so
concurrent workflows can't collide; a hard-coded port bypasses that
isolation and is not valid release evidence. See
[Playwright](https://jonbogaty.com/game-harness/guides/playwright/) and
[Production runtime verification](https://jonbogaty.com/game-harness/guides/production-runtime/).

### Screenshot baselines have one canonical location

`runVisualBattery()` requires `__screenshots__/` directly under the harness
directory a test file lives in (Vitest resolves screenshot paths relative to
the test file). A second `__screenshots__` directory anywhere else in the
harness tree is rejected — it would let a screenshot escape the Git diff
gate. See [Visual battery](https://jonbogaty.com/game-harness/guides/visual-battery/).

### Before claiming a change works

Run the same gate CI runs: `pnpm verify` (formatting, lint, types, coverage,
build, `publint`/`@arethetypeswrong/cli`, and clean packed-consumer smoke
tests) in the _consuming_ repo, not just `pnpm test`. A green `pnpm test`
with a broken export or a headless-mode regression is not release evidence.

## Contributing to this repository

This is a pnpm workspace: the library at the repo root
(`game-harness`) and its private Sourcey documentation workspace
under `docs/` (`game-harness-docs`, never published). Sourcey is the only
documentation renderer. Its Markdown source and `sourcey.config.ts` live in
that directory; `docs/dist/` is generated and ignored.

### Setup

```sh
mise install   # or: nvm use && corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

`mise.toml` is local-only. CI reads the Node version from `.nvmrc` and the
pnpm version from `package.json`'s `packageManager` field via the official
`actions/setup-node` and `pnpm/action-setup` actions — never edit a
hardcoded version string into a workflow file.

### Commands

- `pnpm verify` — the full gate: format check, Oxlint, strict typecheck,
  100%-coverage test run, ESM+CJS+types build, `publint`/attw, and
  clean-tarball consumer smoke tests. This is what CI runs; run it before
  every commit.
- `pnpm test` — unit and contract tests only, for fast iteration.
- `pnpm --filter game-harness-docs validate` / `pnpm --filter
game-harness-docs dev` — build or preview the Sourcey docs site in isolation.
- `pnpm format` — apply Prettier.

### Conventions

- Conventional Commits (`fix:`, `feat:`, `docs:`, `refactor:`, `test:`,
  `chore:`). release-please derives the changelog and next version from
  these — never hand-edit `CHANGELOG.md` or the version field.
- `docs/architecture.md` is packed into the npm tarball (see `package.json`
  `files`) and is also the Sourcey architecture page. Do not create a parallel
  documentation renderer or a second architecture copy.
- Every GitHub Actions step is pinned to an exact commit SHA (resolved via
  `gh api repos/<owner>/<repo>/releases/latest`, never guessed from
  training data), with a `# vX.Y.Z` comment. The repository also requires
  SHA pinning (`sha_pinning_required: true`) at the Actions-settings level.
- Branch protection on `main` requires the named `dependency-review` and
  `repository-policy` checks, automated quality checks, and resolved review
  threads, but no human approval. Merge commits preserve the topic branch
  history; squash, rebase, direct default-branch pushes, and force pushes are
  not part of the trusted-agent path.
