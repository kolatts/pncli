import { execSync, execFileSync } from 'child_process';

const DIFF_LINE_LIMIT = 5000;

export interface GitStatusResult {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export interface DiffFile {
  path: string;
  binary: boolean;
  truncated: boolean;
  hunks: DiffHunk[];
}

export interface DiffResult {
  files: DiffFile[];
  truncated: boolean;
}

export interface CommitEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface BranchResult {
  current: string;
  local: string[];
  remote: string[];
}

function exec(cmd: string, cwd: string): string {
  return execSync(cmd, { encoding: 'utf8', cwd }).trim();
}

export function getStatus(root: string): GitStatusResult {
  const output = exec('git status --porcelain', root);
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  if (!output) return { staged, unstaged, untracked };

  for (const line of output.split('\n')) {
    if (!line) continue;
    const x = line[0]!;
    const y = line[1]!;
    const file = line.slice(3);

    if (x === '?' && y === '?') {
      untracked.push(file);
    } else {
      if (x !== ' ' && x !== '?') staged.push(file);
      if (y !== ' ' && y !== '?') unstaged.push(file);
    }
  }

  return { staged, unstaged, untracked };
}

function parseHunkHeader(header: string): { oldStart: number; oldCount: number; newStart: number; newCount: number } {
  const match = header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) return { oldStart: 0, oldCount: 0, newStart: 0, newCount: 0 };
  return {
    oldStart: parseInt(match[1]!, 10),
    oldCount: parseInt(match[2] ?? '1', 10),
    newStart: parseInt(match[3]!, 10),
    newCount: parseInt(match[4] ?? '1', 10)
  };
}

function parseDiff(rawDiff: string): DiffResult {
  const lines = rawDiff.split('\n');
  const files: DiffFile[] = [];
  let globalTruncated = false;
  let lineCount = 0;

  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    lineCount++;
    if (lineCount > DIFF_LINE_LIMIT) {
      globalTruncated = true;
      if (currentFile) currentFile.truncated = true;
      break;
    }

    if (line.startsWith('diff --git ')) {
      if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
      currentHunk = null;
      if (currentFile) files.push(currentFile);

      const pathMatch = line.match(/diff --git a\/(.+) b\/.+$/);
      currentFile = {
        path: pathMatch ? pathMatch[1]! : line,
        binary: false,
        truncated: false,
        hunks: []
      };
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith('Binary files')) {
      currentFile.binary = true;
      continue;
    }

    if (line.startsWith('@@ ')) {
      if (currentHunk) currentFile.hunks.push(currentHunk);
      const { oldStart, oldCount, newStart, newCount } = parseHunkHeader(line);
      currentHunk = { oldStart, oldCount, newStart, newCount, lines: [] };
      continue;
    }

    if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      currentHunk.lines.push(line);
    }
  }

  if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
  if (currentFile) files.push(currentFile);

  return { files, truncated: globalTruncated };
}

export function getDiff(root: string, opts: { staged?: boolean; file?: string }): DiffResult {
  const args = ['git', 'diff'];
  if (opts.staged) args.push('--staged');
  if (opts.file) args.push('--', opts.file);

  try {
    const raw = exec(args.join(' '), root);
    if (!raw) return { files: [], truncated: false };
    return parseDiff(raw);
  } catch {
    return { files: [], truncated: false };
  }
}

export function getLog(root: string, opts: { count?: number; since?: string }): CommitEntry[] {
  const sep = '\x1F'; // ASCII unit separator — safe in git format strings
  const fmt = `%H${sep}%an${sep}%aI${sep}%s`;
  const args = [`log`, `--format=${fmt}`];
  if (opts.count) args.push(`-n`, String(opts.count));
  if (opts.since) args.push(`--since=${opts.since}`);

  try {
    const output = execFileSync('git', args, { encoding: 'utf8', cwd: root }).trim();
    if (!output) return [];
    return output.split('\n').filter(Boolean).map(line => {
      const parts = line.split(sep);
      return {
        hash: parts[0] ?? '',
        author: parts[1] ?? '',
        date: parts[2] ?? '',
        message: parts[3] ?? ''
      };
    });
  } catch {
    return [];
  }
}

export function getBranches(root: string): BranchResult {
  const output = exec('git branch -a', root);
  const local: string[] = [];
  const remote: string[] = [];
  let current = '';

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const isCurrent = line.startsWith('*');
    const name = line.replace(/^\*?\s+/, '').trim();

    if (name.startsWith('remotes/')) {
      remote.push(name.replace('remotes/', ''));
    } else {
      if (isCurrent) current = name;
      local.push(name);
    }
  }

  return { current, local, remote };
}
