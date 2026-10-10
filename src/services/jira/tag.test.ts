import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerJiraCommands } from './commands.js';

interface Call { method: string; body: unknown }

/** Stubs fetch; when `rejectLabels` is set, the follow-up label PUT fails like a screen without Labels. */
async function run(argv: string[], rejectLabels: boolean): Promise<{ calls: Call[]; stderr: string }> {
  const calls: Call[] = [];
  let stderr = '';
  vi.stubEnv('PNCLI_JIRA_BASE_URL', 'https://jira.imagile.dev');
  vi.stubEnv('PNCLI_JIRA_API_TOKEN', 'tok');
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method: init.method ?? 'GET', body });
    const isLabelPut = init.method === 'PUT' && Boolean((body as { update?: unknown })?.update);
    if (isLabelPut && rejectLabels) {
      return new Response(
        JSON.stringify({ errors: { labels: "Field 'labels' cannot be set. It is not on the appropriate screen" } }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }
    const payload = init.method === 'POST' ? { id: '1', key: 'PROJ-1' } : { id: '1', key: 'PROJ-1', fields: {} };
    return new Response(init.method === 'PUT' ? null : JSON.stringify(payload), {
      status: init.method === 'PUT' ? 204 : 200,
      headers: { 'content-type': 'application/json' }
    });
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { stderr += String(chunk); return true; });
  const program = new Command();
  program.exitOverride();
  program.option('--config <path>');
  program.option('--dry-run');
  registerJiraCommands(program);
  await program.parseAsync(['node', 'pncli', 'jira', ...argv]);
  return { calls, stderr };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('jira via-pncli label', () => {
  it('does not put labels in the main create/update request, and adds the label afterwards', async () => {
    const { calls } = await run(['update-issue', '--key', 'PROJ-1', '--summary', 'x'], false);
    expect(calls[0]?.body).toEqual({ fields: { summary: 'x' } });
    expect(calls[1]?.body).toEqual({ update: { labels: [{ add: 'via-pncli' }] } });
  });

  it('create-issue sends no labels field in the POST and tags via a follow-up call', async () => {
    const { calls } = await run(['create-issue', '--project', 'PROJ', '--type', 'Task', '--summary', 'x'], false);
    expect((calls[0]?.body as { fields: Record<string, unknown> }).fields).not.toHaveProperty('labels');
    expect(calls.some(c => c.method === 'PUT' && JSON.stringify(c.body) === '{"update":{"labels":[{"add":"via-pncli"}]}}')).toBe(true);
  });

  it('warns but still succeeds when the label cannot be set', async () => {
    const { stderr } = await run(['update-issue', '--key', 'PROJ-1', '--summary', 'x'], true);
    expect(stderr).toContain('Could not add the via-pncli label to PROJ-1');
  });
});
