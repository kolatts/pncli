# Changelog

## [4.0.0](https://github.com/kolatts/pncli/compare/v3.0.0...v4.0.0) (2026-09-03)


### ⚠ BREAKING CHANGES

* Jira Cloud is no longer supported. `pncli jira assign --assignee`, `--assignee` on create-issue/update-issue, and `user`-typed custom fields passed via `--field` now take a Data Center username and send it in the `name` field. Callers passing a Cloud accountId must switch to the username, or use Atlassian's MCP server for Jira Cloud.

### Features

* **contrast:** add libraries list/get commands for SCA data ([#416](https://github.com/kolatts/pncli/issues/416)) ([82b1ee1](https://github.com/kolatts/pncli/commit/82b1ee122169af342acfb612a39a21401b989ebd)), closes [#415](https://github.com/kolatts/pncli/issues/415)
* **doctor:** pncli doctor, skill staleness detection, install --all-agents, CI recipes ([#403](https://github.com/kolatts/pncli/issues/403)) ([94b7d3f](https://github.com/kolatts/pncli/commit/94b7d3f0a8538938548eed242522a07df7d34000))
* **infra:** alert on feedback-function failures instead of finding them by hand ([#423](https://github.com/kolatts/pncli/issues/423)) ([7b2d06a](https://github.com/kolatts/pncli/commit/7b2d06af848845246b984b84502eac9d29b2a4c9))
* **skills:** improve discoverability — README sync, npm metadata, llms.txt, install hints ([#400](https://github.com/kolatts/pncli/issues/400)) ([72ad07a](https://github.com/kolatts/pncli/commit/72ad07abcd95e9236e2c37e640fb277e52c2d6ef))
* target Jira Data Center user identifiers, drop Cloud accountId ([#421](https://github.com/kolatts/pncli/issues/421)) ([a9af454](https://github.com/kolatts/pncli/commit/a9af4546cae665a67add04c4d6d357359b216144))


### Bug Fixes

* **ci:** let imagile-bot trigger issue triage, bump claude-code-action ([#413](https://github.com/kolatts/pncli/issues/413)) ([9e698fc](https://github.com/kolatts/pncli/commit/9e698fcb461fd3589d428913aed2fde06e87091d))
* **http:** surface err.cause in fetch error messages for easier diagnosis ([#414](https://github.com/kolatts/pncli/issues/414)) ([9c008a0](https://github.com/kolatts/pncli/commit/9c008a0253ce588a2565c68a13a89c6aacd6c943)), closes [#409](https://github.com/kolatts/pncli/issues/409)
* **proxy:** depend on undici so HTTP_PROXY actually works in the built CLI ([#422](https://github.com/kolatts/pncli/issues/422)) ([3691abf](https://github.com/kolatts/pncli/commit/3691abf2ca3563d1a065562ab3110bdb587b646c))
* **proxy:** stop esbuild rewriting node:undici to bare undici in bundled CLI ([#420](https://github.com/kolatts/pncli/issues/420)) ([3ba51ab](https://github.com/kolatts/pncli/commit/3ba51ab10357bbdf89dd6ea43f525deeaf74f4e8)), closes [#419](https://github.com/kolatts/pncli/issues/419)

## [3.0.0](https://github.com/kolatts/pncli/compare/v2.0.0...v3.0.0) (2026-08-28)


### ⚠ BREAKING CHANGES

* **docs:** `copilot-instructions.md` is deleted and no longer shipped in the npm tarball -- it has been dropped from `package.json` `files`. Anything fetching it from a pinned path in the package or the repo will 404. The content moved to two places that are still published: run `pncli skills install` for `skills/pncli/` (still in the tarball), which carries the setup guidance plus a per-service file, or read https://kolatts.github.io/pncli/getting-started/ and https://kolatts.github.io/pncli/commands/ for the same material online.
* **skills:** `--agent github-copilot` now resolves to `.github/skills` (project) and `~/.copilot/skills` (user), the directories GitHub documents for Copilot. It previously meant `.agents/skills` at both scopes. The default install directory is unchanged — `.agents/skills` — but it is now reached under the agent name `codex` rather than `github-copilot`, so callers relying on the default are unaffected. Anyone passing `--agent github-copilot` explicitly and wanting the previous behavior should switch to `--agent codex`; the flag emits a one-time warning naming both paths. Skills already installed under `.agents/skills` stay where they are and are still found by the default agent.

### Features

* **automation:** imagile-bot identity for website issues; formal reviews via workflow token ([#398](https://github.com/kolatts/pncli/issues/398)) ([f0b352d](https://github.com/kolatts/pncli/commit/f0b352dbb2f9cb9f9d374722b417cfe3f0952a8b))
* **docs:** retire copilot-instructions.md in favour of skills/pncli/ ([#396](https://github.com/kolatts/pncli/issues/396)) ([c7cf682](https://github.com/kolatts/pncli/commit/c7cf6820acb369986e7db20ece6661ef3ff550c7))
* **dynatrace:** support multiple named environments with --env flag ([#392](https://github.com/kolatts/pncli/issues/392)) ([185a601](https://github.com/kolatts/pncli/commit/185a601bc17878adfab57d2b42b8679744dbee9e))
* **openshift:** support multiple environments and cluster instances ([#395](https://github.com/kolatts/pncli/issues/395)) ([d258b65](https://github.com/kolatts/pncli/commit/d258b65cbc9d2b5773e8700fa565cd8ba30508e9))
* **site:** add OpenShift to feedback form and sort services A-Z ([#394](https://github.com/kolatts/pncli/issues/394)) ([c21fd42](https://github.com/kolatts/pncli/commit/c21fd422d8e8fc59a6f3f67c8cfa6396c2938487)), closes [#393](https://github.com/kolatts/pncli/issues/393)
* **skills:** .github install target, codex default, and full install visibility ([#385](https://github.com/kolatts/pncli/issues/385)) ([06b6e45](https://github.com/kolatts/pncli/commit/06b6e45fd60459587f36e44d13c39c1f08f4148e))


### Bug Fixes

* **ci:** restore npm publishing and backfill the three missed releases ([#382](https://github.com/kolatts/pncli/issues/382)) ([a0aeb11](https://github.com/kolatts/pncli/commit/a0aeb11efd25ed526fdfe7759b820d6e77253860))

## [2.0.0](https://github.com/kolatts/pncli/compare/v1.26.0...v2.0.0) (2026-08-27)


### ⚠ BREAKING CHANGES

* The `pncli udeploy` commands and all `PNCLI_UDEPLOY_*` config have been removed. IBM UrbanCode Deploy has no personal access token usable as a standalone credential, so its only workable auth was a username and password — which meant asking users to put a real account password in a config file. That fails pncli's authentication bar, which requires a long-lived static token the user generates in the target tool's own UI. There is no replacement; UCD is not coming back. A stale `udeploy` key left in ~/.pncli/config.json is ignored and can be deleted by hand, or will be dropped on the next `pncli config init`.

### Features

* **figma:** add Figma integration for design files, comments, and version history ([#377](https://github.com/kolatts/pncli/issues/377)) ([8059de8](https://github.com/kolatts/pncli/commit/8059de8426810c0803c00f9097ec4f4cbbe40a50))
* **jenkins:** support multiple named instances via --instance flag ([#366](https://github.com/kolatts/pncli/issues/366)) ([8612dde](https://github.com/kolatts/pncli/commit/8612dded81da45656cf3270a3a167cb1d0160c89))
* **openshift:** resource-usage command with CSV output ([#373](https://github.com/kolatts/pncli/issues/373)) ([67051d2](https://github.com/kolatts/pncli/commit/67051d25b3ab380981dce36d09729c9624b918f7))
* panel per integration with testing state; remove IBM UrbanCode Deploy ([#380](https://github.com/kolatts/pncli/issues/380)) ([83a64c7](https://github.com/kolatts/pncli/commit/83a64c79c05cf8d32f63b084bf2739905809f789)), closes [#378](https://github.com/kolatts/pncli/issues/378) [#379](https://github.com/kolatts/pncli/issues/379)


### Bug Fixes

* issue [#370](https://github.com/kolatts/pncli/issues/370) (automated) ([#371](https://github.com/kolatts/pncli/issues/371)) ([70d8051](https://github.com/kolatts/pncli/commit/70d8051d5384193339d9267d7d99502bc10d7431))

## [1.26.0](https://github.com/kolatts/pncli/compare/v1.25.1...v1.26.0) (2026-08-24)


### Features

* add --raw flag to openshift pods for full Kubernetes object output ([#364](https://github.com/kolatts/pncli/issues/364)) ([9495d22](https://github.com/kolatts/pncli/commit/9495d226966c1aff88a0a1480f219b377b432b95)), closes [#363](https://github.com/kolatts/pncli/issues/363)


### Bug Fixes

* issue [#358](https://github.com/kolatts/pncli/issues/358) (automated) ([#359](https://github.com/kolatts/pncli/issues/359)) ([3715390](https://github.com/kolatts/pncli/commit/3715390ac8e6abebeab77be6dadcec88d39cda7e))
* preserve literal commas in URL query params (fixes --expand multi-field 404) ([#361](https://github.com/kolatts/pncli/issues/361)) ([60c8239](https://github.com/kolatts/pncli/commit/60c8239dd5cd34801d48ba4e98a2b4b17980e787))

## [1.25.1](https://github.com/kolatts/pncli/compare/v1.25.0...v1.25.1) (2026-08-21)


### Bug Fixes

* **site:** escape angle brackets in generated command docs prose ([#356](https://github.com/kolatts/pncli/issues/356)) ([3a563e6](https://github.com/kolatts/pncli/commit/3a563e6ef01fe38b14f350643b5236d308cd1b46)), closes [#355](https://github.com/kolatts/pncli/issues/355)

## [1.25.0](https://github.com/kolatts/pncli/compare/v1.24.0...v1.25.0) (2026-08-20)


### Features

* **bitbucket:** add create-prs command for batch PR creation across multiple repos ([#351](https://github.com/kolatts/pncli/issues/351)) ([d1bc920](https://github.com/kolatts/pncli/commit/d1bc9204b967bdf19a5747d0a4714e3d45a59392)), closes [#350](https://github.com/kolatts/pncli/issues/350)
* **config:** fall back to well-known CI env vars for GitHub, Sonar, and ADO ([#354](https://github.com/kolatts/pncli/issues/354)) ([8d100fd](https://github.com/kolatts/pncli/commit/8d100fd67f236b743a7962c28ed89ccf499898c6))


### Bug Fixes

* issue [#346](https://github.com/kolatts/pncli/issues/346) (automated) ([8f05409](https://github.com/kolatts/pncli/commit/8f05409fd57a618a06ffc41255435c7b2de875d7))
* show both missing github.baseUrl and github.token in one error ([#348](https://github.com/kolatts/pncli/issues/348)) ([4239531](https://github.com/kolatts/pncli/commit/423953185c4cdd00ee000768a2d7ca4b004ca51a)), closes [#347](https://github.com/kolatts/pncli/issues/347)

## [1.24.0](https://github.com/kolatts/pncli/compare/v1.23.0...v1.24.0) (2026-08-19)


### Features

* add GitHub review thread resolution and list-review-threads ([#343](https://github.com/kolatts/pncli/issues/343)) ([909ee57](https://github.com/kolatts/pncli/commit/909ee57ab8c7ef1e2a6d84d8ab8b0f391b9a0081))


### Bug Fixes

* config test duplicates /api in Checkmarx endpoint ([#340](https://github.com/kolatts/pncli/issues/340)) ([eaead30](https://github.com/kolatts/pncli/commit/eaead306f291f31e1b2574a7e637da228ebbea9d))
* **confluence:** add storage-format hint for HTTP 500 macro errors ([#345](https://github.com/kolatts/pncli/issues/345)) ([0d5233c](https://github.com/kolatts/pncli/commit/0d5233c77d4378caec30d4bd8c5ddf4bf1a83930)), closes [#344](https://github.com/kolatts/pncli/issues/344)

## [1.23.0](https://github.com/kolatts/pncli/compare/v1.22.0...v1.23.0) (2026-08-18)


### Features

* **logscale:** add CrowdStrike Falcon LogScale integration ([#337](https://github.com/kolatts/pncli/issues/337)) ([ae3cde5](https://github.com/kolatts/pncli/commit/ae3cde59dc20491ffd84b0cd9bc9ab68b5c2edb4)), closes [#336](https://github.com/kolatts/pncli/issues/336)

## [1.22.0](https://github.com/kolatts/pncli/compare/v1.21.0...v1.22.0) (2026-08-18)


### Features

* **ado:** add --draft flag to create-pr and update-pr ([#327](https://github.com/kolatts/pncli/issues/327)) ([d94869f](https://github.com/kolatts/pncli/commit/d94869fe9d4db7588a13cae1c8d5b6cb53ca5c7d))
* **confluence:** add download-attachment command ([#325](https://github.com/kolatts/pncli/issues/325)) ([8d14c19](https://github.com/kolatts/pncli/commit/8d14c1975e237645fdf132558cdf92717b2563e1))
* **site:** consistent chibi art, robot party, and changelog MDX escaping fix ([#314](https://github.com/kolatts/pncli/issues/314)) ([8a009e7](https://github.com/kolatts/pncli/commit/8a009e7f07962d62ae7b5d7b7489dcdb5cb385d6))
* **site:** transparent chibi art and full cast lineup ([#317](https://github.com/kolatts/pncli/issues/317)) ([06b2e44](https://github.com/kolatts/pncli/commit/06b2e44c9818138852ca9587ee1484caf16b90ab)), closes [#316](https://github.com/kolatts/pncli/issues/316)
* **skills:** add marketplace enable/disable plugin toggle ([#319](https://github.com/kolatts/pncli/issues/319)) ([f129ffa](https://github.com/kolatts/pncli/commit/f129ffae1c1e888a9c124d075b64763b986d1577))


### Bug Fixes

* **ci:** add manual re-triage path to claude-triage workflow ([#322](https://github.com/kolatts/pncli/issues/322)) ([8941761](https://github.com/kolatts/pncli/commit/8941761cbeefd9256359a3ff84732d9a93ec2a31))
* **ci:** gate track_progress on the issues event so re-triage works ([#332](https://github.com/kolatts/pncli/issues/332)) ([925f752](https://github.com/kolatts/pncli/commit/925f7529e5a900ef43f12916686278e3980a5bb7)), closes [#331](https://github.com/kolatts/pncli/issues/331)
* **ci:** retry transient gh failures in claude-triage ([#324](https://github.com/kolatts/pncli/issues/324)) ([95e4ae4](https://github.com/kolatts/pncli/commit/95e4ae4bb11f4a9387aaa4a7c268d02897f7abdb))
* **ci:** stop no-op label runs from cancelling claude-triage ([#330](https://github.com/kolatts/pncli/issues/330)) ([3ff189c](https://github.com/kolatts/pncli/commit/3ff189ceefbb7eadf566d6de1cbe2bca76574579)), closes [#329](https://github.com/kolatts/pncli/issues/329)
* **jira:** add --jql-file to search to avoid PowerShell quoting failures ([#333](https://github.com/kolatts/pncli/issues/333)) ([c53f480](https://github.com/kolatts/pncli/commit/c53f48044654c1b6f82070da6431c1fc1aa22a0e))

## [1.21.0](https://github.com/kolatts/pncli/compare/v1.20.0...v1.21.0) (2026-08-15)


### Features

* add bitbucket add-reviewer command ([#308](https://github.com/kolatts/pncli/issues/308)) ([2de56bd](https://github.com/kolatts/pncli/commit/2de56bd21b50392f1bf392bf402ad3b25cf910c9)), closes [#307](https://github.com/kolatts/pncli/issues/307)


### Bug Fixes

* **skills:** github-copilot user scope should target ~/.agents/skills ([#311](https://github.com/kolatts/pncli/issues/311)) ([e4a337d](https://github.com/kolatts/pncli/commit/e4a337d01ba9be3167ecb74ec887512516fef572)), closes [#309](https://github.com/kolatts/pncli/issues/309)

## [1.20.0](https://github.com/kolatts/pncli/compare/v1.19.0...v1.20.0) (2026-08-13)


### Features

* **site:** Context Overflow-inspired makeover with robot art ([#297](https://github.com/kolatts/pncli/issues/297)) ([ee08f76](https://github.com/kolatts/pncli/commit/ee08f76a7246c3a415535609e48c34b4ec1930a7)), closes [#296](https://github.com/kolatts/pncli/issues/296)


### Bug Fixes

* **bitbucket:** replace unsupported /users/~ with whoami + /users/{slug} lookup ([#304](https://github.com/kolatts/pncli/issues/304)) ([358cc2a](https://github.com/kolatts/pncli/commit/358cc2a98e5afc033f573dcaf185cd8c43f45ea5)), closes [#303](https://github.com/kolatts/pncli/issues/303)
* **bitbucket:** resolve needs-work 403 by auto-promoting the caller to reviewer ([#302](https://github.com/kolatts/pncli/issues/302)) ([6baa0cb](https://github.com/kolatts/pncli/commit/6baa0cbc8f4231e328a9a92f67500c48adcf4634))
* **bitbucket:** use X-AUSERNAME header from application-properties to resolve current user ([#306](https://github.com/kolatts/pncli/issues/306)) ([7f62bc1](https://github.com/kolatts/pncli/commit/7f62bc1dba03b426372755ca4c1cdf5747682141)), closes [#305](https://github.com/kolatts/pncli/issues/305)
* **ci:** drop the workflows permission from claude-triage ([#301](https://github.com/kolatts/pncli/issues/301)) ([1cae8c1](https://github.com/kolatts/pncli/commit/1cae8c12c0ed3ddd669d740d9fa52a01d853a703))

## [1.19.0](https://github.com/kolatts/pncli/compare/v1.18.0...v1.19.0) (2026-07-31)


### Features

* add Dynatrace integration ([#282](https://github.com/kolatts/pncli/issues/282)) ([2c31933](https://github.com/kolatts/pncli/commit/2c3193339f3efbf8e862124735611a18e6dd62a5))
* per-skill pncli-origin.json, purge-plugin, and purge-user commands ([#291](https://github.com/kolatts/pncli/issues/291)) ([68d9227](https://github.com/kolatts/pncli/commit/68d9227e28418a87cb39159e88fa67bb77005ef8)), closes [#288](https://github.com/kolatts/pncli/issues/288)
* rework Checkmarx from CxSAST on-premise to Checkmarx One cloud ([#276](https://github.com/kolatts/pncli/issues/276)) ([813507d](https://github.com/kolatts/pncli/commit/813507d56bc29bd3dde46555c9f9dc3647b3bf67))


### Bug Fixes

* create triage PRs as Imagile Bot ([#290](https://github.com/kolatts/pncli/issues/290)) ([9f25a67](https://github.com/kolatts/pncli/commit/9f25a67faee8b19837e93b020f45aa93f3f45266)), closes [#289](https://github.com/kolatts/pncli/issues/289)
* drop leading /api/ from CheckmarxClient paths (fixes doubled /api/api/ after buildUrl fix) ([#287](https://github.com/kolatts/pncli/issues/287)) ([ffd0bd8](https://github.com/kolatts/pncli/commit/ffd0bd804348945ba251e9dcd5ffd6f06f22d453))
* handle null projects/scans arrays in checkmarx list commands ([#278](https://github.com/kolatts/pncli/issues/278)) ([ff4e2c1](https://github.com/kolatts/pncli/commit/ff4e2c1e9e60bc2805dd64a7dd918b13ed765f37))
* pass file path as URL segment in bitbucket diff, not query param ([#272](https://github.com/kolatts/pncli/issues/272)) ([459128c](https://github.com/kolatts/pncli/commit/459128c97870d9a48bd8f54aea8d3e4bc6152d01)), closes [#271](https://github.com/kolatts/pncli/issues/271)
* preserve base URL path segments in buildUrl() for Managed Dynatrace and similar hosts ([#284](https://github.com/kolatts/pncli/issues/284)) ([9bc9493](https://github.com/kolatts/pncli/commit/9bc9493411cef7756619dc43d889b0d4875c0882))
* restore closed-issue email notifications ([#280](https://github.com/kolatts/pncli/issues/280)) ([da58b2a](https://github.com/kolatts/pncli/commit/da58b2ae3d07cd4b99c19c04664e7d8204204930)), closes [#279](https://github.com/kolatts/pncli/issues/279)

## [1.18.0](https://github.com/kolatts/pncli/compare/v1.17.0...v1.18.0) (2026-07-24)


### Features

* **confluence:** --body-file, --markdown, and XML error hints ([#257](https://github.com/kolatts/pncli/issues/257)) ([df8040f](https://github.com/kolatts/pncli/commit/df8040fb4abe808e4619fcf4d03d4a0688a6f691))
* **confluence:** add upload-attachment, delete-attachment, and get-page-history ([#263](https://github.com/kolatts/pncli/issues/263)) ([529f4d5](https://github.com/kolatts/pncli/commit/529f4d5bf46d3725e1c0b107e62f239e332e9fa4)), closes [#261](https://github.com/kolatts/pncli/issues/261)
* **github,bitbucket,ado:** add create-repo command to GitHub, Bitbucket, and ADO ([#268](https://github.com/kolatts/pncli/issues/268)) ([950d9ae](https://github.com/kolatts/pncli/commit/950d9ae73105aac5c9c8b5a153388046f44bc3e7)), closes [#266](https://github.com/kolatts/pncli/issues/266)
* **github:** add create-issue command ([#265](https://github.com/kolatts/pncli/issues/265)) ([07b1a3d](https://github.com/kolatts/pncli/commit/07b1a3d3d2f122dde5331408be321aea5db7c22a))
* **jira,ado:** universal --input-file JSON convention with schema discovery ([#260](https://github.com/kolatts/pncli/issues/260)) ([e74baeb](https://github.com/kolatts/pncli/commit/e74baebeae2832337feda4dd051a0b18e5d0ad2f))


### Bug Fixes

* **config:** parse JSON array/object values in config set ([#270](https://github.com/kolatts/pncli/issues/270)) ([2d0e91a](https://github.com/kolatts/pncli/commit/2d0e91ae26151e7d571077520c09f20944c28d64)), closes [#269](https://github.com/kolatts/pncli/issues/269)

## [1.17.0](https://github.com/kolatts/pncli/compare/v1.16.0...v1.17.0) (2026-07-20)


### Features

* **ado:** add work list-areas and list-iterations commands ([#248](https://github.com/kolatts/pncli/issues/248)) ([e5a7448](https://github.com/kolatts/pncli/commit/e5a7448f7ecbab9dbf8ee4bc8ed75033cadc7f85))
* **jenkins:** project-scoped baseUrl via defaults.jenkins.baseUrl ([#252](https://github.com/kolatts/pncli/issues/252)) ([5e00577](https://github.com/kolatts/pncli/commit/5e00577014ebbdfe94877a47d322198e1b1a165f))
* **jira:** list boards/sprints and set sprint on an issue ([#250](https://github.com/kolatts/pncli/issues/250)) ([2b17de8](https://github.com/kolatts/pncli/commit/2b17de89582e60391939be2cc2ac71805a8fc87f))
* **skills:** support multiple marketplaces with seamless sync and CRUD ([#247](https://github.com/kolatts/pncli/issues/247)) ([2cab98c](https://github.com/kolatts/pncli/commit/2cab98c9180b357753842173933f74e9e5a4ca97))


### Bug Fixes

* **jira:** skip non-scrum boards in listSprintsForProject ([#255](https://github.com/kolatts/pncli/issues/255)) ([c0e4858](https://github.com/kolatts/pncli/commit/c0e4858f909588a73824a4e59c977123efc011c8))
* **skills:** treat marketplace clone as successful when git exits non-zero but .git is valid ([#242](https://github.com/kolatts/pncli/issues/242)) ([c9e3a06](https://github.com/kolatts/pncli/commit/c9e3a0632095e0e711c969efd9ea360e950bf5b9)), closes [#239](https://github.com/kolatts/pncli/issues/239)

## [1.16.0](https://github.com/kolatts/pncli/compare/v1.15.0...v1.16.0) (2026-06-27)


### Features

* add GitHub integration with PR, review, and comment operations ([#231](https://github.com/kolatts/pncli/issues/231)) ([d52b627](https://github.com/kolatts/pncli/commit/d52b6275013cbe5adcd91ba019f1ac88d5a91d3c))
* **ci:** Discord notifications for issues and NPM releases ([#238](https://github.com/kolatts/pncli/issues/238)) ([047d4ec](https://github.com/kolatts/pncli/commit/047d4ec3fa15db709dbf4541f514185921e44d71))
* **site:** add Beyond Boring Discord link to footer and feedback page ([#236](https://github.com/kolatts/pncli/issues/236)) ([24a1a64](https://github.com/kolatts/pncli/commit/24a1a64b745f1a7ae35604a752e00510e4e061f3))


### Bug Fixes

* **functions:** send close-reason email when GitHub issues are resolved ([#235](https://github.com/kolatts/pncli/issues/235)) ([e0d1df0](https://github.com/kolatts/pncli/commit/e0d1df09c1221883ec490d029db19a35574cf3cc)), closes [#233](https://github.com/kolatts/pncli/issues/233)
* **skills:** marketplace setup now clones and copies all plugins ([#227](https://github.com/kolatts/pncli/issues/227)) ([83582f7](https://github.com/kolatts/pncli/commit/83582f70c5c5f2e95238817f5571b36bb9c2229b))

## [1.15.0](https://github.com/kolatts/pncli/compare/v1.14.1...v1.15.0) (2026-06-21)


### Features

* **cli:** add --debug global option for API call traces ([#222](https://github.com/kolatts/pncli/issues/222)) ([2a0375f](https://github.com/kolatts/pncli/commit/2a0375ff16bdcda32107e0ac78d328fd0f05867a)), closes [#221](https://github.com/kolatts/pncli/issues/221)
* **skills:** add "All" option to interactive marketplace sync menu ([#225](https://github.com/kolatts/pncli/issues/225)) ([63c0507](https://github.com/kolatts/pncli/commit/63c0507970ce86a59c22273abd50de62b99c1d3d))


### Bug Fixes

* **git:** add UTC timezone to normalized git dates to prevent previous-year parse failures ([#215](https://github.com/kolatts/pncli/issues/215)) ([18dc252](https://github.com/kolatts/pncli/commit/18dc2521f7261953013ea5b211cae54a15ddb2bb)), closes [#214](https://github.com/kolatts/pncli/issues/214)
* **git:** increase execFileSync maxBuffer to 200 MB to prevent ENOBUFS on large repos ([#218](https://github.com/kolatts/pncli/issues/218)) ([49b75ee](https://github.com/kolatts/pncli/commit/49b75ee85fc7d826e8d974874b1a1f4e2dea99ca)), closes [#217](https://github.com/kolatts/pncli/issues/217)
* **openshift:** send Accept: */* in openshiftText to avoid HTTP 406 ([#213](https://github.com/kolatts/pncli/issues/213)) ([2e45442](https://github.com/kolatts/pncli/commit/2e4544268c193e93d8fa5dc91e4f1e23b36b5687)), closes [#212](https://github.com/kolatts/pncli/issues/212)
* **skills:** always prompt for plugin in sync, keep .agents default, add setup hint ([#223](https://github.com/kolatts/pncli/issues/223)) ([b7077a7](https://github.com/kolatts/pncli/commit/b7077a7a4615eb67513e4193a667676e4de1841e))

## [1.14.1](https://github.com/kolatts/pncli/compare/v1.14.0...v1.14.1) (2026-06-14)


### Bug Fixes

* **ado:** always send application/octet-stream for work item attachments ([#210](https://github.com/kolatts/pncli/issues/210)) ([d532e45](https://github.com/kolatts/pncli/commit/d532e457bdbffb931870f786e14a18be83c3d417)), closes [#209](https://github.com/kolatts/pncli/issues/209)

## [1.14.0](https://github.com/kolatts/pncli/compare/v1.13.0...v1.14.0) (2026-06-13)


### Features

* **ado:** add work item attachment upload ([#205](https://github.com/kolatts/pncli/issues/205)) ([c1df406](https://github.com/kolatts/pncli/commit/c1df406d7ff65f4fb6e3d5e34af997253fc9f7ae))
* **jwt:** add jwt decode command ([#203](https://github.com/kolatts/pncli/issues/203)) ([336637a](https://github.com/kolatts/pncli/commit/336637afaeb2c3f9c940f3f6fe471bab4a226be3))
* **openshift:** OpenShift/Kubernetes service integration and health-checker skill ([#207](https://github.com/kolatts/pncli/issues/207)) ([a6addd2](https://github.com/kolatts/pncli/commit/a6addd263782ae14c1eed62edf81a473bde6daf1))

## [1.13.0](https://github.com/kolatts/pncli/compare/v1.12.0...v1.13.0) (2026-05-30)


### Features

* **ado,jira:** add attachment list and download commands ([#199](https://github.com/kolatts/pncli/issues/199)) ([03b810e](https://github.com/kolatts/pncli/commit/03b810efde4c212de4238b990e226a6604ef890e))
* **jira,ado:** add label and tag management commands ([#196](https://github.com/kolatts/pncli/issues/196)) ([2634d60](https://github.com/kolatts/pncli/commit/2634d6039053b9ea0a072632be921f5b670d4c46))
* **jira:** add add-attachment command ([#192](https://github.com/kolatts/pncli/issues/192)) ([82b664a](https://github.com/kolatts/pncli/commit/82b664a9784a6423c8177665efb02f525487c6c7))
* **skills:** print per-skill copy paths during marketplace sync ([#194](https://github.com/kolatts/pncli/issues/194)) ([bd2fbc1](https://github.com/kolatts/pncli/commit/bd2fbc1ed1c1c18e14e04b41a16523151e10e6ef)), closes [#193](https://github.com/kolatts/pncli/issues/193)


### Bug Fixes

* **confluence:** make --limit cap total results in list-spaces and list-pages ([#190](https://github.com/kolatts/pncli/issues/190)) ([76c7dde](https://github.com/kolatts/pncli/commit/76c7dded998b1cc477af0442276faae64d395f1d)), closes [#189](https://github.com/kolatts/pncli/issues/189)
* **git:** filter report commits by author date and route CSV through --output-file ([#188](https://github.com/kolatts/pncli/issues/188)) ([1616024](https://github.com/kolatts/pncli/commit/16160245aad5efed99d1014347f5194a7d655259)), closes [#187](https://github.com/kolatts/pncli/issues/187)

## [1.12.0](https://github.com/kolatts/pncli/compare/v1.11.1...v1.12.0) (2026-05-23)


### Features

* **jenkins:** add --folder flag to pipeline list for folder-scoped job enumeration ([#171](https://github.com/kolatts/pncli/issues/171)) ([8354c5a](https://github.com/kolatts/pncli/commit/8354c5a96304f4523e2cc00f7cce601806d5dbdb))
* **jira:** support [@file](https://github.com/file) syntax and --fields-file for large custom field payloads ([#180](https://github.com/kolatts/pncli/issues/180)) ([a9d8df5](https://github.com/kolatts/pncli/commit/a9d8df5860cbc49e4382c8705eadb6103ff071cc)), closes [#179](https://github.com/kolatts/pncli/issues/179)
* **skills:** add --force flag and all-plugins sync to marketplace sync ([#184](https://github.com/kolatts/pncli/issues/184)) ([d81b2d8](https://github.com/kolatts/pncli/commit/d81b2d832534061a0da2e37a7967ba09e0859e17)), closes [#183](https://github.com/kolatts/pncli/issues/183)
* **skills:** skip marketplace sync prompt when no git changes ([#165](https://github.com/kolatts/pncli/issues/165)) ([c0793af](https://github.com/kolatts/pncli/commit/c0793afd378ae4d5c57b3dab9dacce464aa7eec2))


### Bug Fixes

* **ado:** decode URL components in parseAdoRemote to prevent double-encoding ([#167](https://github.com/kolatts/pncli/issues/167)) ([29c6d3e](https://github.com/kolatts/pncli/commit/29c6d3e03feee6daa6329d83962844ab159ac652)), closes [#166](https://github.com/kolatts/pncli/issues/166)
* **ado:** honour caller Content-Type in ADO fetcher ([#158](https://github.com/kolatts/pncli/issues/158)) ([b10613e](https://github.com/kolatts/pncli/commit/b10613eed6971bce5b4164ddf47d1a0b9a790d9e)), closes [#157](https://github.com/kolatts/pncli/issues/157)
* **ado:** pipeline list-runs --definition filter and add --name support ([#173](https://github.com/kolatts/pncli/issues/173)) ([720a60b](https://github.com/kolatts/pncli/commit/720a60b1fc32cad104a13242e087e938e3be2236))
* **artifactory,ado:** builds timeout, list-runs top limit, pipeline logs --build-id alias ([#182](https://github.com/kolatts/pncli/issues/182)) ([d71837b](https://github.com/kolatts/pncli/commit/d71837bbabd1cceb4e75f97bd177714081792f39))
* **artifactory:** parse build names from URIs and hint on empty builds list ([#172](https://github.com/kolatts/pncli/issues/172)) ([f497708](https://github.com/kolatts/pncli/commit/f497708a94bdb0de84b74e9e773b68e3760b8154)), closes [#170](https://github.com/kolatts/pncli/issues/170)
* **bitbucket:** add --project/--repo flags to create-pr subcommand ([#175](https://github.com/kolatts/pncli/issues/175)) ([d03ab4d](https://github.com/kolatts/pncli/commit/d03ab4d80a99fd246c09c5d12f51f0643f0c3e90)), closes [#174](https://github.com/kolatts/pncli/issues/174)
* **git:** normalize date-only --since/--until to include time component ([#163](https://github.com/kolatts/pncli/issues/163)) ([b6b7099](https://github.com/kolatts/pncli/commit/b6b70999816720986220164c6d05bd7712af5a1d)), closes [#162](https://github.com/kolatts/pncli/issues/162)
* issue [#185](https://github.com/kolatts/pncli/issues/185) (automated) ([#186](https://github.com/kolatts/pncli/issues/186)) ([bb227c2](https://github.com/kolatts/pncli/commit/bb227c2a7fdefd7480979f161f909b3e799ce044))
* **jira:** fix parent field, raw field IDs, error messages, and allowedValues (BUG-13–16) ([#160](https://github.com/kolatts/pncli/issues/160)) ([2798761](https://github.com/kolatts/pncli/commit/2798761b6bad7fa81ab39d45250b055658dc7b07))
* **jira:** support cascading-select fields in create-issue and fields discovery ([#177](https://github.com/kolatts/pncli/issues/177)) ([e33dbe6](https://github.com/kolatts/pncli/commit/e33dbe67844699dc35bf058e395456fa13795a12)), closes [#176](https://github.com/kolatts/pncli/issues/176)
* **workflows:** allow all bots in claude review workflow ([#178](https://github.com/kolatts/pncli/issues/178)) ([2bdde88](https://github.com/kolatts/pncli/commit/2bdde88d6054482a3d7b19a4df5602223f57cfcc))

## [1.11.1](https://github.com/kolatts/pncli/compare/v1.11.0...v1.11.1) (2026-05-16)


### Bug Fixes

* **deps:** replace @inquirer/prompts with individual packages ([#155](https://github.com/kolatts/pncli/issues/155)) ([fe35cf6](https://github.com/kolatts/pncli/commit/fe35cf66d3a753f28d5e057d73015db4cf3ed26c)), closes [#154](https://github.com/kolatts/pncli/issues/154)

## [1.11.0](https://github.com/kolatts/pncli/compare/v1.10.1...v1.11.0) (2026-05-15)


### Features

* **git:** add report command with date filtering and CSV export ([#148](https://github.com/kolatts/pncli/issues/148)) ([073ab42](https://github.com/kolatts/pncli/commit/073ab42af60cc657c1cb5b85f996bdb4e21dc3c3))
* **skills:** add --token option to marketplace setup for Bitbucket HTTP access tokens ([#151](https://github.com/kolatts/pncli/issues/151)) ([1d6d8f7](https://github.com/kolatts/pncli/commit/1d6d8f7218895d583dda17d220e1fe0c71e0ebbe))
* **skills:** add marketplace setup and sync commands ([#144](https://github.com/kolatts/pncli/issues/144)) ([8b7126e](https://github.com/kolatts/pncli/commit/8b7126e67ec941e22f6084d0259f2f14514cc759))
* **skills:** revamp to single distributable pncli skill + example-skills split ([#146](https://github.com/kolatts/pncli/issues/146)) ([40285d6](https://github.com/kolatts/pncli/commit/40285d60ac69ccc1d06e2b42edb024c65f9f3a4f))


### Bug Fixes

* **ci:** strengthen claude-triage PR gate ([#153](https://github.com/kolatts/pncli/issues/153)) ([f89c561](https://github.com/kolatts/pncli/commit/f89c561b28375c440b9cd8c34ea7a9b3ec412e65))

## [1.10.1](https://github.com/kolatts/pncli/compare/v1.10.0...v1.10.1) (2026-05-14)


### Bug Fixes

* improve supply chain security for socket.dev ([#141](https://github.com/kolatts/pncli/issues/141)) ([d9e13a5](https://github.com/kolatts/pncli/commit/d9e13a5d1d792530644baff1f6e2534099006098))

## [1.10.0](https://github.com/kolatts/pncli/compare/v1.9.0...v1.10.0) (2026-05-14)


### Features

* enable mcp__github__pull_request_review_write for Claude review approvals ([#138](https://github.com/kolatts/pncli/issues/138)) ([30ac8d9](https://github.com/kolatts/pncli/commit/30ac8d9c0ec34c81df61cff7219f0e106f25a192))
* **sonatypeiq:** add Sonatype IQ Server integration with PAT auth ([#130](https://github.com/kolatts/pncli/issues/130)) ([ce20edd](https://github.com/kolatts/pncli/commit/ce20edd4709325f2dfa8ed5fc606f86adb64bf41))


### Bug Fixes

* **deps:** resolve Sonatype IQ public ID to internal UUID before evaluation ([#135](https://github.com/kolatts/pncli/issues/135)) ([ec05dc6](https://github.com/kolatts/pncli/commit/ec05dc6ef4d9d3962d855c307ce8de3a5b00c539)), closes [#133](https://github.com/kolatts/pncli/issues/133)
* improve supply chain security for socket.dev ([#140](https://github.com/kolatts/pncli/issues/140)) ([122288b](https://github.com/kolatts/pncli/commit/122288bbccd67899cc6e44fde259400de61242aa))
* **skills:** bundle skills with npm package and copy from dist on install ([#137](https://github.com/kolatts/pncli/issues/137)) ([f459e7a](https://github.com/kolatts/pncli/commit/f459e7ac77e88d7917e2cd4523e4860beea562b7))

## [1.9.0](https://github.com/kolatts/pncli/compare/v1.8.0...v1.9.0) (2026-05-11)


### Features

* **deps:** add Sonatype OSS Index as vulnerability source for deps frisk ([#62](https://github.com/kolatts/pncli/issues/62)) ([5825098](https://github.com/kolatts/pncli/commit/58250987ba603f3ef8cc4801b9d5ee0d11172240))
* **jira,ado:** add --parent flag to create-issue and work create ([#125](https://github.com/kolatts/pncli/issues/125)) ([9539ad4](https://github.com/kolatts/pncli/commit/9539ad40cd067fdcfbab810bc7cc53f36e92cec9)), closes [#31](https://github.com/kolatts/pncli/issues/31)
* **servicenow,contrast:** add ServiceNow change management and Contrast IAST integrations ([#128](https://github.com/kolatts/pncli/issues/128)) ([18371e9](https://github.com/kolatts/pncli/commit/18371e9b939f5ba111242b83b5efc4a9cbeaaa30))
* **site:** add auto-generated commands reference page ([#126](https://github.com/kolatts/pncli/issues/126)) ([3502e97](https://github.com/kolatts/pncli/commit/3502e976be84279682c3a3ac600cf99a16e3fc0d)), closes [#99](https://github.com/kolatts/pncli/issues/99)
* **site:** add integration testing-maturity badges and reframe homepage ([#124](https://github.com/kolatts/pncli/issues/124)) ([74fd5f1](https://github.com/kolatts/pncli/commit/74fd5f16c56fc7e6a0010bf5ed26ed9c6835c311))

## [1.8.0](https://github.com/kolatts/pncli/compare/v1.7.0...v1.8.0) (2026-04-24)


### Features

* add --path filter to ado repo diff ([cdb29c3](https://github.com/kolatts/pncli/commit/cdb29c332e58f65ae962923fab24c153e51a605e))
* add --path filter to ado repo diff command ([c1d529a](https://github.com/kolatts/pncli/commit/c1d529ae1e5314a32e4d6969400e72941fde5fc5)), closes [#70](https://github.com/kolatts/pncli/issues/70)
* **artifactory:** add Artifactory API support ([#83](https://github.com/kolatts/pncli/issues/83)) ([3797b75](https://github.com/kolatts/pncli/commit/3797b7537734f80ddd5d8a6a55a9c3b054ccd920))
* **checkmarx:** add CxSAST 9.x integration with OAuth2 token exchange ([#118](https://github.com/kolatts/pncli/issues/118)) ([ecd5489](https://github.com/kolatts/pncli/commit/ecd5489a864bc57b2fe5d31a928d50e2c294d414))
* **cli:** add --output-file global option for large command output ([#101](https://github.com/kolatts/pncli/issues/101)) ([f18c6bb](https://github.com/kolatts/pncli/commit/f18c6bbf0a89bde392d89d7c51ea729bf6afda05))
* **docs:** Dark mode ([#74](https://github.com/kolatts/pncli/issues/74)) ([cd90955](https://github.com/kolatts/pncli/commit/cd909559d4c6402cb646e26647c0b3cda5f31b9d))
* **jenkins:** add Jenkins Data Center pipeline integration ([#85](https://github.com/kolatts/pncli/issues/85)) ([3c7ad5c](https://github.com/kolatts/pncli/commit/3c7ad5c9de7289e273724d5d2e45245af0cbad93))
* **site:** reorganize NOTICE file and add hidden easter egg page ([#82](https://github.com/kolatts/pncli/issues/82)) ([abdfed2](https://github.com/kolatts/pncli/commit/abdfed22a04aea9c3a16102386c0682eefc12645))
* **site:** replace dark mode logo invert with dedicated dark variant ([#95](https://github.com/kolatts/pncli/issues/95)) ([112419c](https://github.com/kolatts/pncli/commit/112419ca3410021c9555fcb64835ad60601c1a61))
* **skills:** add ship skill, vitest tests, and pre-commit gate cleanup ([#76](https://github.com/kolatts/pncli/issues/76)) ([f41d674](https://github.com/kolatts/pncli/commit/f41d6740bf995a5607ff4b0dfe07ad2ba9ae1b48))
* **skills:** redux — isolate consumer skills, align to agentskills spec, add --agent/--scope to install ([#107](https://github.com/kolatts/pncli/issues/107)) ([c658520](https://github.com/kolatts/pncli/commit/c658520753b032ba3567fdedc166f47c68359115))
* **udeploy:** IBM UrbanCode Deploy integration with PAT auth ([#86](https://github.com/kolatts/pncli/issues/86)) ([fcef1e0](https://github.com/kolatts/pncli/commit/fcef1e07b1bf7322a7f85ae21ef579dd71028a4b))
* **udeploy:** re-add username/password auth and fix PAT token encoding ([#105](https://github.com/kolatts/pncli/issues/105)) ([922b09f](https://github.com/kolatts/pncli/commit/922b09f538a517a5c2a6530abe0392a20277641e))
* **udeploy:** support username/password basic auth in addition to auth tokens ([#98](https://github.com/kolatts/pncli/issues/98)) ([94b45f5](https://github.com/kolatts/pncli/commit/94b45f53d9f4f395f9a20c2c92ff9c4622eb1192)), closes [#97](https://github.com/kolatts/pncli/issues/97)


### Bug Fixes

* add .mailmap to normalize contributor email identity ([e4d8cce](https://github.com/kolatts/pncli/commit/e4d8cceeb015dea3a949f6d6e9ec2ff0a70364a4))
* **ado:** use 7.1-preview.1 for connectionData endpoint ([3ee99c1](https://github.com/kolatts/pncli/commit/3ee99c1339fcaf24e0a30072b4c9f2b154b45305))
* **ado:** use 7.1-preview.1 for connectionData endpoint ([4122850](https://github.com/kolatts/pncli/commit/4122850b5b4b9e08d09c2e4a3be43ba5f478a061)), closes [#69](https://github.com/kolatts/pncli/issues/69)
* **artifactory:** drop leading slash from API prefix to preserve base URL path ([#94](https://github.com/kolatts/pncli/issues/94)) ([6d64f7f](https://github.com/kolatts/pncli/commit/6d64f7f521c5e93c7c468007c788ec79ff5a5752)), closes [#90](https://github.com/kolatts/pncli/issues/90)
* **bitbucket:** pass bb subcommand to getClient so --project/--repo are resolved ([#92](https://github.com/kolatts/pncli/issues/92)) ([3005dcd](https://github.com/kolatts/pncli/commit/3005dcd79e82ff6c09cc26f42e25ca20d7781d50)), closes [#89](https://github.com/kolatts/pncli/issues/89)
* **jenkins:** handle multi-level folder paths in pipeline commands ([#96](https://github.com/kolatts/pncli/issues/96)) ([1c47b44](https://github.com/kolatts/pncli/commit/1c47b44fb15e2f832d028fc82d9f8e06a5c8afa6)), closes [#91](https://github.com/kolatts/pncli/issues/91)
* **site:** reset Turnstile widget on failed submission ([#88](https://github.com/kolatts/pncli/issues/88)) ([ecc81a4](https://github.com/kolatts/pncli/commit/ecc81a40c90909d1de0103ed7b761fa9a2634368))
* **udeploy:** remove username/password auth, PAT-only ([#103](https://github.com/kolatts/pncli/issues/103)) ([9341e70](https://github.com/kolatts/pncli/commit/9341e7052efba2613757876601899048b22d55e1))
* **udeploy:** rename --version options to avoid root-level Commander.js collision ([#112](https://github.com/kolatts/pncli/issues/112)) ([048bb20](https://github.com/kolatts/pncli/commit/048bb20eb7c6608492c7f5fb0c06bf0349e10c1b))
* **udeploy:** support username+pat as Basic auth credential pair ([#110](https://github.com/kolatts/pncli/issues/110)) ([1e041af](https://github.com/kolatts/pncli/commit/1e041af241d45b3a88847ef522e3eeb375489f46)), closes [#109](https://github.com/kolatts/pncli/issues/109)

## [1.7.0](https://github.com/kolatts/pncli/compare/v1.6.1...v1.7.0) (2026-04-13)


### Features

* migrate function app secrets to Key Vault references ([b578991](https://github.com/kolatts/pncli/commit/b578991be4d4041058eab223f5988c51892e0f57))


### Bug Fixes

* raise IP rate limit to 10 and reload page after submission ([a6b3a3e](https://github.com/kolatts/pncli/commit/a6b3a3e55d16e88354c7a915e502c1da7f851aa2))

## [1.6.1](https://github.com/kolatts/pncli/compare/v1.6.0...v1.6.1) (2026-04-12)


### Bug Fixes

* add repository field to package.json for npm provenance verification ([d5e11c9](https://github.com/kolatts/pncli/commit/d5e11c9f9563a405a75275412467dfbb1923aa6c))

## [1.6.0](https://github.com/kolatts/pncli/compare/v1.5.0...v1.6.0) (2026-04-12)


### Features

* add --output flag to config check command ([#41](https://github.com/kolatts/pncli/issues/41)) ([39ab198](https://github.com/kolatts/pncli/commit/39ab198098ec739060f4dd96cc3e0c24d4e1532e)), closes [#40](https://github.com/kolatts/pncli/issues/40)
* add --repo flag to pncli config set for non-interactive repo config ([ce48d59](https://github.com/kolatts/pncli/commit/ce48d593e8559ae6537a2ee709a5b90c11bba371))
* add 5 multi-tool workflow skills for vulnerability scanning and ticket creation ([a835d03](https://github.com/kolatts/pncli/commit/a835d037f3b51e0cceec624edc3b5e5cb8f8b94f))
* add CLAUDE.md with project conventions and site screenshot requirement ([16a6c52](https://github.com/kolatts/pncli/commit/16a6c52bffdd56c70c5f42b39ead7d57b4995696))
* add denied label and close issue when triage rejects scope ([cc3cba8](https://github.com/kolatts/pncli/commit/cc3cba8ebf8b33e8cec030dcd64d0816f16c1a25))
* add service pills, category grouping, skills install CLI, and provider prompting ([2c29714](https://github.com/kolatts/pncli/commit/2c2971409127560764f40acfa1938c68d143a716))
* Claude issue triage and review response workflows ([#34](https://github.com/kolatts/pncli/issues/34)) ([e429306](https://github.com/kolatts/pncli/commit/e429306fc9c785c4566a7b9cc94640d92bdb2aef))
* surgical skills install, copilot-instructions download, and local-setup skill ([0fd52a7](https://github.com/kolatts/pncli/commit/0fd52a732ee7a53fdca5436b38ea6ec60b6fef57))
* trigger triage on from-website label in addition to claude-triage ([e5ffeb4](https://github.com/kolatts/pncli/commit/e5ffeb4910dc973b9cf3027a8da0704b15fb852e))
* Turnstile CAPTCHA, persistent rate limiting, and Azure Queue for feedback ([#45](https://github.com/kolatts/pncli/issues/45)) ([09a1c2e](https://github.com/kolatts/pncli/commit/09a1c2ec442bba05d20f1a1496dfd8a768c21500))
* vulnerability scanning skills, service pills, skills install CLI, and local-setup ([dd0343d](https://github.com/kolatts/pncli/commit/dd0343d80625309f2717f20bd6d0d2fd27c38b38))


### Bug Fixes

* add job summary, label creation, and label cleanup improvements ([#38](https://github.com/kolatts/pncli/issues/38)) ([f052818](https://github.com/kolatts/pncli/commit/f0528188f0cc90afe53dc72080342370c14496ca))
* address PR review — path traversal guard, gallery fallback, ADO linking ([dce526e](https://github.com/kolatts/pncli/commit/dce526e4caf13af391921ef150cede7821590877))
* allow claude bot PRs through review, skip other bots ([de57067](https://github.com/kolatts/pncli/commit/de570670940e2db4283619581377473c5255df5e))
* allow claude bot to trigger review action via allowed_bots ([3c47ba3](https://github.com/kolatts/pncli/commit/3c47ba35d5f5f7efc18519897a6c2e2a6d8e5963))
* append .git suffix to claude-marketplace URL ([#28](https://github.com/kolatts/pncli/issues/28)) ([554c707](https://github.com/kolatts/pncli/commit/554c707c88e0c70ea0886f54739d2ae552b0fadf))
* mandate gh pr create in triage and improve comment link format ([d5227b8](https://github.com/kolatts/pncli/commit/d5227b88950ccf1a049d500e174887dc8d83569e))
* scope triage concurrency group to label name to prevent cancellation ([2da1286](https://github.com/kolatts/pncli/commit/2da128649c788599c3747157ee848d617be82c41))
* validate project fit from CLAUDE.md before any code changes in triage ([8ab1163](https://github.com/kolatts/pncli/commit/8ab1163c5ddc57cc8dd3c4d7f1ae1dac44818a84))

## [1.5.0](https://github.com/kolatts/pncli/compare/v1.4.0...v1.5.0) (2026-04-11)


### Features

* add permissions configuration for Bash commands in settings ([0fcf3c1](https://github.com/kolatts/pncli/commit/0fcf3c1a6a8496c1f496cc8275643146202602fb))
* add pncli config check command ([#24](https://github.com/kolatts/pncli/issues/24)) ([0c0f251](https://github.com/kolatts/pncli/commit/0c0f25130a0971404c7461b5dc5d548f713a121a))
* bootstrap Astro site and GitHub Pages deploy workflow (Phase 1) ([#19](https://github.com/kolatts/pncli/issues/19)) ([459bee1](https://github.com/kolatts/pncli/commit/459bee14f89493b6f8b4b8b6eff09c76c1fe737d))
* Claude Code skills, ADO diff/build-status, and site Skills section ([#25](https://github.com/kolatts/pncli/issues/25)) ([ba31afd](https://github.com/kolatts/pncli/commit/ba31afda0bfbc591b5f7860f4a70cb39b400ab02))
* pncli GitHub Pages site (Phases 1–5) ([#20](https://github.com/kolatts/pncli/issues/20)) ([72c19bf](https://github.com/kolatts/pncli/commit/72c19bf257df5d867a5d669dedc8eacffa64470b))


### Bug Fixes

* downgrade to .NET 9 — .NET 10 runtime unstable on Linux Consumption ([bf1b9bb](https://github.com/kolatts/pncli/commit/bf1b9bb202743048057557759f960c526917c671))
* drop AspNetCore integration — function uses standard isolated HTTP types ([e6e9658](https://github.com/kolatts/pncli/commit/e6e9658281bf1842741c4d9e38e0cf3f1f5c92fc))
* redirect provision.sh progress output to stderr ([ee13f8b](https://github.com/kolatts/pncli/commit/ee13f8b2ccfd1e704229b4810159178f5b599b6e))
* remove ApplicationInsights package — PerfCounterCollector aborts on Linux ([0ef1d06](https://github.com/kolatts/pncli/commit/0ef1d06664a616e58f091b8fc9b18738eed9cc93))
* **site:** move paperwork monster to hero section, fix DC copy and Artifactory status ([#23](https://github.com/kolatts/pncli/issues/23)) ([01125eb](https://github.com/kolatts/pncli/commit/01125ebfaec0dfa52addea6f50e53de5b7a13163))
* update Azure Functions packages for .NET 10 compatibility ([7cd1ab6](https://github.com/kolatts/pncli/commit/7cd1ab6633999c80b1d997f9a3b71be02436dd18))

## [1.4.0](https://github.com/kolatts/pncli/compare/v1.3.0...v1.4.0) (2026-04-11)


### Features

* Azure DevOps Server integration (work items, repos, PRs, pipelines) ([#15](https://github.com/kolatts/pncli/issues/15)) ([20deffd](https://github.com/kolatts/pncli/commit/20deffdf7fbe8d4b8d23a7a77c7a528360630389))
* consolidate SDElements auth into single connection string ([f8d0b29](https://github.com/kolatts/pncli/commit/f8d0b298983528339a6ba4114d6112be1421125f))


### Bug Fixes

* normalize SDElements host to full base URL in connection string parser ([e1af936](https://github.com/kolatts/pncli/commit/e1af93662c6d9d2617cbdf13ff1d1c4e322783a2))
* suppress git stderr in getRepoRoot to avoid fatal error outside repos ([20d6ee0](https://github.com/kolatts/pncli/commit/20d6ee0804b3c268123375136cd5095bd55b25b8))

## [1.3.0](https://github.com/kolatts/pncli/compare/v1.2.0...v1.3.0) (2026-04-06)


### Features

* Confluence integration + fail() exit fix + TLS bypass ([#10](https://github.com/kolatts/pncli/issues/10)) ([078aea4](https://github.com/kolatts/pncli/commit/078aea4937eff7b72fa8ca89689329e356d23a58))
* SDElements integration — projects, tasks, threats, users ([#13](https://github.com/kolatts/pncli/issues/13)) ([0ea2119](https://github.com/kolatts/pncli/commit/0ea2119259220e9262f36a89e822f5aa980ca4d4))
* SonarQube Server integration with PAT auth ([#12](https://github.com/kolatts/pncli/issues/12)) ([a265c76](https://github.com/kolatts/pncli/commit/a265c76ee7877e70820905c12e25bab672eac8cb))

## [1.2.0](https://github.com/kolatts/pncli/compare/v1.1.0...v1.2.0) (2026-04-05)


### Features

* dep watchdog — pncli deps command group ([#7](https://github.com/kolatts/pncli/issues/7)) ([f76934c](https://github.com/kolatts/pncli/commit/f76934c6e23b8e0f7739c9dc1bb68d1aa2a1b8f0))


### Bug Fixes

* Jira error deserialization, Connection header, and exit codes ([#8](https://github.com/kolatts/pncli/issues/8)) ([798bb43](https://github.com/kolatts/pncli/commit/798bb433e21269011d21bfdba0d8017f3ec76a90))

## [1.1.0](https://github.com/kolatts/pncli/compare/v1.0.1...v1.1.0) (2026-04-05)


### Features

* add PNCLI_EMAIL and PNCLI_USERID as global user identity ([fa611bf](https://github.com/kolatts/pncli/commit/fa611bf0ecadb24c7493faecacab77cb23cea7f1))
* add user identity prompts to config init wizard ([b0f5be5](https://github.com/kolatts/pncli/commit/b0f5be587b344da503c57719114a1aefba9cf561))
* enterprise testing — user identity, Jira v2, husky, v1.1.0 ([08853f2](https://github.com/kolatts/pncli/commit/08853f23a48cea90de3506cb2da1cfc0144d60a2))
* Jira custom fields + auto-generated copilot docs ([#6](https://github.com/kolatts/pncli/issues/6)) ([390511f](https://github.com/kolatts/pncli/commit/390511fb4e971b14a2d00847aa1bbed09c15f348))
* switch Jira to API v2 with Bearer token auth ([e6e0b09](https://github.com/kolatts/pncli/commit/e6e0b09fe6b22a932e7b0058bca179058c07183b))

## [1.0.1](https://github.com/kolatts/pncli/compare/v1.0.0...v1.0.1) (2026-04-04)


### Bug Fixes

* rename package to @kolatts/pncli and add --access=public for npm publish ([f85a6b5](https://github.com/kolatts/pncli/commit/f85a6b510f7eb938c1a4b54c8813ecb1e3a3826c))

## 1.0.0 (2026-04-04)


### Features

* add HTTP client and Bitbucket Server integration 🔌 ([e1ecace](https://github.com/kolatts/pncli/commit/e1ecace58b9452c69f8e492248cd6f39061bb88a))
* add Jira Data Cloud integration 🎫 ([0c9b30d](https://github.com/kolatts/pncli/commit/0c9b30d82438c4e0b82963c05d6e133cc8e416e7))
* scaffold Phase 1 — skeleton, config system, git commands 🏗️ ([25a7aeb](https://github.com/kolatts/pncli/commit/25a7aeb933d068eb44cc1a15baa31ee5534638c6))


### Bug Fixes

* remove invalid package-name input from release-please-action@v4 ([85215e4](https://github.com/kolatts/pncli/commit/85215e4cf22972f766d33e23b9a699e534685eff))

## Changelog

All notable changes to pncli will be documented in this file.

See [Conventional Commits](https://www.conventionalcommits.org/) for commit guidelines.
This file is auto-managed by [release-please](https://github.com/googleapis/release-please).
