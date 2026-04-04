import { Command } from 'commander';
import { success } from '../../lib/output.js';

export function registerConfluenceCommands(program: Command): void {
  program
    .command('confluence')
    .description('Confluence operations')
    .action(() => {
      success(
        { message: 'Coming soon — the nightmare never ends.' },
        'confluence',
        'stub',
        Date.now()
      );
    });
}
