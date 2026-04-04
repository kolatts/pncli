import { Command } from 'commander';
import { success } from '../../lib/output.js';

export function registerJiraCommands(program: Command): void {
  const jira = program
    .command('jira')
    .description('Jira Data Cloud operations')
    .action(() => {
      success(
        { message: 'Coming soon — the nightmare never ends.' },
        'jira',
        'stub',
        Date.now()
      );
    });

  // Override --help to also show stub message
  jira.addHelpText('after', '\nStatus: Coming soon — the nightmare never ends.');
}
