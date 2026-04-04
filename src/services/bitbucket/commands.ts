import { Command } from 'commander';
import { success } from '../../lib/output.js';

export function registerBitbucketCommands(program: Command): void {
  const bb = program
    .command('bitbucket')
    .description('Bitbucket Server operations')
    .action(() => {
      success(
        { message: 'Coming soon — the nightmare never ends.' },
        'bitbucket',
        'stub',
        Date.now()
      );
    });

  bb.addHelpText('after', '\nStatus: Coming soon — the nightmare never ends.');
}
