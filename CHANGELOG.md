# Changelog

## [1.5.0](https://github.com/kolatts/pncli/compare/v1.4.0...v1.5.0) (2026-04-11)


### Features

* add permissions configuration for Bash commands in settings ([d8ddd7f](https://github.com/kolatts/pncli/commit/d8ddd7f29e9c6658c6ccd02e1cf26eb0e9b4a3cb))
* add pncli config check command ([#24](https://github.com/kolatts/pncli/issues/24)) ([ab18549](https://github.com/kolatts/pncli/commit/ab1854903e790021edfb78d6880bd2157b726ba5))
* bootstrap Astro site and GitHub Pages deploy workflow (Phase 1) ([#19](https://github.com/kolatts/pncli/issues/19)) ([85ee755](https://github.com/kolatts/pncli/commit/85ee75512f740fe469a5999c663de672db6c2993))
* Claude Code skills, ADO diff/build-status, and site Skills section ([#25](https://github.com/kolatts/pncli/issues/25)) ([a284f93](https://github.com/kolatts/pncli/commit/a284f932579fce505548a4478208f55c28342c37))
* pncli GitHub Pages site (Phases 1–5) ([#20](https://github.com/kolatts/pncli/issues/20)) ([bac6e89](https://github.com/kolatts/pncli/commit/bac6e89642db0f27bdd47753f421514dd875af8a))


### Bug Fixes

* downgrade to .NET 9 — .NET 10 runtime unstable on Linux Consumption ([7f65292](https://github.com/kolatts/pncli/commit/7f652921641a05d2c13af92d2c602e197bbae766))
* drop AspNetCore integration — function uses standard isolated HTTP types ([0fdcae3](https://github.com/kolatts/pncli/commit/0fdcae3740d7f383846d07e28774e7f2f540f7a1))
* redirect provision.sh progress output to stderr ([c8a5407](https://github.com/kolatts/pncli/commit/c8a5407703f38571160682c4532abf47b46bf6b7))
* remove ApplicationInsights package — PerfCounterCollector aborts on Linux ([313cd89](https://github.com/kolatts/pncli/commit/313cd890d98aaee7851f0ff4e630a022a30b0bc5))
* **site:** move paperwork monster to hero section, fix DC copy and Artifactory status ([#23](https://github.com/kolatts/pncli/issues/23)) ([f3219be](https://github.com/kolatts/pncli/commit/f3219be556f81c8b35feab4a39c211a3087ffbb7))
* update Azure Functions packages for .NET 10 compatibility ([4bef710](https://github.com/kolatts/pncli/commit/4bef7106f96bc2f5656513d1e9020ec6ec5c72a9))

## [1.4.0](https://github.com/kolatts/pncli/compare/v1.3.0...v1.4.0) (2026-04-11)


### Features

* Azure DevOps Server integration (work items, repos, PRs, pipelines) ([#15](https://github.com/kolatts/pncli/issues/15)) ([a4fc281](https://github.com/kolatts/pncli/commit/a4fc28113361d06c18e633f5b418226989febe96))
* consolidate SDElements auth into single connection string ([663d9b2](https://github.com/kolatts/pncli/commit/663d9b22add61cf4c14d1d0f882d2f6ae003de07))


### Bug Fixes

* normalize SDElements host to full base URL in connection string parser ([38c38f4](https://github.com/kolatts/pncli/commit/38c38f4544884e6d1b5110aaa3c26294bd583e31))
* suppress git stderr in getRepoRoot to avoid fatal error outside repos ([94bca2f](https://github.com/kolatts/pncli/commit/94bca2faf2b33e75672ee3111801f508bfb8320e))

## [1.3.0](https://github.com/kolatts/pncli/compare/v1.2.0...v1.3.0) (2026-04-06)


### Features

* Confluence integration + fail() exit fix + TLS bypass ([#10](https://github.com/kolatts/pncli/issues/10)) ([95a2084](https://github.com/kolatts/pncli/commit/95a20840c07661dcf1ef875cddd48e76aab3344f))
* SDElements integration — projects, tasks, threats, users ([#13](https://github.com/kolatts/pncli/issues/13)) ([7608ebe](https://github.com/kolatts/pncli/commit/7608ebe91afc6f16817e83d6df1401df70c1b934))
* SonarQube Server integration with PAT auth ([#12](https://github.com/kolatts/pncli/issues/12)) ([1428bea](https://github.com/kolatts/pncli/commit/1428bea266d9c68f5b2d0270ca86c4caec48a809))

## [1.2.0](https://github.com/kolatts/pncli/compare/v1.1.0...v1.2.0) (2026-04-05)


### Features

* dep watchdog — pncli deps command group ([#7](https://github.com/kolatts/pncli/issues/7)) ([d5aeb5f](https://github.com/kolatts/pncli/commit/d5aeb5f133193d1ba3fa9e01c8d0b80a4bbe9531))


### Bug Fixes

* Jira error deserialization, Connection header, and exit codes ([#8](https://github.com/kolatts/pncli/issues/8)) ([00e78ad](https://github.com/kolatts/pncli/commit/00e78ad22390ac598bf6ee59d3b5907cce4f84ce))

## [1.1.0](https://github.com/kolatts/pncli/compare/v1.0.1...v1.1.0) (2026-04-05)


### Features

* add PNCLI_EMAIL and PNCLI_USERID as global user identity ([81f0091](https://github.com/kolatts/pncli/commit/81f00913a3ca4295631ad5e3701dac6a1553e70a))
* add user identity prompts to config init wizard ([e200a5a](https://github.com/kolatts/pncli/commit/e200a5a7defd54ba4a39a49518dd6342533c23dc))
* enterprise testing — user identity, Jira v2, husky, v1.1.0 ([8fb3b2e](https://github.com/kolatts/pncli/commit/8fb3b2e086fe1cd4e6ca31e1b8592dfecefdfbd7))
* Jira custom fields + auto-generated copilot docs ([#6](https://github.com/kolatts/pncli/issues/6)) ([a88c01b](https://github.com/kolatts/pncli/commit/a88c01bd681679e738407690d284ac640893fe0d))
* switch Jira to API v2 with Bearer token auth ([6372db9](https://github.com/kolatts/pncli/commit/6372db9bba3c4213f466cdf021caed4dc11e510f))

## [1.0.1](https://github.com/kolatts/pncli/compare/v1.0.0...v1.0.1) (2026-04-04)


### Bug Fixes

* rename package to @kolatts/pncli and add --access=public for npm publish ([6082ae6](https://github.com/kolatts/pncli/commit/6082ae6cd8b5f10413a517cf3c0ced68de21e8dc))

## 1.0.0 (2026-04-04)


### Features

* add HTTP client and Bitbucket Server integration 🔌 ([921acfa](https://github.com/kolatts/pncli/commit/921acfaaea580a94a957d9cc3aaa687ee86cb790))
* add Jira Data Cloud integration 🎫 ([7334fd2](https://github.com/kolatts/pncli/commit/7334fd2623c46b0f57bb369fd1456e489b6b777b))
* scaffold Phase 1 — skeleton, config system, git commands 🏗️ ([3d72b21](https://github.com/kolatts/pncli/commit/3d72b21c1231321f7188aeff16bfd8e23f607bdd))


### Bug Fixes

* remove invalid package-name input from release-please-action@v4 ([ec144d9](https://github.com/kolatts/pncli/commit/ec144d9972508a03773acd3817b3f4c7c3141072))

## Changelog

All notable changes to pncli will be documented in this file.

See [Conventional Commits](https://www.conventionalcommits.org/) for commit guidelines.
This file is auto-managed by [release-please](https://github.com/googleapis/release-please).
