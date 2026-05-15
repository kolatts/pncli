import { describe, it, expect } from 'vitest';
import { parseBranchReportOutput, formatBranchReportCsv, buildReportArgs, COMMIT_PREFIX, type BranchReport } from './client.js';

describe('parseBranchReportOutput', () => {
  it('returns an empty report when raw output is empty', () => {
    const report = parseBranchReportOutput('', 'main', {});
    expect(report.branch).toBe('main');
    expect(report.commits).toHaveLength(0);
    expect(report.summary.commitCount).toBe(0);
    expect(report.summary.totalInsertions).toBe(0);
    expect(report.summary.totalDeletions).toBe(0);
    expect(report.summary.totalNetLines).toBe(0);
  });

  it('parses a single commit with no changed files', () => {
    const raw = `${COMMIT_PREFIX}abc123\tJohn Doe\t2024-01-15T10:00:00Z\tFix bug`;
    const report = parseBranchReportOutput(raw, 'feature', {});
    expect(report.commits).toHaveLength(1);
    const c = report.commits[0]!;
    expect(c.hash).toBe('abc123');
    expect(c.author).toBe('John Doe');
    expect(c.date).toBe('2024-01-15T10:00:00Z');
    expect(c.message).toBe('Fix bug');
    expect(c.filesChanged).toBe(0);
    expect(c.insertions).toBe(0);
    expect(c.deletions).toBe(0);
  });

  it('parses a single commit with numstat lines', () => {
    const raw = [
      `${COMMIT_PREFIX}abc123\tJane Doe\t2024-02-01T08:00:00Z\tAdd feature`,
      '5\t2\tsrc/foo.ts',
      '10\t0\tsrc/bar.ts'
    ].join('\n');

    const report = parseBranchReportOutput(raw, 'feature', {});
    expect(report.commits).toHaveLength(1);
    const c = report.commits[0]!;
    expect(c.filesChanged).toBe(2);
    expect(c.insertions).toBe(15);
    expect(c.deletions).toBe(2);
    expect(c.netLines).toBe(13);
  });

  it('parses multiple commits', () => {
    const raw = [
      `${COMMIT_PREFIX}aaa\tAlice\t2024-03-01T00:00:00Z\tCommit A`,
      '3\t1\tfile1.ts',
      '',
      `${COMMIT_PREFIX}bbb\tBob\t2024-03-02T00:00:00Z\tCommit B`,
      '7\t4\tfile2.ts',
      '2\t0\tfile3.ts'
    ].join('\n');

    const report = parseBranchReportOutput(raw, 'main', {});
    expect(report.commits).toHaveLength(2);
    expect(report.summary.commitCount).toBe(2);
    expect(report.summary.totalInsertions).toBe(12);
    expect(report.summary.totalDeletions).toBe(5);
    expect(report.summary.totalNetLines).toBe(7);
    expect(report.summary.totalFilesChanged).toBe(3);
  });

  it('handles binary files (- in numstat)', () => {
    const raw = [
      `${COMMIT_PREFIX}ccc\tCarol\t2024-04-01T00:00:00Z\tAdd image`,
      '-\t-\tassets/logo.png'
    ].join('\n');

    const report = parseBranchReportOutput(raw, 'main', {});
    const c = report.commits[0]!;
    // binary files contribute to filesChanged count but 0 line counts
    expect(c.filesChanged).toBe(1);
    expect(c.insertions).toBe(0);
    expect(c.deletions).toBe(0);
  });

  it('preserves since/until in report metadata', () => {
    const report = parseBranchReportOutput('', 'main', { since: '2024-01-01', until: '2024-12-31' });
    expect(report.since).toBe('2024-01-01');
    expect(report.until).toBe('2024-12-31');
  });

  it('sets since/until to null when not provided', () => {
    const report = parseBranchReportOutput('', 'main', {});
    expect(report.since).toBeNull();
    expect(report.until).toBeNull();
  });
});

describe('weekly and author breakdown', () => {
  it('single author, single week', () => {
    const raw = [
      `${COMMIT_PREFIX}aaa\tAlice\t2024-04-10T10:00:00Z\tCommit A`,
      '5\t2\tsrc/foo.ts'
    ].join('\n');
    const report = parseBranchReportOutput(raw, 'main', {});
    expect(report.weeks).toHaveLength(1);
    expect(report.weeks[0]!.week).toBe('2024-W15');
    expect(report.weeks[0]!.weekStart).toBe('2024-04-08');
    expect(report.weeks[0]!.weekEnd).toBe('2024-04-14');
    expect(report.weeks[0]!.authors).toHaveLength(1);
    expect(report.weeks[0]!.authors[0]!.author).toBe('Alice');
    expect(report.weeks[0]!.authors[0]!.commitCount).toBe(1);
    expect(report.weeks[0]!.authors[0]!.insertions).toBe(5);
    expect(report.weeks[0]!.authors[0]!.deletions).toBe(2);
    expect(report.weeks[0]!.authors[0]!.netLines).toBe(3);
    expect(report.weeks[0]!.summary.commitCount).toBe(1);
    expect(report.byAuthor).toHaveLength(1);
    expect(report.byAuthor[0]!.author).toBe('Alice');
  });

  it('multiple authors in same week are sorted alphabetically', () => {
    const raw = [
      `${COMMIT_PREFIX}aaa\tZara\t2024-04-09T10:00:00Z\tCommit Z`,
      '3\t1\tfile.ts',
      `${COMMIT_PREFIX}bbb\tAlice\t2024-04-10T10:00:00Z\tCommit A`,
      '7\t2\tfile.ts'
    ].join('\n');
    const report = parseBranchReportOutput(raw, 'main', {});
    expect(report.weeks).toHaveLength(1);
    const authors = report.weeks[0]!.authors;
    expect(authors).toHaveLength(2);
    expect(authors[0]!.author).toBe('Alice');
    expect(authors[1]!.author).toBe('Zara');
    expect(report.weeks[0]!.summary.commitCount).toBe(2);
    expect(report.weeks[0]!.summary.totalInsertions).toBe(10);
  });

  it('commits spanning two weeks produce two entries in chronological order', () => {
    const raw = [
      `${COMMIT_PREFIX}aaa\tAlice\t2024-04-08T10:00:00Z\tWeek 15`,
      '2\t0\tfile.ts',
      `${COMMIT_PREFIX}bbb\tAlice\t2024-04-15T10:00:00Z\tWeek 16`,
      '4\t1\tfile.ts'
    ].join('\n');
    const report = parseBranchReportOutput(raw, 'main', {});
    expect(report.weeks).toHaveLength(2);
    expect(report.weeks[0]!.week).toBe('2024-W15');
    expect(report.weeks[1]!.week).toBe('2024-W16');
  });

  it('byAuthor rolls up across all weeks', () => {
    const raw = [
      `${COMMIT_PREFIX}aaa\tAlice\t2024-04-08T10:00:00Z\tWeek 15`,
      '2\t0\tfile.ts',
      `${COMMIT_PREFIX}bbb\tAlice\t2024-04-15T10:00:00Z\tWeek 16`,
      '4\t1\tfile.ts',
      `${COMMIT_PREFIX}ccc\tBob\t2024-04-15T10:00:00Z\tWeek 16 Bob`,
      '1\t1\tfile.ts'
    ].join('\n');
    const report = parseBranchReportOutput(raw, 'main', {});
    expect(report.byAuthor).toHaveLength(2);
    const alice = report.byAuthor.find(a => a.author === 'Alice')!;
    expect(alice.commitCount).toBe(2);
    expect(alice.insertions).toBe(6);
    expect(alice.deletions).toBe(1);
    const bob = report.byAuthor.find(a => a.author === 'Bob')!;
    expect(bob.commitCount).toBe(1);
  });

  it('empty commits produce empty weeks and byAuthor', () => {
    const report = parseBranchReportOutput('', 'main', {});
    expect(report.weeks).toHaveLength(0);
    expect(report.byAuthor).toHaveLength(0);
  });
});

describe('formatBranchReportCsv', () => {
  const makeReport = (overrides?: Partial<BranchReport>): BranchReport => {
    const base = parseBranchReportOutput(
      [
        `${COMMIT_PREFIX}abc123\tAlice\t2024-06-15T12:00:00Z\tAdd feature`,
        '20\t5\tsrc/foo.ts',
        '0\t0\tsrc/bar.ts'
      ].join('\n'),
      'feature',
      { since: '2024-01-01', until: '2024-12-31' }
    );
    return { ...base, ...overrides };
  };

  it('includes weekly/author header row', () => {
    const csv = formatBranchReportCsv(makeReport());
    expect(csv.split('\n')[0]).toBe('week,week_start,author,commits,insertions,deletions,net_lines,files_changed');
  });

  it('includes one data row per author per week', () => {
    const csv = formatBranchReportCsv(makeReport());
    const lines = csv.trim().split('\n');
    // header + 1 author row + TOTAL
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Alice');
    expect(lines[1]).toContain('2024-W24');
  });

  it('includes TOTAL row', () => {
    const csv = formatBranchReportCsv(makeReport());
    const lines = csv.trim().split('\n');
    const totalRow = lines[lines.length - 1]!;
    expect(totalRow.startsWith('TOTAL,')).toBe(true);
    expect(totalRow).toContain('20');
    expect(totalRow).toContain('15');
  });

  it('escapes commas in author field', () => {
    const raw = [
      `${COMMIT_PREFIX}aaa\tDoe, Jane\t2024-04-10T10:00:00Z\tFix`,
      '1\t0\tfile.ts'
    ].join('\n');
    const report = parseBranchReportOutput(raw, 'main', {});
    const csv = formatBranchReportCsv(report);
    expect(csv).toContain('"Doe, Jane"');
  });

  it('ends with a newline', () => {
    const csv = formatBranchReportCsv(makeReport());
    expect(csv.endsWith('\n')).toBe(true);
  });
});

describe('buildReportArgs', () => {
  it('adds base..HEAD when --base given without --branch', () => {
    const args = buildReportArgs({ base: 'main' });
    expect(args).toContain('main..HEAD');
  });

  it('adds base..branch when both --base and --branch given', () => {
    const args = buildReportArgs({ base: 'main', branch: 'feature' });
    expect(args).toContain('main..feature');
    expect(args).not.toContain('main..HEAD');
  });

  it('adds branch alone when only --branch given', () => {
    const args = buildReportArgs({ branch: 'feature' });
    expect(args).toContain('feature');
    expect(args).not.toContain('..');
  });

  it('adds --since and --until flags', () => {
    const args = buildReportArgs({ since: '2024-01-01', until: '2024-12-31' });
    expect(args).toContain('--since=2024-01-01');
    expect(args).toContain('--until=2024-12-31');
  });

  it('adds no range arg when no base, branch, since, or until', () => {
    const args = buildReportArgs({});
    expect(args).not.toContain('..');
    expect(args.some(a => a.startsWith('--since'))).toBe(false);
  });
});
