#!/usr/bin/env node
/**
 * Parses pncli command registrations from src/services/ TypeScript source files
 * and generates site/src/content/docs/commands.mdx for the site commands page.
 *
 * Strategy: split each commands.ts file on `.action(` to get per-command blocks,
 * then extract the last `.command('name')`, `.description('text')`, and all
 * `.option`/`.requiredOption` calls from each block.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const outDir = join(__dirname, '../src/content/docs');
const outFile = join(outDir, 'commands.mdx');

// Each entry maps a commands.ts file to its CLI prefix (the full path before the leaf subcommand).
// For nested subgroups (e.g. jenkins > pipeline > cmd), set prefix to include all parent groups.
const SERVICES = [
  { name: 'Git',                          file: 'src/services/git/commands.ts',            prefix: 'git' },
  { name: 'Jira',                         file: 'src/services/jira/commands.ts',           prefix: 'jira' },
  { name: 'Bitbucket',                    file: 'src/services/bitbucket/commands.ts',      prefix: 'bitbucket' },
  { name: 'Confluence',                   file: 'src/services/confluence/commands.ts',     prefix: 'confluence' },
  { name: 'SonarQube',                    file: 'src/services/sonar/commands.ts',          prefix: 'sonar' },
  { name: 'SDElements',                   file: 'src/services/sde/commands.ts',            prefix: 'sde' },
  { name: 'Dependencies',                 file: 'src/services/deps/commands.ts',           prefix: 'deps' },
  { name: 'Config',                       file: 'src/services/config/commands.ts',         prefix: 'config' },
  { name: 'Azure DevOps — Work Items',    file: 'src/services/ado/commands/work.ts',       prefix: 'ado work' },
  { name: 'Azure DevOps — Repos & PRs',  file: 'src/services/ado/commands/repo.ts',       prefix: 'ado repo' },
  { name: 'Azure DevOps — Pipelines',    file: 'src/services/ado/commands/pipeline.ts',   prefix: 'ado pipeline' },
  { name: 'Azure DevOps — Projects',     file: 'src/services/ado/commands/project.ts',    prefix: 'ado project' },
  { name: 'Jenkins',                      file: 'src/services/jenkins/commands.ts',        prefix: 'jenkins pipeline' },
  { name: 'JFrog Artifactory',           file: 'src/services/artifactory/commands.ts',    prefix: 'artifactory' },
  { name: 'IBM UrbanCode Deploy',        file: 'src/services/udeploy/commands.ts',        prefix: 'udeploy' },
  { name: 'Checkmarx',                   file: 'src/services/checkmarx/commands.ts',      prefix: 'checkmarx' },
];

function extractCommands(filePath, prefix) {
  const content = readFileSync(filePath, 'utf8');
  const commands = [];

  // Split on .action( so each segment ends with the registration for one command.
  const segments = content.split(/\.action\s*\(/);

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];

    // Find all .command('name') in this segment; take the last one — that's the leaf subcommand.
    const cmdMatches = [...segment.matchAll(/\.command\s*\(\s*'([^']+)'\s*\)/g)];
    if (cmdMatches.length === 0) continue;
    const lastCmd = cmdMatches[cmdMatches.length - 1];
    const cmdName = lastCmd[1];

    // Slice from the last .command('name') onwards to find description and options.
    const afterCmd = segment.slice(lastCmd.index + lastCmd[0].length);

    const descMatch = afterCmd.match(/\.description\s*\(\s*'([^']+)'\s*\)/);
    if (!descMatch) continue;
    const description = descMatch[1];

    const options = [];
    for (const m of afterCmd.matchAll(/\.(requiredOption|option)\s*\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
      options.push({ flag: m[2], description: m[3], required: m[1] === 'requiredOption' });
    }

    commands.push({
      name: `pncli ${prefix} ${cmdName}`.replace(/\s+/g, ' ').trim(),
      description,
      options,
    });
  }

  return commands;
}

function buildMdx(services) {
  const lines = [
    '---',
    'title: "Command Reference"',
    'description: "Complete reference for all pncli commands, flags, and options. Auto-generated from source."',
    `generatedAt: "${new Date().toISOString()}"`,
    '---',
    '',
    'All commands return structured JSON to stdout. Check the `ok` field — `false` means an error occurred and the `error` field has details.',
    '',
    'Flags marked **required** must be supplied. All others are optional.',
    '',
  ];

  for (const { name, commands } of services) {
    if (commands.length === 0) continue;

    lines.push(`## ${name}`, '');

    for (const cmd of commands) {
      lines.push(`### \`${cmd.name}\``);
      lines.push('');
      lines.push(cmd.description);
      lines.push('');

      if (cmd.options.length > 0) {
        for (const opt of cmd.options) {
          const req = opt.required ? ' **required**' : '';
          lines.push(`- \`${opt.flag}\`${req} — ${opt.description}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

const services = SERVICES.map(({ name, file, prefix }) => ({
  name,
  commands: extractCommands(join(root, file), prefix),
}));

const total = services.reduce((n, s) => n + s.commands.length, 0);
const mdx = buildMdx(services);
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, mdx);
console.log(`parse-commands: wrote ${total} command(s) across ${services.length} service(s) → commands.mdx`);
