import { Command } from 'commander';
import { success, fail, warn } from '../../lib/output.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { select } from '@inquirer/prompts';
import { writeGlobalConfig, getGlobalConfigPath } from '../../lib/config.js';
import type { GlobalConfig } from '../../types/config.js';

const AGENT_PATHS: Record<string, { project: string; user: string }> = {
  'github-copilot': { project: '.agents/skills',  user: path.join(os.homedir(), '.copilot/skills') },
  'claude-code':    { project: '.claude/skills',   user: path.join(os.homedir(), '.claude/skills') },
};

// Resolve the bundled skills directory relative to this file (dist/cli.js → ../skills)
function getBundledSkillsDir(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(thisFile), '..', 'skills');
  } catch {
    return '';
  }
}

export function registerSkillsCommands(program: Command): void {
  const skills = program.command('skills').description('Manage pncli Claude Code skills');

  skills
    .command('install')
    .description('Install pncli skills into the current repo')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code', 'github-copilot')
    .option('--scope <scope>', 'Installation scope: project | user', 'project')
    .option('--target <dir>', 'Override install directory (ignores --agent and --scope)')

    .action((opts: { agent: string; scope: string; target?: string }) => {
      const start = Date.now();
      try {
        let targetDir: string;
        if (opts.target) {
          targetDir = path.resolve(opts.target);
        } else {
          const agentConfig = AGENT_PATHS[opts.agent];
          if (!agentConfig) {
            throw new Error(`Unknown agent: "${opts.agent}". Use: ${Object.keys(AGENT_PATHS).join(' | ')}`);
          }
          const scopePath = opts.scope === 'user' ? agentConfig.user : agentConfig.project;
          targetDir = path.resolve(scopePath);
        }

        const resolvedTarget = path.resolve(targetDir);
        const bundledDir = getBundledSkillsDir();
        let skillDirs: string[] = [];

        if (bundledDir !== '') {
          try {
            skillDirs = fs.readdirSync(bundledDir).filter(name =>
              fs.existsSync(path.join(bundledDir, name, 'SKILL.md'))
            );
          } catch { /* bundledDir not readable */ }
        }

        if (skillDirs.length === 0) {
          throw new Error('No bundled skills found. Reinstall pncli to get the latest version: npm install -g @kolatts/pncli');
        }

        const installed: string[] = [];
        const failed: string[] = [];

        // Remove only pncli-managed skills (not user-created ones)
        for (const skillName of skillDirs) {
          const existingDir = path.resolve(targetDir, skillName);
          if (!existingDir.startsWith(resolvedTarget + path.sep)) continue;
          if (fs.existsSync(existingDir)) {
            fs.rmSync(existingDir, { recursive: true, force: true });
          }
        }

        warn(`Installing ${skillDirs.length} bundled skill(s) to ${targetDir}...`);

        for (const skillName of skillDirs) {
          const skillDir = path.resolve(targetDir, skillName);
          if (!skillDir.startsWith(resolvedTarget + path.sep)) {
            failed.push(skillName);
            continue;
          }

          try {
            const content = fs.readFileSync(path.join(bundledDir, skillName, 'SKILL.md'), 'utf8');
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');
            installed.push(skillName);
          } catch {
            failed.push(skillName);
          }
        }

        warn(`Installed ${installed.length} skill(s) to ${targetDir}`);
        if (failed.length > 0) {
          warn(`Failed to install: ${failed.join(', ')}`);
        }

        success({
          installed,
          failed,
          target: targetDir,
          total: installed.length,
          agent: opts.target ? 'custom' : opts.agent,
          scope: opts.target ? 'custom' : opts.scope,
          source: 'bundled',
        }, 'skills', 'install', start);
      } catch (err) {
        fail(err, 'skills', 'install', start);
      }
    });

  skills
    .command('list')
    .description('List locally installed skills')
    .option('--agent <agent>', 'Target agent host: github-copilot | claude-code', 'github-copilot')
    .option('--scope <scope>', 'Installation scope: project | user', 'project')
    .option('--target <dir>', 'Override skills directory to scan')
    .action((opts: { agent: string; scope: string; target?: string }) => {
      const start = Date.now();
      try {
        let targetDir: string;
        if (opts.target) {
          targetDir = path.resolve(opts.target);
        } else {
          const agentConfig = AGENT_PATHS[opts.agent];
          if (!agentConfig) {
            throw new Error(`Unknown agent: "${opts.agent}". Use: ${Object.keys(AGENT_PATHS).join(' | ')}`);
          }
          const scopePath = opts.scope === 'user' ? agentConfig.user : agentConfig.project;
          targetDir = path.resolve(scopePath);
        }

        if (!fs.existsSync(targetDir)) {
          success({ skills: [], message: `No skills directory found at ${targetDir}. Run: pncli skills install` }, 'skills', 'list', start);
          return;
        }

        const skillDirs = fs.readdirSync(targetDir).filter(name => {
          const skillPath = path.join(targetDir, name, 'SKILL.md');
          return fs.existsSync(skillPath);
        });

        const skillsList = skillDirs.map(name => {
          const content = fs.readFileSync(path.join(targetDir, name, 'SKILL.md'), 'utf8');
          const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          const data: Record<string, string> = {};
          const metadata: Record<string, string> = {};
          if (frontmatter) {
            let inMetadata = false;
            for (const line of frontmatter[1].split('\n')) {
              if (line.trimEnd() === 'metadata:') { inMetadata = true; continue; }
              if (inMetadata && line.startsWith('  ')) {
                const colonIdx = line.indexOf(':');
                if (colonIdx !== -1) {
                  metadata[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
                }
                continue;
              }
              inMetadata = false;
              const colonIdx = line.indexOf(':');
              if (colonIdx === -1) continue;
              data[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
            }
          }
          return {
            name: data.name || name,
            slug: name,
            category: metadata.category || data.category || 'other',
            services: metadata.services || data.services || '',
            providers: metadata.providers || data.providers || 'none',
            userInvocable: data['user-invocable'] === 'true',
          };
        });

        success({ skills: skillsList, total: skillsList.length }, 'skills', 'list', start);
      } catch (err) {
        fail(err, 'skills', 'list', start);
      }
    });

  const marketplace = skills.command('marketplace').description('Manage a Bitbucket-hosted skills marketplace');

  marketplace
    .command('setup')
    .description('Clone a skills marketplace repo and register it in global config')
    .argument('<url>', 'Git clone URL of the marketplace repository')
    .argument('<localPath>', 'Local directory to clone the marketplace into')
    .option('--branch <branch>', 'Branch to clone', 'master')
    .action(async (url: string, localPath: string, opts: { branch: string }) => {
      const start = Date.now();
      try {
        const resolvedPath = path.resolve(localPath);

        const hasGit = fs.existsSync(path.join(resolvedPath, '.git'));
        if (fs.existsSync(resolvedPath) && !hasGit && fs.readdirSync(resolvedPath).length > 0) {
          throw new Error(`Directory already exists and is not a git repo: ${resolvedPath}`);
        }
        if (hasGit) {
          warn(`Directory already contains a git repo at ${resolvedPath} — skipping clone, updating config only.`);
        } else {
          warn(`Cloning ${url} (branch: ${opts.branch}) → ${resolvedPath}...`);
          execFileSync('git', ['clone', '--branch', opts.branch, url, resolvedPath], { stdio: 'inherit' });
        }

        const configPath = getGlobalConfigPath();
        let existing: GlobalConfig = {};
        try {
          existing = JSON.parse(fs.readFileSync(configPath, 'utf8')) as GlobalConfig;
        } catch { /* config file may not exist yet */ }

        existing.marketplace = { repoUrl: url, localPath: resolvedPath };
        writeGlobalConfig(existing, configPath);

        success({ repoUrl: url, localPath: resolvedPath, branch: opts.branch }, 'skills', 'marketplace-setup', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-setup', start);
      }
    });

  marketplace
    .command('sync')
    .description('Pull latest marketplace content and install a plugin\'s skills')
    .argument('[plugin]', 'Plugin name to install (skips interactive selection)')
    .option('--claude', 'Install to ~/.claude/skills instead of ~/.agents/skills')
    .action(async (plugin: string | undefined, opts: { claude?: boolean }) => {
      const start = Date.now();
      try {
        const configPath = getGlobalConfigPath();
        let globalConfig: GlobalConfig = {};
        try {
          globalConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as GlobalConfig;
        } catch { /* ignore */ }

        const marketplacePath = globalConfig.marketplace?.localPath;
        if (!marketplacePath || !fs.existsSync(marketplacePath)) {
          throw new Error('Marketplace not configured. Run: pncli skills marketplace setup <url> <localPath>');
        }

        warn('Fetching latest marketplace content...');
        execFileSync('git', ['-C', marketplacePath, 'fetch'], { stdio: 'inherit' });
        execFileSync('git', ['-C', marketplacePath, 'pull'], { stdio: 'inherit' });

        // Resolve plugin list from marketplace.json, falling back to directory scan
        const marketplaceJsonPath = path.join(marketplacePath, '.claude-plugin', 'marketplace.json');
        let pluginChoices: { name: string; description: string }[] = [];

        if (fs.existsSync(marketplaceJsonPath)) {
          const meta = JSON.parse(fs.readFileSync(marketplaceJsonPath, 'utf8')) as {
            plugins?: { name: string; description?: string }[];
          };
          if (Array.isArray(meta.plugins)) {
            pluginChoices = meta.plugins.map(p => ({ name: p.name, description: p.description ?? '' }));
          }
        }

        if (pluginChoices.length === 0) {
          const pluginsDir = path.join(marketplacePath, 'plugins');
          if (fs.existsSync(pluginsDir)) {
            pluginChoices = fs.readdirSync(pluginsDir)
              .filter(name => fs.statSync(path.join(pluginsDir, name)).isDirectory())
              .map(name => ({ name, description: '' }));
          }
        }

        if (pluginChoices.length === 0) {
          throw new Error('No plugins found in marketplace. Check the marketplace repository structure.');
        }

        let selectedPlugin: string;
        if (plugin) {
          if (!pluginChoices.some(p => p.name === plugin)) {
            throw new Error(`Plugin "${plugin}" not found. Available: ${pluginChoices.map(p => p.name).join(', ')}`);
          }
          selectedPlugin = plugin;
        } else {
          selectedPlugin = await select({
            message: 'Select a plugin to install:',
            choices: pluginChoices.map(p => ({
              value: p.name,
              name: p.description ? `${p.name} — ${p.description}` : p.name,
            })),
          });
        }

        const pluginsBase = path.resolve(marketplacePath, 'plugins');
        const skillsSrc = path.resolve(pluginsBase, selectedPlugin, 'skills');
        if (!skillsSrc.startsWith(pluginsBase + path.sep)) {
          throw new Error(`Invalid plugin name: "${selectedPlugin}"`);
        }
        if (!fs.existsSync(skillsSrc)) {
          throw new Error(`No skills directory found at ${skillsSrc}`);
        }

        const targetDir = opts.claude
          ? path.join(os.homedir(), '.claude', 'skills')
          : path.join(os.homedir(), '.agents', 'skills');

        fs.mkdirSync(targetDir, { recursive: true });

        const resolvedTarget = path.resolve(targetDir);
        const skillNames = fs.readdirSync(skillsSrc).filter(name =>
          fs.statSync(path.join(skillsSrc, name)).isDirectory()
        );

        const installed: string[] = [];
        for (const skillName of skillNames) {
          const dest = path.resolve(targetDir, skillName);
          if (!dest.startsWith(resolvedTarget + path.sep)) continue;
          fs.rmSync(dest, { recursive: true, force: true });
          fs.cpSync(path.join(skillsSrc, skillName), dest, { recursive: true });
          installed.push(skillName);
        }

        success({
          plugin: selectedPlugin,
          installed,
          total: installed.length,
          target: targetDir,
        }, 'skills', 'marketplace-sync', start);
      } catch (err) {
        fail(err, 'skills', 'marketplace-sync', start);
      }
    });
}
