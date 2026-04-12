# Changelog

## [1.6.1](https://github.com/kolatts/pncli/compare/v1.6.0...v1.6.1) (2026-04-12)


### Bug Fixes

* add repository field to package.json for npm provenance verification ([8fa894d](https://github.com/kolatts/pncli/commit/8fa894d1b77e4805092c9bb0a55663354dc786d0))

## [1.6.0](https://github.com/kolatts/pncli/compare/v1.5.0...v1.6.0) (2026-04-12)


### Features

* add --output flag to config check command ([#41](https://github.com/kolatts/pncli/issues/41)) ([8483edd](https://github.com/kolatts/pncli/commit/8483edd597ad70d21d1f1db012026d86d10434fc)), closes [#40](https://github.com/kolatts/pncli/issues/40)
* add --repo flag to pncli config set for non-interactive repo config ([b3fa4c7](https://github.com/kolatts/pncli/commit/b3fa4c74eafd24ce259f375a9248ebed2c0a8007))
* add 5 multi-tool workflow skills for vulnerability scanning and ticket creation ([58d7b78](https://github.com/kolatts/pncli/commit/58d7b781adf4429d911bf3bae7172befe02cf180))
* add CLAUDE.md with project conventions and site screenshot requirement ([2747172](https://github.com/kolatts/pncli/commit/2747172742474a51a8cb4fe5e5e6a6216f9b9fe4))
* add denied label and close issue when triage rejects scope ([ecf31b1](https://github.com/kolatts/pncli/commit/ecf31b16de08a7f36bdd952b1e4837c6ae3c9289))
* add service pills, category grouping, skills install CLI, and provider prompting ([53293de](https://github.com/kolatts/pncli/commit/53293def8acf7502a740bc07effca88d123be873))
* Claude issue triage and review response workflows ([#34](https://github.com/kolatts/pncli/issues/34)) ([0204ce0](https://github.com/kolatts/pncli/commit/0204ce0e18402d0240ec1073d5cc8c8f8e87a003))
* surgical skills install, copilot-instructions download, and local-setup skill ([6daeb71](https://github.com/kolatts/pncli/commit/6daeb713cc53e55622a43a8968bbe07bc9b90740))
* trigger triage on from-website label in addition to claude-triage ([fb65214](https://github.com/kolatts/pncli/commit/fb652146270b9b87da2882759a9eb3fd9040eb05))
* Turnstile CAPTCHA, persistent rate limiting, and Azure Queue for feedback ([#45](https://github.com/kolatts/pncli/issues/45)) ([e067fd5](https://github.com/kolatts/pncli/commit/e067fd503ec63c4f3ea7033b906c803bb118d1ae))
* vulnerability scanning skills, service pills, skills install CLI, and local-setup ([77b0744](https://github.com/kolatts/pncli/commit/77b074470f4d0b4100d6ac3ed77614feb77432c4))


### Bug Fixes

* add job summary, label creation, and label cleanup improvements ([#38](https://github.com/kolatts/pncli/issues/38)) ([1d61e7a](https://github.com/kolatts/pncli/commit/1d61e7a8e93a02f72f99711ced65bbf07429ed06))
* address PR review — path traversal guard, gallery fallback, ADO linking ([d994091](https://github.com/kolatts/pncli/commit/d9940917aeaab3058d0174559d6e5fadb812782b))
* allow claude bot PRs through review, skip other bots ([b4d4ac7](https://github.com/kolatts/pncli/commit/b4d4ac736f32b966de8c9096cfae96f77911dd86))
* allow claude bot to trigger review action via allowed_bots ([05ce1e3](https://github.com/kolatts/pncli/commit/05ce1e3a8c7d13df9065f3b6fdf4aba461ec5b3e))
* append .git suffix to claude-marketplace URL ([#28](https://github.com/kolatts/pncli/issues/28)) ([992fd31](https://github.com/kolatts/pncli/commit/992fd31cd3207bbd836b89f7692268b5fd1bfaa5))
* mandate gh pr create in triage and improve comment link format ([f143aeb](https://github.com/kolatts/pncli/commit/f143aebe1bce32f6ddf36da9dbb8089b11e5abc4))
* scope triage concurrency group to label name to prevent cancellation ([ffba8a8](https://github.com/kolatts/pncli/commit/ffba8a871a4c33f95cb153d2e8cf8330305078d6))
* validate project fit from CLAUDE.md before any code changes in triage ([ec48034](https://github.com/kolatts/pncli/commit/ec4803456006710e9d1601ca02a532e62a94bbf1))

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
