# Changelog

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
