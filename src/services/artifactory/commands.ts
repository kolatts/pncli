import { Command } from 'commander';
import { success } from '../../lib/output.js';

export function registerArtifactoryCommands(program: Command): void {
  program
    .command('artifactory')
    .description('Artifactory operations')
    .action(() => {
      success(
        { message: 'Coming soon — the nightmare never ends.' },
        'artifactory',
        'stub',
        Date.now()
      );
    });
}
