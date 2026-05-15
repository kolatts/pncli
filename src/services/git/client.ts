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

export interface CommitStats {
  hash: string;
  date: string;
  author: string;
  message: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  netLines: number;
}

export interface BranchReport {
  branch: string;
  since: string | null;
  until: string | null;
  commits: CommitStats[];
  summary: {
    commitCount: number;
    totalInsertions: number;
    totalDeletions: number;
    totalNetLines: number;
    totalFilesChanged: number;
  };
}

const COMMIT_PREFIX = '__PNCLI_COMMIT__';

// Exported for unit testing
export function parseBranchReportOutput(
  raw: string,
  branchName: string,
  opts: { since?: string; until?: string }
): BranchReport {
  const commits: CommitStats[] = [];
  let current: CommitStats | null = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith(COMMIT_PREFIX)) {
      if (current) commits.push(current);
      const parts = line.slice(COMMIT_PREFIX.length).split('\t');
      current = {
        hash: parts[0] ?? '',
        author: parts[1] ?? '',
        date: parts[2] ?? '',
        message: parts[3] ?? '',
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        netLines: 0
      };
    } else if (current && /^(\d+|-)\t(\d+|-)/.test(line)) {
      // numstat line: insertions\tdeletions\tfilename
      const [ins, del] = line.split('\t');
      const insertions = ins === '-' ? 0 : parseInt(ins ?? '0', 10);
      const deletions = del === '-' ? 0 : parseInt(del ?? '0', 10);
      if (!isNaN(insertions) && !isNaN(deletions)) {
        current.insertions += insertions;
        current.deletions += deletions;
        current.filesChanged++;
        current.netLines = current.insertions - current.deletions;
      }
    }
  }

  if (current) commits.push(current);

  const totalInsertions = commits.reduce((sum, c) => sum + c.insertions, 0);
  const totalDeletions = commits.reduce((sum, c) => sum + c.deletions, 0);

  return {
    branch: branchName,
    since: opts.since ?? null,
    until: opts.until ?? null,
    commits,
    summary: {
      commitCount: commits.length,
      totalInsertions,
      totalDeletions,
      totalNetLines: totalInsertions - totalDeletions,
      totalFilesChanged: commits.reduce((sum, c) => sum + c.filesChanged, 0)
    }
  };
}

export function getBranchReport(
  root: string,
  opts: { branch?: string; since?: string; until?: string; base?: string }
): BranchReport {
  const fmt = `${COMMIT_PREFIX}%H\t%an\t%aI\t%s`;
  const args = ['log', `--format=${fmt}`, '--numstat'];

  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.until) args.push(`--until=${opts.until}`);

  if (opts.base && opts.branch) {
    args.push(`${opts.base}..${opts.branch}`);
  } else if (opts.branch) {
    args.push(opts.branch);
  }

  let raw = '';
  try {
    raw = execFileSync('git', args, { encoding: 'utf8', cwd: root }).trim();
  } catch {
    // no commits or invalid ref — return empty report
  }

  let branchName = opts.branch ?? '';
  if (!branchName) {
    try {
      branchName = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf8',
        cwd: root
      }).trim();
    } catch {
      branchName = 'HEAD';
    }
  }

  return parseBranchReportOutput(raw, branchName, opts);
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function formatBranchReportCsv(report: BranchReport): string {
  const header = 'hash,date,author,message,files_changed,insertions,deletions,net_lines';
  const rows = report.commits.map(c =>
    [
      c.hash,
      c.date,
      escapeCsvField(c.author),
      escapeCsvField(c.message),
      c.filesChanged,
      c.insertions,
      c.deletions,
      c.netLines
    ].join(',')
  );

  const s = report.summary;
  const totalRow = [
    'TOTAL',
    '',
    '',
    escapeCsvField(`commits:${s.commitCount}`),
    s.totalFilesChanged,
    s.totalInsertions,
    s.totalDeletions,
    s.totalNetLines
  ].join(',');

  return [header, ...rows, totalRow].join('\n') + '\n';
}
