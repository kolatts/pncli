import { Command } from 'commander';
import { getAdoContext } from '../helpers.js';
import { success, fail } from '../../../lib/output.js';

export function registerAdoProjectCommands(ado: Command): void {
  const project = ado
    .command('project')
    .description('Azure DevOps project and collection operations');

  project
    .command('list-collections')
    .description('List all project collections on the server')
    .action(async () => {
      const start = Date.now();
      try {
        const { coreClient } = getAdoContext(ado);
        const data = await coreClient.listCollections();
        success(data, 'ado', 'project-list-collections', start);
      } catch (err) { fail(err, 'ado', 'project-list-collections', start); }
    });

  project
    .command('list')
    .description('List team projects in a collection')
    .action(async () => {
      const start = Date.now();
      try {
        const { collection, coreClient } = getAdoContext(ado);
        const data = await coreClient.listProjects(collection);
        success(data, 'ado', 'project-list', start);
      } catch (err) { fail(err, 'ado', 'project-list', start); }
    });

  project
    .command('get')
    .description('Get a team project by name')
    .requiredOption('--name <project>', 'Project name')
    .action(async (opts: { name: string }) => {
      const start = Date.now();
      try {
        const { collection, coreClient } = getAdoContext(ado);
        const data = await coreClient.getProject(collection, opts.name);
        success(data, 'ado', 'project-get', start);
      } catch (err) { fail(err, 'ado', 'project-get', start); }
    });
}
