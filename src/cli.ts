// TLS verification is disabled by default — most enterprise Data Center installs
// sit behind corporate SSL inspection proxies that break standard certificate chains.
// To opt back in: set PNCLI_VERIFY_TLS=1
if (!process.env.PNCLI_VERIFY_TLS) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import { Command } from 'commander';
import { createRequire } from 'module';
import { setGlobalOptions, setGlobalUser } from './lib/output.js';
import { ExitCode } from './lib/exitCodes.js';
import { loadConfig } from './lib/config.js';
import { registerGitCommands } from './services/git/commands.js';
import { registerJiraCommands } from './services/jira/commands.js';
import { registerBitbucketCommands } from './services/bitbucket/commands.js';
import { registerConfluenceCommands } from './services/confluence/commands.js';
import { registerSonarCommands } from './services/sonar/commands.js';
import { registerSdeCommands } from './services/sde/commands.js';
import { registerDepsCommands } from './services/deps/commands.js';
import { registerConfigCommands } from './services/config/commands.js';
import { registerAdoCommands } from './services/ado/commands/index.js';
import { registerJenkinsCommands } from './services/jenkins/commands.js';
import { registerArtifactoryCommands } from './services/artifactory/commands.js';
import { registerUdeployCommands } from './services/udeploy/commands.js';
import { registerCheckmarxCommands } from './services/checkmarx/commands.js';
import { registerServiceNowCommands } from './services/servicenow/commands.js';
import { registerContrastCommands } from './services/contrast/commands.js';
import { registerSonatypeIqCommands } from './services/sonatypeiq/commands.js';
import { registerSkillsCommands } from './services/skills/commands.js';
import { registerJwtCommands } from './services/jwt/commands.js';
import { registerOpenShiftCommands } from './services/openshift/commands.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pkg = require('../package.json') as any;

const TAGLINE = 'One command does what three meetings couldn\'t.';

const program = new Command();

program
  .name('pncli')
  .description(`The Paperwork Nightmare CLI — ${TAGLINE}`)
  .version(`${pkg.version as string} — ${TAGLINE}`, '-v, --version')
  .option('--pretty', 'Human-readable formatted output', false)
  .option('--verbose', 'Include full response metadata', false)
  .option('--debug', 'Print diagnostic traces (method, URL, status) for all API calls — does not log credentials', false)
  .option('--dry-run', 'Print API requests without executing', false)
  .option('--config <path>', 'Override global config file location')
  .option('--output-file <path>', 'Write JSON output to file instead of stdout');

// Propagate global options and user identity before any command runs
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.optsWithGlobals();
  setGlobalOptions({
    pretty: Boolean(opts.pretty),
    verbose: Boolean(opts.verbose),
    debug: Boolean(opts.debug),
    outputFile: opts.outputFile as string | undefined
  });
  try {
    const config = loadConfig({ configPath: opts.config as string | undefined });
    setGlobalUser(config.user);
  } catch {
    // config may not exist yet (e.g. during `config init`) — silently skip
  }
});

registerGitCommands(program);
registerJiraCommands(program);
registerBitbucketCommands(program);
registerConfluenceCommands(program);
registerSonarCommands(program);
registerSdeCommands(program);
registerDepsCommands(program);
registerConfigCommands(program);
registerAdoCommands(program);
registerJenkinsCommands(program);
registerArtifactoryCommands(program);
registerUdeployCommands(program);
registerCheckmarxCommands(program);
registerServiceNowCommands(program);
registerContrastCommands(program);
registerSonatypeIqCommands(program);
registerSkillsCommands(program);
registerJwtCommands(program);
registerOpenShiftCommands(program);

program.addHelpText('after', `
Services:
  git          Local git operations (status, diff, log, branch)
  deps         Dependency scanning, CVE detection, license auditing
  jira         Jira Data Cloud
  bitbucket    Bitbucket Server
  confluence   Confluence
  sonar        SonarQube Server (quality gates, issues, metrics, hotspots)
  sde          SDElements (threat modeling, countermeasures, compliance)
  ado          Azure DevOps Server (work items, repos, PRs, pipelines)
  jenkins      Jenkins Data Center (jobs, builds, logs)
  artifactory  Artifactory (repos, artifact search, build info, properties)
  udeploy      IBM UrbanCode Deploy (component versions, deployment processes)
  checkmarx    Checkmarx CxSAST (projects, scans, scan statistics)
  servicenow   ServiceNow (change requests)
  contrast     Contrast IAST (applications, vulnerability findings)
  sonatypeiq   Sonatype IQ Server (applications, organizations, policies)
  openshift    OpenShift / Kubernetes (pods, events, logs, metrics)
  config       Manage pncli configuration
  skills       Download and manage Claude Code skills
  jwt          JWT token utilities (decode header and payload)
`);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (process.exitCode !== undefined) return; // already handled by fail() or dry-run
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = ExitCode.GENERAL_ERROR;
});
