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
import { registerDepsCommands } from './services/deps/commands.js';
import { registerConfigCommands } from './services/config/commands.js';

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
  .option('--dry-run', 'Print API requests without executing', false)
  .option('--config <path>', 'Override global config file location');

// Propagate global options and user identity before any command runs
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.optsWithGlobals();
  setGlobalOptions({
    pretty: Boolean(opts.pretty),
    verbose: Boolean(opts.verbose)
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
registerDepsCommands(program);
registerConfigCommands(program);

program.addHelpText('after', `
Services:
  git          Local git operations (status, diff, log, branch)
  deps         Dependency scanning, CVE detection, license auditing
  jira         Jira Data Cloud
  bitbucket    Bitbucket Server
  confluence   Confluence
  sonar        SonarQube (coming soon)
  config       Manage pncli configuration
`);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (process.exitCode !== undefined) return; // already handled by fail() or dry-run
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = ExitCode.GENERAL_ERROR;
});
