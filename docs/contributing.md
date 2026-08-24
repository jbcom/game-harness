---
title: Contributing
description: Development, validation, and pull-request expectations.
---

Game Harness uses pnpm and Node from `.nvmrc` (Node 22 or newer).

```sh
mise install # or: nvm use && corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

Write a focused test, implement the change, and run `pnpm verify` before
opening a pull request. Use a Conventional Commit (`fix:`, `feat:`, `docs:`,
`refactor:`, `test:`, or `chore:`); release-please owns release versions and
the changelog.

Open a same-upstream branch and PR. Do not push directly to `main`, rebase a
shared branch, or squash a completed PR: the repository preserves merge-commit
history. See the repository's [full contribution guide](https://github.com/jbcom/game-harness/blob/main/CONTRIBUTING.md).
