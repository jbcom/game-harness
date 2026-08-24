---
title: Troubleshooting
description: Common failure modes and their causes.
---

- **A headed browser cannot start on Linux CI:** install Chromium
  dependencies and run the browser command with `xvfb-run --auto-servernum`;
  do not silently switch release evidence to headless mode.
- **`PLAYWRIGHT_PORT` or `PW_PORT` is rejected:** overrides must be integer
  TCP ports from 1 through 65535. Invalid explicit values fail instead of
  falling back to another port.
- **The visual battery reports zero PNGs:** each harness must write into its
  canonical `__screenshots__` directory. An existing but empty directory is
  not release evidence.
- **`test:package` reports an npm version too old:** the package-boundary test
  requires npm 10 or newer (bundled with every Node version in the supported
  `>=22` range); use the Node version from `.nvmrc` or any newer supported
  LTS.
- **A local Chrome channel is unavailable:** leave `PW_CHROMIUM_CHANNEL`
  unset on CI to use Playwright's bundled Chromium, or set it explicitly to
  an installed supported channel for a local branded-browser run.

## Releases and support

Conventional commits on `main` are collected into a release pull request by
release-please. Merging that pull request creates the GitHub release and
publishes the exact tag to npm with provenance after `pnpm verify` passes.
Changes are recorded in the [CHANGELOG](https://github.com/jbcom/game-harness/blob/main/CHANGELOG.md).

Report defects and feature requests through the
[repository issue forms](https://github.com/jbcom/game-harness/issues).
Report vulnerabilities privately as described in
[SECURITY.md](https://github.com/jbcom/game-harness/blob/main/SECURITY.md).
