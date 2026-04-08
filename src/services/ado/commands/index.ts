import { Command } from 'commander';
import { registerAdoProjectCommands } from './project.js';
import { registerAdoWorkCommands } from './work.js';
import { registerAdoRepoCommands } from './repo.js';
import { registerAdoPipelineCommands } from './pipeline.js';
import { getAdoContext } from '../helpers.js';
import { success, fail } from '../../../lib/output.js';

export function registerAdoCommands(program: Command): void {
  const ado = program
    .command('ado')
    .description('Azure DevOps Server operations')
    .option('--collection <name>', 'Azure DevOps collection (organization)')
    .option('--organization <name>', 'Alias for --collection')
    .option('--project <name>', 'Azure DevOps team project')
    .option('--repo <name>', 'Azure DevOps git repository name');

  // ── Top-level commands ─────────────────────────────────────────────

  ado
    .command('whoami')
    .description('Show current authenticated user')
    .action(async () => {
      const start = Date.now();
      try {
        const { collection, coreClient } = getAdoContext(ado);
        const data = await coreClient.getConnectionData(collection);
        success(data, 'ado', 'whoami', start);
      } catch (err) { fail(err, 'ado', 'whoami', start); }
    });

  ado
    .command('connection-data')
    .description('Show raw connection data from the ADO server')
    .action(async () => {
      const start = Date.now();
      try {
        const { collection, coreClient } = getAdoContext(ado);
        const data = await coreClient.getConnectionData(collection);
        success(data, 'ado', 'connection-data', start);
      } catch (err) { fail(err, 'ado', 'connection-data', start); }
    });

  // ── Subcommand groups ──────────────────────────────────────────────

  registerAdoProjectCommands(ado);
  registerAdoWorkCommands(ado);
  registerAdoRepoCommands(ado);
  registerAdoPipelineCommands(ado);
}
