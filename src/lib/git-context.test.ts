import { describe, it, expect } from 'vitest';
import { parseRemote, parseAdoRemote } from './git-context.js';

describe('parseRemote', () => {
  it('returns null when bitbucketBaseUrl is undefined', () => {
    expect(parseRemote('git@bitbucket.example.com:7999/PROJ/repo.git', undefined)).toBeNull();
  });

  it('parses SSH format', () => {
    const result = parseRemote(
      'git@bitbucket.example.com:7999/PROJ/repo.git',
      'https://bitbucket.example.com'
    );
    expect(result).toEqual({ project: 'PROJ', repo: 'repo' });
  });

  it('parses SSH format without .git suffix', () => {
    const result = parseRemote(
      'git@bitbucket.example.com:7999/PROJ/repo',
      'https://bitbucket.example.com'
    );
    expect(result).toEqual({ project: 'PROJ', repo: 'repo' });
  });

  it('parses HTTPS format', () => {
    const result = parseRemote(
      'https://bitbucket.example.com/scm/PROJ/repo.git',
      'https://bitbucket.example.com'
    );
    expect(result).toEqual({ project: 'PROJ', repo: 'repo' });
  });

  it('parses HTTPS format without .git suffix', () => {
    const result = parseRemote(
      'https://bitbucket.example.com/scm/PROJ/repo',
      'https://bitbucket.example.com'
    );
    expect(result).toEqual({ project: 'PROJ', repo: 'repo' });
  });

  it('returns null when host does not match base URL', () => {
    const result = parseRemote(
      'git@other.example.com:7999/PROJ/repo.git',
      'https://bitbucket.example.com'
    );
    expect(result).toBeNull();
  });

  it('handles base URL with trailing slash', () => {
    const result = parseRemote(
      'https://bitbucket.example.com/scm/PROJ/repo.git',
      'https://bitbucket.example.com/'
    );
    expect(result).toEqual({ project: 'PROJ', repo: 'repo' });
  });
});

describe('parseAdoRemote', () => {
  it('returns null when adoBaseUrl is undefined', () => {
    expect(parseAdoRemote('https://tfs.example.com/col/proj/_git/repo', undefined)).toBeNull();
  });

  it('parses HTTPS format', () => {
    const result = parseAdoRemote(
      'https://tfs.example.com/col/proj/_git/repo',
      'https://tfs.example.com'
    );
    expect(result).toEqual({ collection: 'col', project: 'proj', repo: 'repo' });
  });

  it('parses HTTPS format with .git suffix', () => {
    const result = parseAdoRemote(
      'https://tfs.example.com/col/proj/_git/repo.git',
      'https://tfs.example.com'
    );
    expect(result).toEqual({ collection: 'col', project: 'proj', repo: 'repo' });
  });

  it('parses HTTPS format with path prefix', () => {
    const result = parseAdoRemote(
      'https://tfs.example.com/tfs/col/proj/_git/repo',
      'https://tfs.example.com'
    );
    expect(result).toEqual({ collection: 'col', project: 'proj', repo: 'repo' });
  });

  it('parses SSH protocol format', () => {
    const result = parseAdoRemote(
      'ssh://git@tfs.example.com:22/col/proj/_ssh/repo',
      'https://tfs.example.com'
    );
    expect(result).toEqual({ collection: 'col', project: 'proj', repo: 'repo' });
  });

  it('parses base URL with port', () => {
    const result = parseAdoRemote(
      'https://tfs.example.com:8080/col/proj/_git/repo',
      'https://tfs.example.com:8080'
    );
    expect(result).toEqual({ collection: 'col', project: 'proj', repo: 'repo' });
  });

  it('returns null when host does not match', () => {
    const result = parseAdoRemote(
      'https://other.example.com/col/proj/_git/repo',
      'https://tfs.example.com'
    );
    expect(result).toBeNull();
  });

  it('returns null when no _git or _ssh segment', () => {
    const result = parseAdoRemote(
      'https://tfs.example.com/col/proj/repo',
      'https://tfs.example.com'
    );
    expect(result).toBeNull();
  });

  it('returns null when not enough path segments before marker', () => {
    const result = parseAdoRemote(
      'https://tfs.example.com/proj/_git/repo',
      'https://tfs.example.com'
    );
    expect(result).toBeNull();
  });

  it('decodes percent-encoded project name from HTTPS URL', () => {
    const result = parseAdoRemote(
      'https://tfs.example.com/col/My%20Project/_git/myrepo',
      'https://tfs.example.com'
    );
    expect(result).toEqual({ collection: 'col', project: 'My Project', repo: 'myrepo' });
  });

  it('decodes percent-encoded collection and repo names', () => {
    const result = parseAdoRemote(
      'https://tfs.example.com/My%20Org/My%20Project/_git/My%20Repo',
      'https://tfs.example.com'
    );
    expect(result).toEqual({ collection: 'My Org', project: 'My Project', repo: 'My Repo' });
  });

  it('decodes percent-encoded project name from SSH URL', () => {
    const result = parseAdoRemote(
      'ssh://git@tfs.example.com:22/col/My%20Project/_ssh/myrepo',
      'https://tfs.example.com'
    );
    expect(result).toEqual({ collection: 'col', project: 'My Project', repo: 'myrepo' });
  });
});
