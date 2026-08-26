import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { parseFileKey, registerFigmaCommands } from './commands.js';

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

  it('sends geometry=paths and depth=0 when --document is omitted (metadata-only default)', async () => {
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
    expect(captured[0]?.url).toContain('geometry=paths');
    expect(captured[0]?.url).toContain('depth=0');
  });
});
