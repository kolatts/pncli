import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { SharepointClient } from './client.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

function getClient(program: Command, siteOverride?: string): SharepointClient {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config as string | undefined });
  if (!config.sharepoint.baseUrl) throw new PncliError('SharePoint not configured. Run: pncli config init');
  const http = createHttpClient(config, Boolean(opts.dryRun));
  const siteUrl = siteOverride ?? config.sharepoint.baseUrl;
  return new SharepointClient(http, siteUrl);
}

export function registerSharepointCommands(program: Command): void {
  const sharepoint = program.command('sharepoint').description('Microsoft SharePoint operations');
  const site = sharepoint.command('site').description('Site operations');
  const list = sharepoint.command('list').description('List and document library operations');

  site
    .command('get')
    .description('Get site metadata')
    .option('--site <url>', 'Site URL (overrides configured baseUrl)')
    .action(async (opts: { site?: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program, opts.site);
        const data = await client.getSite();
        success(data, 'sharepoint', 'site-get', start);
      } catch (err) { fail(err, 'sharepoint', 'site-get', start); }
    });

  list
    .command('list')
    .description('List all lists and document libraries in a site')
    .option('--site <url>', 'Site URL (overrides configured baseUrl)')
    .action(async (opts: { site?: string }) => {
      const start = Date.now();
      try {
        const client = getClient(program, opts.site);
        const data = await client.listLists();
        success(data, 'sharepoint', 'list-list', start);
      } catch (err) { fail(err, 'sharepoint', 'list-list', start); }
    });

  list
    .command('get-items')
    .description('Get items from a list or document library')
    .requiredOption('--list <title>', 'List or library title')
    .option('--site <url>', 'Site URL (overrides configured baseUrl)')
    .option('--top <n>', 'Maximum number of items to return (default 100)', '100')
    .action(async (opts: { list: string; site?: string; top: string }) => {
      const start = Date.now();
      try {
        const top = parseInt(opts.top, 10);
        if (isNaN(top) || top <= 0) throw new PncliError(`Invalid --top "${opts.top}". Expected a positive integer.`, 1);
        const client = getClient(program, opts.site);
        const data = await client.getListItems(opts.list, top);
        success(data, 'sharepoint', 'list-get-items', start);
      } catch (err) { fail(err, 'sharepoint', 'list-get-items', start); }
    });
}
