import { Command } from 'commander';
import { success } from '../../lib/output.js';

export function registerSonarCommands(program: Command): void {
  program
    .command('sonar')
    .description('SonarQube operations')
    .action(() => {
      success(
        { message: 'Coming soon — the nightmare never ends.' },
        'sonar',
        'stub',
        Date.now()
      );
    });
}
