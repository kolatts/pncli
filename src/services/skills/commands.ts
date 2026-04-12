import { Command } from 'commander';
import { success, fail, warn } from '../../lib/output.js';
import fs from 'fs';
import path from 'path';

const GITHUB_API = 'https://api.github.com/repos/kolatts/pncli/contents/.claude/skills';
const RAW_BASE   = 'https://raw.githubusercontent.com/kolatts/pncli/main/.claude/skills';
const RAW_COPILOT_INSTRUCTIONS = 'https://raw.githubusercontent.com/kolatts/pncli/main/copilot-instructions.md';

interface GitHubEntry {
  name: string;
  type: 'dir' | 'file';
}

export function registerSkillsCommands(program: Command): void {
  const skills = program.command('skills').description('Manage pncli Claude Code skills');

  skills
    .command('install')
    .description('Download latest pncli skills and copilot-instructions.md into the current repo')
    .option('--target <dir>', 'Target directory for skills (default: .claude/skills)', '.claude/skills')
    .option('--skip-instructions', 'Skip downloading copilot-instructions.md', false)
    .action(async (opts: { target: string; skipInstructions: boolean }) => {
      const start = Date.now();
      try {
        const targetDir = path.resolve(opts.target);

        // 1. Fetch skill directory listing from GitHub API
        warn('Fetching skill list from GitHub...');
        const listRes = await fetch(GITHUB_API, {
          headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'pncli' }
        });

        if (!listRes.ok) {
          throw new Error(`GitHub API returned ${listRes.status}: ${await listRes.text()}`);
        }

        const entries = (await listRes.json()) as GitHubEntry[];
        const skillDirs = entries.filter(e => e.type === 'dir').map(e => e.name);

        if (skillDirs.length === 0) {
          throw new Error('No skills found in the pncli repository');
        }

        // 2. Remove only the pncli-managed skills (not user-created ones)
        for (const skillName of skillDirs) {
          const existingDir = path.join(targetDir, skillName);
          if (fs.existsSync(existingDir)) {
            fs.rmSync(existingDir, { recursive: true, force: true });
          }
        }

        // 3. Download each SKILL.md
        warn(`Found ${skillDirs.length} skills. Downloading...`);
        const installed: string[] = [];
        const failed: string[] = [];

        for (const skillName of skillDirs) {
          const skillDir = path.join(targetDir, skillName);
          const skillUrl = `${RAW_BASE}/${skillName}/SKILL.md`;

          try {
            const res = await fetch(skillUrl, {
              headers: { 'User-Agent': 'pncli' }
            });

            if (!res.ok) {
              failed.push(skillName);
              continue;
            }

            const content = await res.text();
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');
            installed.push(skillName);
          } catch {
            failed.push(skillName);
          }
        }

        warn(`Installed ${installed.length} skill(s) to ${targetDir}`);
        if (failed.length > 0) {
          warn(`Failed to download: ${failed.join(', ')}`);
        }

        // 4. Download copilot-instructions.md
        let instructionsWritten = false;
        if (!opts.skipInstructions) {
          warn('Downloading copilot-instructions.md...');
          try {
            const res = await fetch(RAW_COPILOT_INSTRUCTIONS, {
              headers: { 'User-Agent': 'pncli' }
            });
            if (res.ok) {
              const content = await res.text();
              fs.writeFileSync('copilot-instructions.md', content, 'utf8');
              instructionsWritten = true;
              warn('Wrote copilot-instructions.md');
            } else {
              warn(`Failed to download copilot-instructions.md (${res.status})`);
            }
          } catch {
            warn('Failed to download copilot-instructions.md');
          }
        }

        success({
          installed,
          failed,
          target: targetDir,
          total: installed.length,
          copilotInstructions: instructionsWritten
        }, 'skills', 'install', start);
      } catch (err) {
        fail(err, 'skills', 'install', start);
      }
    });

  skills
    .command('list')
    .description('List locally installed skills')
    .option('--target <dir>', 'Skills directory to scan (default: .claude/skills)', '.claude/skills')
    .action((opts: { target: string }) => {
      const start = Date.now();
      try {
        const targetDir = path.resolve(opts.target);

        if (!fs.existsSync(targetDir)) {
          success({ skills: [], message: 'No skills directory found. Run: pncli skills install' }, 'skills', 'list', start);
          return;
        }

        const skillDirs = fs.readdirSync(targetDir).filter(name => {
          const skillPath = path.join(targetDir, name, 'SKILL.md');
          return fs.existsSync(skillPath);
        });

        const skills = skillDirs.map(name => {
          const content = fs.readFileSync(path.join(targetDir, name, 'SKILL.md'), 'utf8');
          const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          const data: Record<string, string> = {};
          if (frontmatter) {
            for (const line of frontmatter[1].split('\n')) {
              const colonIdx = line.indexOf(':');
              if (colonIdx === -1) continue;
              data[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
            }
          }
          return {
            name: data.name || name,
            slug: name,
            category: data.category || 'other',
            services: data.services || '',
            providers: data.providers || 'none'
          };
        });

        success({ skills, total: skills.length }, 'skills', 'list', start);
      } catch (err) {
        fail(err, 'skills', 'list', start);
      }
    });
}
