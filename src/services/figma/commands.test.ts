import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import { Command } from 'commander';
import { findNodeIdInUrl, parseFileKey, parseNodeId, registerFigmaCommands } from './commands.js';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--config <path>');
  program.option('--dry-run');
  registerFigmaCommands(program);
  return program;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('parseFileKey', () => {
  it('extracts the key from a /design/ URL', () => {
    expect(parseFileKey('https://www.figma.com/design/ABC123XYZ/My-Design-File')).toBe('ABC123XYZ');
  });

  it('extracts the key from a legacy /file/ URL', () => {
    expect(parseFileKey('https://www.figma.com/file/DEF456UVW/Old-Design')).toBe('DEF456UVW');
  });

  it('passes a raw key through unchanged', () => {
    expect(parseFileKey('GHI789RST')).toBe('GHI789RST');
  });

  it('throws on a URL that is not a Figma file URL', () => {
    expect(() => parseFileKey('https://www.notion.so/some-page-id')).toThrow(
      'Could not extract Figma file key from URL'
    );
  });

  it('handles mixed-case figma.com domain', () => {
    expect(parseFileKey('https://www.FIGMA.COM/design/JKL012MNO/Test')).toBe('JKL012MNO');
  });
});

describe('parseNodeId', () => {
  it('extracts and normalizes a dash-separated node-id from a URL', () => {
    expect(parseNodeId('https://www.figma.com/design/ABC123XYZ/My-Design?node-id=12-34')).toBe('12:34');
  });

  it('normalizes a raw dash-separated node ID', () => {
    expect(parseNodeId('12-34')).toBe('12:34');
  });

  it('passes a raw colon-separated node ID through unchanged', () => {
    expect(parseNodeId('12:34')).toBe('12:34');
  });

  it('normalizes every dash in an instance sub-node ID', () => {
    expect(parseNodeId('I12-34;56-78')).toBe('I12:34;56:78');
  });

  it('trims surrounding whitespace', () => {
    expect(parseNodeId('  12-34 ')).toBe('12:34');
  });

  it('throws when the URL has no node-id param instead of returning nothing', () => {
    expect(() => parseNodeId('https://www.figma.com/design/ABC123XYZ/My-Design')).toThrow(
      'Could not extract a Figma node ID from URL: https://www.figma.com/design/ABC123XYZ/My-Design'
    );
  });

  it('throws on an unparseable URL', () => {
    expect(() => parseNodeId('https://')).toThrow('Could not extract a Figma node ID from URL: https://');
  });

  it.each(['', '   ', '1234', 'abc', '12:', ':34', '12:34;', 'https://www.figma.com/design/ABC123XYZ/My-Design?node-id=nope'])(
    'rejects malformed node ID %j',
    (input) => {
      expect(() => parseNodeId(input)).toThrow('Invalid Figma node ID');
    }
  );
});

describe('findNodeIdInUrl', () => {
  it('returns the normalized node-id when the URL has one', () => {
    expect(findNodeIdInUrl('https://www.figma.com/design/ABC123XYZ/My-Design?node-id=12-34')).toBe('12:34');
  });

  it('returns undefined when the URL has no node-id param', () => {
    expect(findNodeIdInUrl('https://www.figma.com/design/ABC123XYZ/My-Design')).toBeUndefined();
  });

  it('still throws when a node-id is present but malformed', () => {
    expect(() => findNodeIdInUrl('https://www.figma.com/design/ABC123XYZ/My-Design?node-id=nope')).toThrow(
      'Invalid Figma node ID'
    );
  });
});

describe('figma file — --node-id', () => {
  it('fetches a single node from the nodes endpoint when --node-id is passed', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    vi.stubEnv('PNCLI_FIGMA_BASE_URL', 'https://api.figma.com');
    vi.stubEnv('PNCLI_FIGMA_TOKEN', 'figma-tok');
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          name: 'Test File',
          lastModified: '2024-01-01T00:00:00Z',
          nodes: { '12:34': { document: { id: '12:34', name: 'Frame' }, components: {}, styles: {} } }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });

    await buildProgram().parseAsync(['node', 'pncli', 'figma', 'file', 'ABC123XYZ', '--node-id', '12-34']);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toContain('/v1/files/ABC123XYZ/nodes');
    expect(captured[0]?.url).toContain('ids=12%3A34');
    const parsed = JSON.parse(out) as { data: { nodeId: string; document: unknown } };
    expect(parsed.data.nodeId).toBe('12:34');
    expect(parsed.data.document).toEqual({ id: '12:34', name: 'Frame' });
  });

  it('auto-detects the node-id from a URL argument', async () => {
    const captured: { url: string }[] = [];
    vi.stubEnv('PNCLI_FIGMA_BASE_URL', 'https://api.figma.com');
    vi.stubEnv('PNCLI_FIGMA_TOKEN', 'figma-tok');
    vi.stubGlobal('fetch', async (url: string) => {
      captured.push({ url: String(url) });
      return new Response(
        JSON.stringify({
          name: 'Test File',
          lastModified: '2024-01-01T00:00:00Z',
          nodes: { '12:34': { document: { id: '12:34' } } }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await buildProgram().parseAsync([
      'node', 'pncli', 'figma', 'file',
      'https://www.figma.com/design/ABC123XYZ/My-Design?node-id=12-34'
    ]);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toContain('/v1/files/ABC123XYZ/nodes');
    expect(captured[0]?.url).toContain('ids=12%3A34');
  });

  it('errors when the requested node is not in the response', async () => {
    vi.stubEnv('PNCLI_FIGMA_BASE_URL', 'https://api.figma.com');
    vi.stubEnv('PNCLI_FIGMA_TOKEN', 'figma-tok');
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({ name: 'Test File', lastModified: '2024-01-01T00:00:00Z', nodes: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(fs, 'writeSync').mockImplementation(() => 0);

    await expect(
      buildProgram().parseAsync(['node', 'pncli', 'figma', 'file', 'ABC123XYZ', '--node-id', '12-34'])
    ).rejects.toThrow('Node 12:34 not found in file ABC123XYZ');
  });

  it('fails instead of silently fetching the whole file when --node-id is a URL without a node-id', async () => {
    const fetchSpy = vi.fn();
    vi.stubEnv('PNCLI_FIGMA_BASE_URL', 'https://api.figma.com');
    vi.stubEnv('PNCLI_FIGMA_TOKEN', 'figma-tok');
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(fs, 'writeSync').mockImplementation(() => 0);

    await expect(
      buildProgram().parseAsync([
        'node', 'pncli', 'figma', 'file', 'ABC123XYZ',
        '--node-id', 'https://www.figma.com/design/ABC123XYZ/My-Design'
      ])
    ).rejects.toThrow('Could not extract a Figma node ID from URL');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('figma file — --document flag', () => {
  it('omits geometry and depth params when --document is passed', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    vi.stubEnv('PNCLI_FIGMA_BASE_URL', 'https://api.figma.com');
    vi.stubEnv('PNCLI_FIGMA_TOKEN', 'figma-tok');
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured.push({ url: String(url), init });
      return new Response(
        JSON.stringify({ name: 'Test File', lastModified: '2024-01-01T00:00:00Z', version: '1', components: {}, styles: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await buildProgram().parseAsync(['node', 'pncli', 'figma', 'file', 'ABC123XYZ', '--document']);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).not.toContain('geometry');
    expect(captured[0]?.url).not.toContain('depth');
  });

  it('sends depth=1 and omits geometry when --document is omitted (metadata-only default)', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    vi.stubEnv('PNCLI_FIGMA_BASE_URL', 'https://api.figma.com');
    vi.stubEnv('PNCLI_FIGMA_TOKEN', 'figma-tok');
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured.push({ url: String(url), init });
      return new Response(
        JSON.stringify({ name: 'Test File', lastModified: '2024-01-01T00:00:00Z', version: '1', components: {}, styles: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await buildProgram().parseAsync(['node', 'pncli', 'figma', 'file', 'ABC123XYZ']);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).not.toContain('geometry');
    expect(captured[0]?.url).toContain('depth=1');
  });
});
