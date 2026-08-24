# Directive: finish extraction-src / PR #1 — OSS release infrastructure

Origin: user request 2026-08-24. Branch `extraction-src`, PR #1 (→ main), CI green.
Full autonomy granted; agent makes all design/implementation-detail calls.

## Confirmed facts (do not re-derive)

- Doppler `gha`/`ci` holds `AGENTIC_NPM_TOKEN` (npm publish token) — release.yml
  currently references the wrong secret name `NPM_TOKEN`. Must fix.
- npm identity: `jbdevprimary` (already `npm whoami`-authenticated locally).
- `@jbdevprimary/game-harness` is unpublished on the public npm registry (404).
- `jbcom` org's user Pages site (`jbcom.github.io`) is bound to `jonbogaty.com`
  and is explicitly documented as no-build/static-only — never push generated
  docs output into that repo. Project Pages sites for sibling repos in the same
  account are served at `<domain>/<repo>/` automatically — enabling Pages on
  `jbcom/game-harness` itself is sufficient to reach `jonbogaty.com/game-harness/`.
  No DNS change, no `jbcom.github.io` repo change.
- No `.pre-commit-config.yaml`, no `dependabot.yml`, no branch protection on
  `main` (404), no AGENTS.md/llms.txt anywhere in this repo yet.
- `pnpm-workspace.yaml` exists but lists no packages.
- Existing docs: `docs/architecture.md`, `docs/assets/game-harness-hero.webp`
  (1800x600 webp) — migrate content into Astro, don't delete.

## Queue

- [x] fix: correct release.yml secret name NPM_TOKEN -> AGENTIC_NPM_TOKEN
- [x] refactor: split release.yml into release.yml (release-please only) + new
      cd.yml (npm publish on release:published, docs deploy on push to
      docs/** or workflow_dispatch)
- [x] ci: pin every workflow action (checkout, pnpm/action-setup,
      setup-node, googleapis/release-please-action, configure-pages,
      upload-pages-artifact, deploy-pages) to exact commit SHAs resolved via
      `gh api` — no training-data SHAs
- [x] ci: add dependabot.yml (npm root+docs, github-actions, weekly, grouped)
- [x] chore: add .pre-commit-config.yaml mirroring CI gates (prettier, oxlint)
- [x] chore: configure branch protection on main (required checks: verify,
      both portability jobs, CodeQL; require up-to-date branch; block
      force-push/deletion; no min-approval count since solo+bots merge).
      Also hardened repo-level Actions settings: sha_pinning_required=true,
      can_approve_pull_request_reviews=false (workflow tokens can't
      self-approve PRs — closes a fork-PR self-merge vector).
- [ ] chore: set pnpm-workspace.yaml packages to [".", "site"] — NOT "docs".
      docs/ stays exactly as-is (architecture.md + assets/), it's packed into
      the npm tarball today via package.json "files". A new site/ workspace
      package holds the Astro+Starlight project so the tarball is never
      polluted with Astro source/node_modules/build cache. site/ pulls
      docs/architecture.md in as content (single source of truth, no fork).
- [x] design: derive brand palette from hero image — sampled saturated,
      mid-lightness pixels (excludes shadow/highlight noise): warm amber
      hue~~30-34 (e.g. #d8a878) and cool teal hue~~192-200 (e.g. #84b4c0),
      the teal matching the existing README badge #0f766e. Built an 11-step
      Tailwind/Starlight accent scale anchored on that teal (950 #0b2627 ...
      50 #eff9fa). Astro 7.2.4, @astrojs/starlight 0.41.7,
      @astrojs/starlight-tailwind 5.0.0, tailwindcss 4.3.3 confirmed latest
      via npm view (not training data).
- [x] feat(docs): scaffold Astro + Starlight site under site/, pull in
      docs/architecture.md content, brand with hero-image-derived palette/fonts.
      Astro check + build verified 0 errors; visually verified in Chrome
      (teal accent, Inter/JetBrains Mono fonts, sidebar nav, hero image all
      render correctly in dark theme). site/'s own TypeScript devDependency
      pinned to 6.0.3 (not the root's 7.0.2) because `astro check` needs the
      classic compiler's programmatic API, which TS7's native/Go port does
      not expose yet — this is a real current ecosystem gap, not a
      workaround to revisit later.
- [x] ci: enable GitHub Pages (build type workflow) on jbcom/game-harness;
      wire cd.yml docs-deploy job (update cd.yml's `pnpm --filter docs build` + `path: docs/dist` to `--filter site build` / `site/dist`)
- [x] chore: tooling/versioning DRY pass per user mid-turn feedback
      (2026-08-24). Boundary: mise is LOCAL-ONLY (mise.toml, .nvmrc as the
      actual node-version source via idiomatic_version_file_enable_tools,
      pnpm = "latest"); CI uses the OFFICIAL pnpm/action-setup +
      actions/setup-node actions, reading node-version-file: .nvmrc and
      packageManager from package.json — no hardcoded version strings in
      workflows. Widened engines.node from >=24 to >=22 (earliest active
      Node LTS per nodejs.org/dist/index.json + release schedule checked
      2026-08-24: 20 EOL 2026-04-30, 22 Jod active to 2027-04-30, 24 Krypton
      active to 2028-04-30, 26 current). Added a Node-22-on-Linux row to
      ci.yml's portability matrix to actually prove the floor, not just
      declare it. Restored packageManager: pnpm@11.23.0 in package.json
      (this IS the idiomatic mechanism pnpm/action-setup reads — dropping it
      was wrong, corrected after user clarified mise is local-only).
      scripts/verify-package-boundaries.mjs's exact npm-version pin
      ('11.17.0') was already broken by the widened range (Node 22 bundles
      npm 10.9.8, not 11.x) — changed to a floor check (npmMajor >= 10).
      Updated the two contract-test assertions and every README/
      CONTRIBUTING/site-docs mention of the old exact pins to match.
- [ ] docs: author AGENTS.md and llms.txt at repo root after fully reading
      README.md + docs/architecture.md as a human developer would
- [ ] chore: verify npm-published README has no broken links/image refs
      (relative image paths must resolve from npm tarball context; link to
      docs site for anything that doesn't pack)
- [ ] release: publish first version manually under jbdevprimary via
      `doppler run --project gha --config ci -- npm publish --access public`
- [ ] chore: use Claude in Chrome to configure npm trusted publishing (OIDC)
      for jbcom/game-harness cd.yml workflow once manual publish succeeds
- [ ] chore: simplify cd.yml publish job once OIDC trusted publishing verified
- [ ] verify: pnpm verify green, CI green on extraction-src, review threads
      resolved, PR #1 squash-merged, Pages site live-checked in browser
