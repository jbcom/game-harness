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
- [ ] chore: configure branch protection on main (required checks: verify,
      both portability jobs, CodeQL; require up-to-date branch; block
      force-push/deletion; no min-approval count since solo+bots merge)
- [ ] chore: set pnpm-workspace.yaml packages to [".", "docs"]
- [ ] feat(docs): scaffold Astro + Starlight site under docs/, migrate
      architecture.md content, brand with hero-image-derived palette/fonts
- [ ] ci: enable GitHub Pages (build type workflow) on jbcom/game-harness;
      wire cd.yml docs-deploy job
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
