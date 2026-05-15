import { describe, it, expect } from 'vitest';
import { parseBranchReportOutput, formatBranchReportCsv } from './client.js';

const COMMIT_PREFIX = '__PNCLI_COMMIT__';

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

describe('formatBranchReportCsv', () => {
  const report = {
    branch: 'feature',
    since: '2024-01-01',
    until: '2024-12-31',
    commits: [
      {
        hash: 'abc123',
        date: '2024-06-15T12:00:00Z',
        author: 'Alice',
        message: 'Add feature',
        filesChanged: 3,
        insertions: 20,
        deletions: 5,
        netLines: 15
      }
    ],
    summary: {
      commitCount: 1,
      totalInsertions: 20,
      totalDeletions: 5,
      totalNetLines: 15,
      totalFilesChanged: 3
    }
  };

  it('includes header row', () => {
    const csv = formatBranchReportCsv(report);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('hash,date,author,message,files_changed,insertions,deletions,net_lines');
  });

  it('includes one data row per commit', () => {
    const csv = formatBranchReportCsv(report);
    const lines = csv.trim().split('\n');
    // header + 1 commit + TOTAL
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('abc123,2024-06-15T12:00:00Z,Alice,Add feature,3,20,5,15');
  });

  it('includes TOTAL row', () => {
    const csv = formatBranchReportCsv(report);
    const lines = csv.trim().split('\n');
    const totalRow = lines[lines.length - 1]!;
    expect(totalRow.startsWith('TOTAL,')).toBe(true);
    expect(totalRow).toContain('20');
    expect(totalRow).toContain('15');
  });

  it('escapes commas in author/message fields', () => {
    const r = {
      ...report,
      commits: [
        {
          ...report.commits[0]!,
          author: 'Doe, Jane',
          message: 'Fix: handle "quotes" and, commas'
        }
      ]
    };
    const csv = formatBranchReportCsv(r);
    const dataLine = csv.split('\n')[1]!;
    // Both fields should be quoted
    expect(dataLine).toContain('"Doe, Jane"');
    expect(dataLine).toContain('"Fix: handle ""quotes"" and, commas"');
  });

  it('ends with a newline', () => {
    const csv = formatBranchReportCsv(report);
    expect(csv.endsWith('\n')).toBe(true);
  });
});
