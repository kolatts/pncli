# Changelog

## [1.14.1](https://github.com/kolatts/pncli/compare/v1.14.0...v1.14.1) (2026-06-14)


### Bug Fixes

* **ado:** always send application/octet-stream for work item attachments ([#210](https://github.com/kolatts/pncli/issues/210)) ([51d668c](https://github.com/kolatts/pncli/commit/51d668c581101da3fde4d691c813dcbdb4efb6c1)), closes [#209](https://github.com/kolatts/pncli/issues/209)

## [1.14.0](https://github.com/kolatts/pncli/compare/v1.13.0...v1.14.0) (2026-06-13)


### Features

* **ado:** add work item attachment upload ([#205](https://github.com/kolatts/pncli/issues/205)) ([701acf9](https://github.com/kolatts/pncli/commit/701acf9a5e99c53d3e7e5cfaca0eb9f880df32a6))
* **jwt:** add jwt decode command ([#203](https://github.com/kolatts/pncli/issues/203)) ([8f0bc50](https://github.com/kolatts/pncli/commit/8f0bc50f81b048c3f120a632478845f84491c350))
* **openshift:** OpenShift/Kubernetes service integration and health-checker skill ([#207](https://github.com/kolatts/pncli/issues/207)) ([64303f3](https://github.com/kolatts/pncli/commit/64303f32a6497fa9261bebfe996a36e96214640d))

## [1.13.0](https://github.com/kolatts/pncli/compare/v1.12.0...v1.13.0) (2026-05-30)


### Features

* **ado,jira:** add attachment list and download commands ([#199](https://github.com/kolatts/pncli/issues/199)) ([85c6055](https://github.com/kolatts/pncli/commit/85c605503e250b18ee0bd73a366bd99a409b6695))
* **jira,ado:** add label and tag management commands ([#196](https://github.com/kolatts/pncli/issues/196)) ([6884ed5](https://github.com/kolatts/pncli/commit/6884ed514634d868b5d8603a2d93d6cf965456e3))
* **jira:** add add-attachment command ([#192](https://github.com/kolatts/pncli/issues/192)) ([ca10258](https://github.com/kolatts/pncli/commit/ca10258b14d435af37f01be7c1be271d126846a7))
* **skills:** print per-skill copy paths during marketplace sync ([#194](https://github.com/kolatts/pncli/issues/194)) ([256f94c](https://github.com/kolatts/pncli/commit/256f94c1e132a2b50ac0bddd99fb186eb9d0de24)), closes [#193](https://github.com/kolatts/pncli/issues/193)


### Bug Fixes

* **confluence:** make --limit cap total results in list-spaces and list-pages ([#190](https://github.com/kolatts/pncli/issues/190)) ([8524679](https://github.com/kolatts/pncli/commit/8524679cbbb524745ad4742fb17ed4a7e865a42b)), closes [#189](https://github.com/kolatts/pncli/issues/189)
* **git:** filter report commits by author date and route CSV through --output-file ([#188](https://github.com/kolatts/pncli/issues/188)) ([817ce47](https://github.com/kolatts/pncli/commit/817ce47112c03fdc2c464f32255628a3423ad5b9)), closes [#187](https://github.com/kolatts/pncli/issues/187)

## [1.12.0](https://github.com/kolatts/pncli/compare/v1.11.1...v1.12.0) (2026-05-23)


### Features

* **jenkins:** add --folder flag to pipeline list for folder-scoped job enumeration ([#171](https://github.com/kolatts/pncli/issues/171)) ([0107ae6](https://github.com/kolatts/pncli/commit/0107ae698e858092dc955b92e655c318a917d5bc))
* **jira:** support [@file](https://github.com/file) syntax and --fields-file for large custom field payloads ([#180](https://github.com/kolatts/pncli/issues/180)) ([a2512ca](https://github.com/kolatts/pncli/commit/a2512ca96d4644f3448c61cd445faf0ae5d33ced)), closes [#179](https://github.com/kolatts/pncli/issues/179)
* **skills:** add --force flag and all-plugins sync to marketplace sync ([#184](https://github.com/kolatts/pncli/issues/184)) ([2087f7a](https://github.com/kolatts/pncli/commit/2087f7aecce2cbc28f7d75c3c803ba2cd491f6cc)), closes [#183](https://github.com/kolatts/pncli/issues/183)
* **skills:** skip marketplace sync prompt when no git changes ([#165](https://github.com/kolatts/pncli/issues/165)) ([e895df6](https://github.com/kolatts/pncli/commit/e895df650494674af8b5188dc82eb54f44a0b516))


### Bug Fixes

* **ado:** decode URL components in parseAdoRemote to prevent double-encoding ([#167](https://github.com/kolatts/pncli/issues/167)) ([0556b1c](https://github.com/kolatts/pncli/commit/0556b1c963e3529c4fce588021fd766d7928d764)), closes [#166](https://github.com/kolatts/pncli/issues/166)
* **ado:** honour caller Content-Type in ADO fetcher ([#158](https://github.com/kolatts/pncli/issues/158)) ([ee4a1d4](https://github.com/kolatts/pncli/commit/ee4a1d45a9b8d0b410703aedb0c965d26593dc67)), closes [#157](https://github.com/kolatts/pncli/issues/157)
* **ado:** pipeline list-runs --definition filter and add --name support ([#173](https://github.com/kolatts/pncli/issues/173)) ([eb45153](https://github.com/kolatts/pncli/commit/eb45153d4672b17b6c340f6cd69b19f31079723d))
* **artifactory,ado:** builds timeout, list-runs top limit, pipeline logs --build-id alias ([#182](https://github.com/kolatts/pncli/issues/182)) ([acf8c97](https://github.com/kolatts/pncli/commit/acf8c978ceb30d777dd099cc80bf9dc493c307c5))
* **artifactory:** parse build names from URIs and hint on empty builds list ([#172](https://github.com/kolatts/pncli/issues/172)) ([cca720a](https://github.com/kolatts/pncli/commit/cca720a9cdb3368f891720dd38291f3606d3d106)), closes [#170](https://github.com/kolatts/pncli/issues/170)
* **bitbucket:** add --project/--repo flags to create-pr subcommand ([#175](https://github.com/kolatts/pncli/issues/175)) ([8cbda27](https://github.com/kolatts/pncli/commit/8cbda277788580e64d25fb00e9463ac873b1faf4)), closes [#174](https://github.com/kolatts/pncli/issues/174)
* **git:** normalize date-only --since/--until to include time component ([#163](https://github.com/kolatts/pncli/issues/163)) ([cdf8b98](https://github.com/kolatts/pncli/commit/cdf8b98982ce80599967fe4b9218d24ba82d932e)), closes [#162](https://github.com/kolatts/pncli/issues/162)
* issue [#185](https://github.com/kolatts/pncli/issues/185) (automated) ([#186](https://github.com/kolatts/pncli/issues/186)) ([f953eb5](https://github.com/kolatts/pncli/commit/f953eb5e262cad1f13b4716d5cebebc013f377d9))
* **jira:** fix parent field, raw field IDs, error messages, and allowedValues (BUG-13–16) ([#160](https://github.com/kolatts/pncli/issues/160)) ([92154b3](https://github.com/kolatts/pncli/commit/92154b39ff0e6779bfa2b6434b9b9b86b24acddb))
* **jira:** support cascading-select fields in create-issue and fields discovery ([#177](https://github.com/kolatts/pncli/issues/177)) ([04f34d2](https://github.com/kolatts/pncli/commit/04f34d2744d054dde5fd28e9471b6c25e4ed8b4d)), closes [#176](https://github.com/kolatts/pncli/issues/176)
* **workflows:** allow all bots in claude review workflow ([#178](https://github.com/kolatts/pncli/issues/178)) ([9c961db](https://github.com/kolatts/pncli/commit/9c961dbd7080494f24c2b0163a939c378d0b9376))

## [1.11.1](https://github.com/kolatts/pncli/compare/v1.11.0...v1.11.1) (2026-05-16)


### Bug Fixes

* **deps:** replace @inquirer/prompts with individual packages ([#155](https://github.com/kolatts/pncli/issues/155)) ([c21ea66](https://github.com/kolatts/pncli/commit/c21ea66ec3694049c24b1b1af7fdd1229683a01d)), closes [#154](https://github.com/kolatts/pncli/issues/154)

## [1.11.0](https://github.com/kolatts/pncli/compare/v1.10.1...v1.11.0) (2026-05-15)


### Features

* **git:** add report command with date filtering and CSV export ([#148](https://github.com/kolatts/pncli/issues/148)) ([b1f40e1](https://github.com/kolatts/pncli/commit/b1f40e17a2f4e373716c45734fccb747335304f8))
* **skills:** add --token option to marketplace setup for Bitbucket HTTP access tokens ([#151](https://github.com/kolatts/pncli/issues/151)) ([666e514](https://github.com/kolatts/pncli/commit/666e51472d4f66c9673733740e7bc62f263148bd))
* **skills:** add marketplace setup and sync commands ([#144](https://github.com/kolatts/pncli/issues/144)) ([29951a2](https://github.com/kolatts/pncli/commit/29951a21a6346aa59983ce1e4778da1c7b3347d2))
* **skills:** revamp to single distributable pncli skill + example-skills split ([#146](https://github.com/kolatts/pncli/issues/146)) ([122b137](https://github.com/kolatts/pncli/commit/122b1373c5347b0ac5a63ffcb8971bccfe259410))


### Bug Fixes

* **ci:** strengthen claude-triage PR gate ([#153](https://github.com/kolatts/pncli/issues/153)) ([2c04388](https://github.com/kolatts/pncli/commit/2c04388c36e47fadd5159079ff50017b3697fa39))

## [1.10.1](https://github.com/kolatts/pncli/compare/v1.10.0...v1.10.1) (2026-05-14)


### Bug Fixes

* improve supply chain security for socket.dev ([#141](https://github.com/kolatts/pncli/issues/141)) ([426818d](https://github.com/kolatts/pncli/commit/426818dbd55f528924c98da9fbeb4dc70aa30808))

## [1.10.0](https://github.com/kolatts/pncli/compare/v1.9.0...v1.10.0) (2026-05-14)


### Features

* enable mcp__github__pull_request_review_write for Claude review approvals ([#138](https://github.com/kolatts/pncli/issues/138)) ([3f07dc2](https://github.com/kolatts/pncli/commit/3f07dc25288e9530bdc473ba3902170d0b5ad579))
* **sonatypeiq:** add Sonatype IQ Server integration with PAT auth ([#130](https://github.com/kolatts/pncli/issues/130)) ([76d0c73](https://github.com/kolatts/pncli/commit/76d0c738de1d3b8f15bd509d0af47f4d078fc30e))


### Bug Fixes

* **deps:** resolve Sonatype IQ public ID to internal UUID before evaluation ([#135](https://github.com/kolatts/pncli/issues/135)) ([41674bc](https://github.com/kolatts/pncli/commit/41674bc91e787b7f1a80c436c27f8be7e285383c)), closes [#133](https://github.com/kolatts/pncli/issues/133)
* improve supply chain security for socket.dev ([#140](https://github.com/kolatts/pncli/issues/140)) ([f0b6e3f](https://github.com/kolatts/pncli/commit/f0b6e3f308402202928cb4de34b0bdf754658809))
* **skills:** bundle skills with npm package and copy from dist on install ([#137](https://github.com/kolatts/pncli/issues/137)) ([4cf8c0c](https://github.com/kolatts/pncli/commit/4cf8c0cc9e4b4ca370d90b57f2c1b88f8eac2eb0))

## [1.9.0](https://github.com/kolatts/pncli/compare/v1.8.0...v1.9.0) (2026-05-11)


### Features

* **deps:** add Sonatype OSS Index as vulnerability source for deps frisk ([#62](https://github.com/kolatts/pncli/issues/62)) ([4b8651e](https://github.com/kolatts/pncli/commit/4b8651e9cc907d6e653afa6758f05af3e618f216))
* **jira,ado:** add --parent flag to create-issue and work create ([#125](https://github.com/kolatts/pncli/issues/125)) ([c4bdb60](https://github.com/kolatts/pncli/commit/c4bdb60b8152f9b52f7d7f8fa107ecf4dc33b17e)), closes [#31](https://github.com/kolatts/pncli/issues/31)
* **servicenow,contrast:** add ServiceNow change management and Contrast IAST integrations ([#128](https://github.com/kolatts/pncli/issues/128)) ([47a706f](https://github.com/kolatts/pncli/commit/47a706f40a49e869cbdef901de00f058ffec5847))
* **site:** add auto-generated commands reference page ([#126](https://github.com/kolatts/pncli/issues/126)) ([f01e67a](https://github.com/kolatts/pncli/commit/f01e67a7fce91dacf63cc6902d491b11d8c6ee81)), closes [#99](https://github.com/kolatts/pncli/issues/99)
* **site:** add integration testing-maturity badges and reframe homepage ([#124](https://github.com/kolatts/pncli/issues/124)) ([74185cf](https://github.com/kolatts/pncli/commit/74185cfdf8d566ab3cab00e16f9bab9899362dcf))

## [1.8.0](https://github.com/kolatts/pncli/compare/v1.7.0...v1.8.0) (2026-04-24)


### Features

* add --path filter to ado repo diff ([dbbee5b](https://github.com/kolatts/pncli/commit/dbbee5b980514436512c76e2a7a48f11ccc2902b))
* add --path filter to ado repo diff command ([10a7a0c](https://github.com/kolatts/pncli/commit/10a7a0c1e514aafe67a59caa39a5e62eb25f56d6)), closes [#70](https://github.com/kolatts/pncli/issues/70)
* **artifactory:** add Artifactory API support ([#83](https://github.com/kolatts/pncli/issues/83)) ([077a861](https://github.com/kolatts/pncli/commit/077a8614e7e1606746e2beb5458e36a3f611160b))
* **checkmarx:** add CxSAST 9.x integration with OAuth2 token exchange ([#118](https://github.com/kolatts/pncli/issues/118)) ([65e6f29](https://github.com/kolatts/pncli/commit/65e6f29f0535294b32fd703eaa93142ea572f16a))
* **cli:** add --output-file global option for large command output ([#101](https://github.com/kolatts/pncli/issues/101)) ([092cbf8](https://github.com/kolatts/pncli/commit/092cbf835be7c422f13d99ad5905580eebb7bde7))
* **docs:** Dark mode ([#74](https://github.com/kolatts/pncli/issues/74)) ([066d53b](https://github.com/kolatts/pncli/commit/066d53bcf67640a064e4eb5c12d6409f5b0c5822))
* **jenkins:** add Jenkins Data Center pipeline integration ([#85](https://github.com/kolatts/pncli/issues/85)) ([dd0c90a](https://github.com/kolatts/pncli/commit/dd0c90aefdcc395d745dfc739540839eed7bf752))
* **site:** reorganize NOTICE file and add hidden easter egg page ([#82](https://github.com/kolatts/pncli/issues/82)) ([86f4f77](https://github.com/kolatts/pncli/commit/86f4f77b92ca063b1a6586bf22283c21c3f6d394))
* **site:** replace dark mode logo invert with dedicated dark variant ([#95](https://github.com/kolatts/pncli/issues/95)) ([9f05229](https://github.com/kolatts/pncli/commit/9f05229fd6d97fce0b46a0d06b043c81908067bd))
* **skills:** add ship skill, vitest tests, and pre-commit gate cleanup ([#76](https://github.com/kolatts/pncli/issues/76)) ([23c0c3d](https://github.com/kolatts/pncli/commit/23c0c3db8267f6d136220014ae01cba27ac99f69))
* **skills:** redux — isolate consumer skills, align to agentskills spec, add --agent/--scope to install ([#107](https://github.com/kolatts/pncli/issues/107)) ([edc57d0](https://github.com/kolatts/pncli/commit/edc57d09550d29e16c3e511f587d290431b45ae6))
* **udeploy:** IBM UrbanCode Deploy integration with PAT auth ([#86](https://github.com/kolatts/pncli/issues/86)) ([160f2b3](https://github.com/kolatts/pncli/commit/160f2b31818d74a8d031650950e7d46ea3863cc4))
* **udeploy:** re-add username/password auth and fix PAT token encoding ([#105](https://github.com/kolatts/pncli/issues/105)) ([b77bc1d](https://github.com/kolatts/pncli/commit/b77bc1d9c9ef3b1814982555558c7fc7ad63f382))
* **udeploy:** support username/password basic auth in addition to auth tokens ([#98](https://github.com/kolatts/pncli/issues/98)) ([2570680](https://github.com/kolatts/pncli/commit/2570680f57067346e78205125715030c4e9e0408)), closes [#97](https://github.com/kolatts/pncli/issues/97)


### Bug Fixes

* add .mailmap to normalize contributor email identity ([3e581b5](https://github.com/kolatts/pncli/commit/3e581b5adca4ec97a6267ba90f8ff243e9c0d91e))
* **ado:** use 7.1-preview.1 for connectionData endpoint ([f0e94ae](https://github.com/kolatts/pncli/commit/f0e94ae45b7b0f48a4e0ca06aad7240cbdd2c0c1))
* **ado:** use 7.1-preview.1 for connectionData endpoint ([b21983d](https://github.com/kolatts/pncli/commit/b21983db7527224a5c6829719f2c3ac4a89ae5f4)), closes [#69](https://github.com/kolatts/pncli/issues/69)
* **artifactory:** drop leading slash from API prefix to preserve base URL path ([#94](https://github.com/kolatts/pncli/issues/94)) ([26ab1ef](https://github.com/kolatts/pncli/commit/26ab1ef846fb8724a3ed8117248309012d795d64)), closes [#90](https://github.com/kolatts/pncli/issues/90)
* **bitbucket:** pass bb subcommand to getClient so --project/--repo are resolved ([#92](https://github.com/kolatts/pncli/issues/92)) ([4e2e0d9](https://github.com/kolatts/pncli/commit/4e2e0d9a3ff4a4c379e6ec7268bad6ee5d60f35a)), closes [#89](https://github.com/kolatts/pncli/issues/89)
* **jenkins:** handle multi-level folder paths in pipeline commands ([#96](https://github.com/kolatts/pncli/issues/96)) ([961766e](https://github.com/kolatts/pncli/commit/961766ea72237ea865b0afda0964718628f7bd87)), closes [#91](https://github.com/kolatts/pncli/issues/91)
* **site:** reset Turnstile widget on failed submission ([#88](https://github.com/kolatts/pncli/issues/88)) ([bde51cb](https://github.com/kolatts/pncli/commit/bde51cb2484f265f0d15c97525668183462804f9))
* **udeploy:** remove username/password auth, PAT-only ([#103](https://github.com/kolatts/pncli/issues/103)) ([24f0248](https://github.com/kolatts/pncli/commit/24f0248a7f147a7002beaa6c9df38e9880c60395))
* **udeploy:** rename --version options to avoid root-level Commander.js collision ([#112](https://github.com/kolatts/pncli/issues/112)) ([96084c9](https://github.com/kolatts/pncli/commit/96084c97ddc1bda68c7f1c3b24811d17ca24f1d5))
* **udeploy:** support username+pat as Basic auth credential pair ([#110](https://github.com/kolatts/pncli/issues/110)) ([3143caa](https://github.com/kolatts/pncli/commit/3143caae45636b2ecdba02baf9c93bdc157a3bc1)), closes [#109](https://github.com/kolatts/pncli/issues/109)

## [1.7.0](https://github.com/kolatts/pncli/compare/v1.6.1...v1.7.0) (2026-04-13)


### Features

* migrate function app secrets to Key Vault references ([f8f0d7b](https://github.com/kolatts/pncli/commit/f8f0d7b59b48f44851c319f1af1a858d3b8349c8))


### Bug Fixes

* raise IP rate limit to 10 and reload page after submission ([01de005](https://github.com/kolatts/pncli/commit/01de0052167a636c374c85dfeaec219279c75257))

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
