import { Command } from 'commander';
import { success, fail, warn } from '../../lib/output.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

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
}
