#!/usr/bin/env node
/**
 * Parses pncli command registrations from src/services/ TypeScript source files
 * and generates site/src/content/docs/commands.mdx for the site commands page.
 *
 * Strategy: split each commands.ts file on `.action(` to get per-command blocks,
 * then extract the last `.command('name')`, `.description('text')`, and all
 * `.option`/`.requiredOption` calls from each block.
 *
 * Nested subgroups (e.g. `const entities = dynatrace.command('entities')` with
 * leaves registered as `entities.command('list')`) are handled by a first pass
 * that maps each subgroup variable to its path segments. A variable whose parent
 * is untracked (`program`, or a Command passed in as a function parameter) is the
 * file's root group — its own name is assumed to be covered by the SERVICES
 * prefix, so its path is empty. Leaf names are then built as
 * `pncli <prefix> <subgroup path...> <leaf>`, which lets one file mix flat
 * commands and nested subgroups (dynatrace, checkmarx, servicenow, contrast).
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
  { name: 'Doctor',                       file: 'src/services/doctor/commands.ts',         prefix: 'doctor' },
  { name: 'Azure DevOps — Work Items',    file: 'src/services/ado/commands/work.ts',       prefix: 'ado work' },
  { name: 'Azure DevOps — Repos & PRs',  file: 'src/services/ado/commands/repo.ts',       prefix: 'ado repo' },
  { name: 'Azure DevOps — Pipelines',    file: 'src/services/ado/commands/pipeline.ts',   prefix: 'ado pipeline' },
  { name: 'Azure DevOps — Projects',     file: 'src/services/ado/commands/project.ts',    prefix: 'ado project' },
  { name: 'Jenkins',                      file: 'src/services/jenkins/commands.ts',        prefix: 'jenkins' },
  { name: 'JFrog Artifactory',           file: 'src/services/artifactory/commands.ts',    prefix: 'artifactory' },
  { name: 'Checkmarx',                   file: 'src/services/checkmarx/commands.ts',      prefix: 'checkmarx' },
  { name: 'GitHub',                      file: 'src/services/github/commands.ts',         prefix: 'github' },
  { name: 'ServiceNow',                  file: 'src/services/servicenow/commands.ts',     prefix: 'servicenow' },
  { name: 'Contrast IAST',               file: 'src/services/contrast/commands.ts',       prefix: 'contrast' },
  { name: 'Sonatype IQ',                 file: 'src/services/sonatypeiq/commands.ts',     prefix: 'sonatypeiq' },
  { name: 'OpenShift / Kubernetes',      file: 'src/services/openshift/commands.ts',      prefix: 'openshift' },
  { name: 'Dynatrace',                   file: 'src/services/dynatrace/commands.ts',      prefix: 'dynatrace' },
  { name: 'LogScale',                    file: 'src/services/logscale/commands.ts',       prefix: 'logscale' },
  { name: 'Split.IO',                    file: 'src/services/splitio/commands.ts',        prefix: 'splitio' },
  { name: 'Figma',                       file: 'src/services/figma/commands.ts',          prefix: 'figma' },
  { name: 'Skills',                      file: 'src/services/skills/commands.ts',         prefix: 'skills' },
  { name: 'JWT',                         file: 'src/services/jwt/commands.ts',            prefix: 'jwt' },
];

// Command groups hidden from the public site. The CLI still ships these commands;
// they just don't render on /commands/. Remove a prefix here to re-add its group.
const SKIP_PREFIXES = new Set([]);

// Site-only text scrubs applied to command/option descriptions so hidden services
// aren't mentioned in other groups' docs. The CLI source text is unchanged.
// Each entry: [pattern, replacement]. Remove an entry to restore the mention.
const DESCRIPTION_SCRUBS = [];

// Wrap flag-like tokens (--foo, -x) in backticks so they render as code spans.
// Without this, remark turns "--" in prose into an em dash. Skips text already
// inside inline code spans to avoid double-wrapping.
function scrubDescription(text) {
  for (const [pattern, replacement] of DESCRIPTION_SCRUBS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

// Escape raw angle brackets and curly braces in prose so the MDX/JSX parser
// doesn't mistake them for markup and fail the whole site build. A description
// mentioning a placeholder like "<from>" reads as an unclosed tag, and one
// mentioning a shape like "{treatment, size}" reads as a JSX expression that
// blows up at render time with "treatment is not defined".
function escapeMdxChars(text) {
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

function codeifyFlags(text) {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) => {
      if (i % 2 === 1) return part; // already an inline code span
      return escapeMdxChars(part).replace(/(^|[\s(,"'/])(--?[a-zA-Z][\w-]*)/g, '$1`$2`');
    })
    .join('');
}

// Matches `.command('name')` with optional receiver variable and optional
// `const <var> =` declaration. Whitespace (incl. newlines) may separate the
// receiver from `.command(`, e.g. `entities\n  .command('list')`.
const COMMAND_RE = /(?:const\s+(\w+)\s*=\s*)?(\w+)\s*\.command\s*\(\s*'([^']+)'\s*\)/g;

function extractCommands(filePath, prefix) {
  const content = readFileSync(filePath, 'utf8');
  const commands = [];

  // Pass 1: map subgroup variables to their path segments.
  // `const <var> = <parent>.command('<name>')` — if <parent> is tracked, the
  // subgroup's path is the parent's path + name; otherwise <var> is the file's
  // root group and its name is already covered by the SERVICES prefix.
  const groupPaths = new Map();
  for (const m of content.matchAll(COMMAND_RE)) {
    const [, declaredVar, parentVar, name] = m;
    if (!declaredVar) continue;
    groupPaths.set(
      declaredVar,
      groupPaths.has(parentVar) ? [...groupPaths.get(parentVar), name] : []
    );
  }

  // Pass 2: split on .action( so each segment ends with the registration for one command.
  const segments = content.split(/\.action\s*\(/);

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];

    // Find all .command('name') in this segment; the last one that is not a
    // subgroup declaration is the leaf subcommand.
    const cmdMatches = [...segment.matchAll(COMMAND_RE)].filter(m => !m[1]);
    if (cmdMatches.length === 0) continue;
    const lastCmd = cmdMatches[cmdMatches.length - 1];
    const receiverVar = lastCmd[2];
    const cmdName = [...(groupPaths.get(receiverVar) ?? []), lastCmd[3]].join(' ');

    // Slice from the last .command('name') onwards to find description and options.
    const afterCmd = segment.slice(lastCmd.index + lastCmd[0].length);

    const descMatch = afterCmd.match(/\.description\s*\(\s*'([^']+)'\s*\)/);
    if (!descMatch) continue;
    const description = scrubDescription(descMatch[1]);

    const options = [];
    for (const m of afterCmd.matchAll(/\.(requiredOption|option)\s*\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
      options.push({ flag: m[2], description: scrubDescription(m[3]), required: m[1] === 'requiredOption' });
    }

    // A top-level command (e.g. `pncli doctor`) registers itself as its own
    // leaf, so the prefix and command name coincide — render it once.
    const fullName = cmdName === prefix ? `pncli ${prefix}` : `pncli ${prefix} ${cmdName}`;
    commands.push({
      name: fullName.replace(/\s+/g, ' ').trim(),
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
      lines.push(codeifyFlags(cmd.description));
      lines.push('');

      if (cmd.options.length > 0) {
        for (const opt of cmd.options) {
          const req = opt.required ? ' **required**' : '';
          lines.push(`- \`${opt.flag}\`${req} — ${codeifyFlags(opt.description)}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

const services = SERVICES.filter(({ prefix }) => !SKIP_PREFIXES.has(prefix)).map(({ name, file, prefix }) => ({
  name,
  commands: extractCommands(join(root, file), prefix),
}));

const total = services.reduce((n, s) => n + s.commands.length, 0);
const mdx = buildMdx(services);
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, mdx);
console.log(`parse-commands: wrote ${total} command(s) across ${services.length} service(s) → commands.mdx`);
