import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { buildFieldPatch, splitWorkFieldsDictionary, parseFieldArgs } from './helpers.js';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseFieldArgs', () => {
  it('splits name=value pairs on the first =', () => {
    expect(parseFieldArgs(['Priority=2', 'Title=Has=Equals'])).toEqual({
      Priority: '2',
      Title: 'Has=Equals'
    });
  });

  it('throws on missing =', () => {
    expect(() => parseFieldArgs(['NoEquals'])).toThrow('Invalid --field value');
  });
});

describe('buildFieldPatch', () => {
  const aliases = {
    title: 'System.Title',
    description: 'System.Description',
    acceptancecriteria: 'Microsoft.VSTS.Common.AcceptanceCriteria',
    'story-points': 'Microsoft.VSTS.Scheduling.StoryPoints'
  };

  it('resolves a plain lowercase alias', () => {
    const patch = buildFieldPatch({ title: 'New title' }, aliases);
    expect(patch).toEqual([{ op: 'add', path: '/fields/System.Title', value: 'New title' }]);
  });

  it('resolves a friendly name with spaces against a space-free alias', () => {
    const patch = buildFieldPatch({ 'Acceptance Criteria': 'Given/When/Then' }, aliases);
    expect(patch).toEqual([
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria', value: 'Given/When/Then' }
    ]);
  });

  it('resolves a friendly name with a dash against a space-free alias', () => {
    const patch = buildFieldPatch({ 'story points': 5 }, aliases);
    expect(patch).toEqual([
      { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints', value: 5 }
    ]);
  });

  it('passes an unregistered key through untouched (no pre-registration required)', () => {
    const patch = buildFieldPatch({ 'MyOrg.SomeCustomField': 'x' }, aliases);
    expect(patch).toEqual([{ op: 'add', path: '/fields/MyOrg.SomeCustomField', value: 'x' }]);
  });

  it('preserves non-string values (e.g. numbers from a JSON --input-file)', () => {
    const patch = buildFieldPatch({ title: 'T', priority: 2 }, aliases);
    expect(patch.find(p => p.path === '/fields/Microsoft.VSTS.Common.Priority'))
      .toEqual({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 2 });
  });

  it('resolves common fields (Description, Acceptance Criteria, Priority) via built-in defaults even with no saved aliases', () => {
    const patch = buildFieldPatch(
      { description: 'text', 'Acceptance Criteria': 'Given/When/Then', priority: 1 },
      {}
    );
    expect(patch).toEqual([
      { op: 'add', path: '/fields/System.Description', value: 'text' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria', value: 'Given/When/Then' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 1 }
    ]);
  });

  it('lets user-saved aliases override the built-in default for the same key', () => {
    const patch = buildFieldPatch({ priority: 1 }, { priority: 'Custom.Priority' });
    expect(patch).toEqual([{ op: 'add', path: '/fields/Custom.Priority', value: 1 }]);
  });
});

describe('splitWorkFieldsDictionary', () => {
  it('routes built-in work item fields regardless of casing', () => {
    const { builtin, custom } = splitWorkFieldsDictionary({
      Title: 'Login broken', Description: 'details', Priority: 2, AssignedTo: 'bob@example.com'
    });
    expect(builtin).toEqual({ title: 'Login broken', description: 'details', priority: 2, assignee: 'bob@example.com' });
    expect(custom).toEqual({});
  });

  it('leaves non-builtin keys (including friendly names with spaces) in custom, untouched', () => {
    const { custom } = splitWorkFieldsDictionary({ 'Acceptance Criteria': 'text', 'MyOrg.SomeCustomField': 'x' });
    expect(custom).toEqual({ 'Acceptance Criteria': 'text', 'MyOrg.SomeCustomField': 'x' });
  });

  it('resolves @file references on both built-in and custom field values', () => {
    mockReadFileSync.mockReturnValue('<p>Long description</p>' as unknown as ReturnType<typeof readFileSync>);
    const { builtin, custom } = splitWorkFieldsDictionary({
      description: '@desc.html',
      'Acceptance Criteria': '@ac.html'
    });
    expect(builtin.description).toBe('<p>Long description</p>');
    expect(custom['Acceptance Criteria']).toBe('<p>Long description</p>');
  });
});
