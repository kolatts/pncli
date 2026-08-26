import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient, type HttpClient } from '../../lib/http.js';

interface FigmaUser {
  id: string;
  email: string;
  handle: string;
  img_url: string;
}

interface FigmaFile {
  name: string;
  lastModified: string;
  version: string;
  thumbnailUrl?: string;
  role?: string;
  editorType?: string;
  document?: unknown;
  components?: Record<string, unknown>;
  styles?: Record<string, unknown>;
  schemaVersion?: number;
  [key: string]: unknown;
}

interface FigmaComment {
  id: string;
  file_key: string;
  parent_id?: string;
  user: { id: string; handle: string; img_url: string; email?: string };
  created_at: string;
  resolved_at?: string;
  message: string;
  order_id: string;
  client_meta?: unknown;
  [key: string]: unknown;
}

interface FigmaCommentsResponse {
  comments: FigmaComment[];
}

interface FigmaVersion {
  id: string;
  created_at: string;
  label?: string;
  description?: string;
  user: { id: string; handle: string; img_url: string; email?: string };
}

interface FigmaVersionsResponse {
  versions: FigmaVersion[];
}

interface FigmaProjectFile {
  key: string;
  name: string;
  last_modified: string;
  thumbnail_url?: string;
  [key: string]: unknown;
}

interface FigmaProjectFilesResponse {
  files: FigmaProjectFile[];
}

/**
 * Extract a Figma file key from either a raw key or a full Figma URL.
 * Figma URLs follow the pattern: https://www.figma.com/design/<key>/...
 * or the legacy: https://www.figma.com/file/<key>/...
 */
export function parseFileKey(input: string): string {
  // If it looks like a URL, parse out the file key
  if (input.startsWith('http://') || input.startsWith('https://')) {
    const match = /figma\.com\/(?:design|file)\/([A-Za-z0-9]+)/i.exec(input);
    if (!match?.[1]) {
      throw new Error(`Could not extract Figma file key from URL: ${input}\nExpected format: https://www.figma.com/design/<file-key>/...`);
    }
    return match[1];
  }
  return input;
}

function getHttp(program: Command): HttpClient {
  const opts = program.optsWithGlobals();
  return createHttpClient(
    loadConfig({ configPath: opts.config as string | undefined }),
    Boolean(opts.dryRun)
  );
}

export function registerFigmaCommands(program: Command): void {
  const figma = program.command('figma').description('Figma design operations (files, comments, versions)');

  figma
    .command('file')
    .description('Get a Figma file — metadata, structure, and component/style inventory')
    .argument('<file-key-or-url>', 'Figma file key or full Figma URL (https://www.figma.com/design/<key>/...)')
    .option('--document', 'Include the full document node tree (can be large; omitted by default)')
    .action(async (fileKeyOrUrl: string, opts: { document?: boolean }) => {
      const start = Date.now();
      const { success, fail } = await import('../../lib/output.js');
      try {
        const fileKey = parseFileKey(fileKeyOrUrl);
        const params: Record<string, string | number | boolean | undefined> = {};
        if (!opts.document) {
          params['geometry'] = 'paths';
          params['depth'] = 0;
        }
        const data = await getHttp(program).figma<FigmaFile>(`/v1/files/${encodeURIComponent(fileKey)}`, { params });
        success(
          {
            fileKey,
            name: data.name,
            lastModified: data.lastModified,
            version: data.version,
            thumbnailUrl: data.thumbnailUrl,
            role: data.role,
            editorType: data.editorType,
            schemaVersion: data.schemaVersion,
            ...(opts.document ? { document: data.document } : {}),
            componentCount: data.components ? Object.keys(data.components).length : 0,
            styleCount: data.styles ? Object.keys(data.styles).length : 0
          },
          'figma',
          'file',
          start
        );
      } catch (err) { fail(err, 'figma', 'file', start); }
    });

  figma
    .command('comments')
    .description('Get comments on a Figma file')
    .argument('<file-key-or-url>', 'Figma file key or full Figma URL')
    .option('--as-of <date>', 'ISO 8601 timestamp — return only comments created before this time')
    .action(async (fileKeyOrUrl: string, opts: { asOf?: string }) => {
      const start = Date.now();
      const { success, fail } = await import('../../lib/output.js');
      try {
        const fileKey = parseFileKey(fileKeyOrUrl);
        const params: Record<string, string | number | boolean | undefined> = {};
        if (opts.asOf) params['as_of'] = opts.asOf;
        const data = await getHttp(program).figma<FigmaCommentsResponse>(`/v1/files/${encodeURIComponent(fileKey)}/comments`, { params });
        success(
          { fileKey, count: data.comments.length, comments: data.comments },
          'figma',
          'comments',
          start
        );
      } catch (err) { fail(err, 'figma', 'comments', start); }
    });

  figma
    .command('versions')
    .description('Get the version history of a Figma file')
    .argument('<file-key-or-url>', 'Figma file key or full Figma URL')
    .action(async (fileKeyOrUrl: string) => {
      const start = Date.now();
      const { success, fail } = await import('../../lib/output.js');
      try {
        const fileKey = parseFileKey(fileKeyOrUrl);
        const data = await getHttp(program).figma<FigmaVersionsResponse>(`/v1/files/${encodeURIComponent(fileKey)}/versions`);
        success(
          { fileKey, count: data.versions.length, versions: data.versions },
          'figma',
          'versions',
          start
        );
      } catch (err) { fail(err, 'figma', 'versions', start); }
    });

  figma
    .command('project-files')
    .description('List files in a Figma project')
    .argument('<project-id>', 'Figma project ID (visible in the project URL)')
    .action(async (projectId: string) => {
      const start = Date.now();
      const { success, fail } = await import('../../lib/output.js');
      try {
        const data = await getHttp(program).figma<FigmaProjectFilesResponse>(`/v1/projects/${encodeURIComponent(projectId)}/files`);
        success(
          { projectId, count: data.files.length, files: data.files },
          'figma',
          'project-files',
          start
        );
      } catch (err) { fail(err, 'figma', 'project-files', start); }
    });

  figma
    .command('me')
    .description('Get the current Figma user (useful for verifying credentials)')
    .action(async () => {
      const start = Date.now();
      const { success, fail } = await import('../../lib/output.js');
      try {
        const data = await getHttp(program).figma<FigmaUser>('/v1/me');
        success(data, 'figma', 'me', start);
      } catch (err) { fail(err, 'figma', 'me', start); }
    });
}
