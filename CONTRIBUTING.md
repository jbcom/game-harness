# Contributing

Thanks for taking the time to contribute.

## Getting set up

```sh
mise install   # or: nvm use && corepack enable
pnpm install
pnpm verify   # formatting, lint, types, coverage, build, and package checks
```

The pnpm version comes from `package.json`'s `packageManager` field; the Node
version comes from `.nvmrc`. [mise](https://mise.jdx.dev) reads both
automatically. Without mise, use `corepack` rather than a globally installed
pnpm so your version matches CI. `engines.node` (`>=22`) is the floor CI
proves against on Linux; day-to-day development and every macOS/Windows CI
row use the version pinned in `.nvmrc`.

## Making a change

1. Branch off `main`.
2. Write the test first. A bug fix should come with a test that fails without it.
3. Run `pnpm verify`. A change is not ready while any part of that is red.
4. Commit with [Conventional Commits](https://www.conventionalcommits.org):
   `fix:`, `feat:`, `docs:`, `refactor:`, `test:`, `chore:`. Release-please uses
   these prefixes to build the changelog and choose the next version number.
5. Open a pull request describing what changed and why.

## What gets reviewed

- Does it do what it says, and is there a test proving it?
- Does it keep the public API honest? A breaking change needs a `!` or a
  `BREAKING CHANGE:` footer.
- Are the types right for consumers? CI runs `publint`,
  `@arethetypeswrong/cli`, and clean packed-consumer installs because broken
  types and exports otherwise surface only at integration time.

## Releases

Releases are automated. Merging a conventional commit to `main` opens a
release pull request; merging that publishes to npm with provenance. Do not
hand-edit versions or the changelog.
