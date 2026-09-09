import { describe, it, expect } from 'vitest';
import { computePrCoverage } from './repo.js';
import type { AdoPullRequest } from '../../../types/ado.js';

function makePr(creationDate: string): AdoPullRequest {
  return {
    pullRequestId: 1,
    status: 'active',
    createdBy: { id: 'u1', displayName: 'User', uniqueName: 'user@imagile.dev' },
    creationDate,
    title: 't',
    sourceRefName: 'refs/heads/a',
    targetRefName: 'refs/heads/main',
    reviewers: [],
    url: 'https://ado.imagile.dev/pr/1'
  };
}

describe('computePrCoverage', () => {
  it('reports count and the oldest/newest creation dates regardless of input order', () => {
    const prs = [makePr('2026-06-26T00:00:00Z'), makePr('2025-06-02T00:00:00Z'), makePr('2026-01-01T00:00:00Z')];

    const coverage = computePrCoverage(prs, 'active');

    expect(coverage).toEqual({
      count: 3,
      oldestDate: '2025-06-02T00:00:00Z',
      newestDate: '2026-06-26T00:00:00Z',
      status: 'active'
    });
  });

  it('returns null dates for an empty result set', () => {
    const coverage = computePrCoverage([], 'completed');

    expect(coverage).toEqual({
      count: 0,
      oldestDate: null,
      newestDate: null,
      status: 'completed'
    });
  });
});
