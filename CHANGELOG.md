# Changelog

All notable changes are recorded here. Releases follow
[Semantic Versioning](https://semver.org/) and are generated from Conventional
Commits by release-please.

## [1.0.0](https://github.com/jbcom/game-harness/compare/game-harness-v0.5.0...game-harness-v1.0.0) (2026-08-24)


### ⚠ BREAKING CHANGES

* publish unscoped game-harness package

### Features

* publish unscoped game-harness package ([db71974](https://github.com/jbcom/game-harness/commit/db71974fb5082ae6fb8870016f004338d85a3bc9))


### Bug Fixes

* use bound SonarQube Cloud analysis ([914a271](https://github.com/jbcom/game-harness/commit/914a271d70b95df816fca3f8366a8670a39a6f7d))

## [0.5.0](https://github.com/jbcom/game-harness/compare/game-harness-v0.4.3...game-harness-v0.5.0) (2026-08-24)


### Features

* complete production-ready OSS release ([90ed8e9](https://github.com/jbcom/game-harness/commit/90ed8e9939c6a176c686a068ab03fe3378d7fee8))
* **docs:** migrate site to Sourcey ([06d8beb](https://github.com/jbcom/game-harness/commit/06d8beb87581c1bed77c0ad8e25c31c10f6faae8))
* **docs:** scaffold Astro + Starlight documentation site ([76eb557](https://github.com/jbcom/game-harness/commit/76eb557aaf0ebc548a8c7a4a21f4eb9eef769910))
* harden release proof and production runtime verification ([#9](https://github.com/jbcom/game-harness/issues/9)) ([b0b8659](https://github.com/jbcom/game-harness/commit/b0b8659cb78c0faeaf3ceb6f72a770fd43894fe3))
* **persistence:** align Capacitor 8.5 and release contracts ([#41](https://github.com/jbcom/game-harness/issues/41)) ([f49f6bf](https://github.com/jbcom/game-harness/commit/f49f6bf1b2ec340a980d5f791de19827afa14598))
* publish game-harness as a production-ready OSS package ([02e50b1](https://github.com/jbcom/game-harness/commit/02e50b1567700e7873c627977233fd4ed76eb6bd))
* **test-harness:** extract vitest-browser+playwright+visual-battery harness to @arcade-cabinet/test-harness ([#1](https://github.com/jbcom/game-harness/issues/1)) ([1609226](https://github.com/jbcom/game-harness/commit/1609226b0f6e464abf0ca2e6cea51bf7e18dcac2))
* **test-harness:** isolate concurrent Playwright ports ([5703743](https://github.com/jbcom/game-harness/commit/57037437427c03247142e1c81ee5c09fe87733d8))
* **test-harness:** share silent QA runtime adapter ([#15](https://github.com/jbcom/game-harness/issues/15)) ([78f1b23](https://github.com/jbcom/game-harness/commit/78f1b233ea705b58ca1f2b9f309eb9810d791dab))
* **test-harness:** standardize headed hardware WebGL proof ([#12](https://github.com/jbcom/game-harness/issues/12)) ([ebd1eca](https://github.com/jbcom/game-harness/commit/ebd1ecaac9e606d63d7a4f4cfdb2315390fedc6a))


### Bug Fixes

* address CodeRabbit review findings on PR [#1](https://github.com/jbcom/game-harness/issues/1) ([a82790c](https://github.com/jbcom/game-harness/commit/a82790c80ef5034987ff9c2edd1c48520c6dc404))
* **ci:** keep browser evidence deterministic ([6e2f889](https://github.com/jbcom/game-harness/commit/6e2f889f6dde4e3e20c94a74b4c920ac941e1c27))
* harden portable harness execution ([0d84800](https://github.com/jbcom/game-harness/commit/0d848001e0ba4c82ab1ef9af5c7db4c3a9b3ee47))
* harden visual and base-path validation ([682061f](https://github.com/jbcom/game-harness/commit/682061fa331c3c72ffcefa70208d845636c56ba5))
* make release checks portable ([4d3a4c7](https://github.com/jbcom/game-harness/commit/4d3a4c7f6fb2bdf6613c093fbc517ea009941a60))
* remove leading ./ from bin paths, npm publish silently strips it ([162d687](https://github.com/jbcom/game-harness/commit/162d687b97a42663026c3d5e79e25dc18e4bba37))
* require named repository policy gates ([ba23f17](https://github.com/jbcom/game-harness/commit/ba23f17595fb6f402342dbc77452043f85e96dd4))
* require named repository policy gates ([23922f8](https://github.com/jbcom/game-harness/commit/23922f8d1f2517d15103a423cdee3b2627759a7d))
* resolve release review findings ([c76b4ec](https://github.com/jbcom/game-harness/commit/c76b4ec64b211d0cf69ba5939b3dfa8c1c48b959))
* split release.yml into release-please + cd workflows, fix npm token secret ([83ca25d](https://github.com/jbcom/game-harness/commit/83ca25d91d62eb085e06340030a8dfe30fc735db))
* **test-harness:** gate deterministic canvas baselines ([8cd458a](https://github.com/jbcom/game-harness/commit/8cd458adf583733da7a04a29f08d05772f73015c))
* **test-harness:** harden 0.4.3 release proof ([#49](https://github.com/jbcom/game-harness/issues/49)) ([4fae4c6](https://github.com/jbcom/game-harness/commit/4fae4c653c85bb7161ee60e2d15a74d72b5c04a7))
* **test-harness:** isolate WebGL visual baselines ([48d02bb](https://github.com/jbcom/game-harness/commit/48d02bb87cef8e09bf1f3a074ee5cae5ff2a2ed3))
* **test-harness:** keep cleanup guard outside finally ([29d23e8](https://github.com/jbcom/game-harness/commit/29d23e8e2c298f563cbcb85f350288a8b1fc80cb))
* **test-harness:** make framework peers entrypoint-optional ([#4](https://github.com/jbcom/game-harness/issues/4)) ([cfc726a](https://github.com/jbcom/game-harness/commit/cfc726a0dc8e33d263f40c46e128e6f11ee90ed0))
* **test-harness:** ship a workspace-safe visual battery CLI ([71b90f3](https://github.com/jbcom/game-harness/commit/71b90f30f51f9915fbd2e4a57faad915177e5f1d))
* the release verifier was genuinely broken, plus package.json metadata ([6dc40ef](https://github.com/jbcom/game-harness/commit/6dc40effb60dbbcb48f300fee2079040789fe22c))
* validate Sourcey output and visual cwd ([2ddbcd9](https://github.com/jbcom/game-harness/commit/2ddbcd9edd77f142580cbe8cda58a66bb2ffd97c))

## 0.4.3 - 2026-08-24

### Added

- Initial standalone public package extracted from the production browser-game
  verification harness.
- Peer-isolated Playwright and Vitest Browser Mode configuration entry points.
- Fail-closed silent-QA, production-runtime, visual-regression, Lighthouse, and
  release-ladder primitives.
