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

interface FigmaNode {
  document: unknown;
  components?: Record<string, unknown>;
  componentSets?: Record<string, unknown>;
  styles?: Record<string, unknown>;
  schemaVersion?: number;
}

interface FigmaNodesResponse {
  name: string;
  lastModified: string;
  thumbnailUrl?: string;
  err?: string | null;
  nodes: Record<string, FigmaNode | null>;
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

/**
 * Extract a Figma node ID from either a raw ID or a full Figma URL's `node-id`
 * query param. Figma URLs encode node IDs with a dash (`node-id=123-456`) where
 * the API expects a colon (`123:456`); a raw ID passed directly is normalized
 * the same way so a value copy-pasted straight out of the URL bar works either way.
 */
export function parseNodeId(input: string): string | undefined {
  let raw: string | undefined;
  if (input.startsWith('http://') || input.startsWith('https://')) {
    raw = new URL(input).searchParams.get('node-id') ?? undefined;
  } else {
    raw = input;
  }
  if (!raw) return undefined;
  return raw.includes(':') ? raw : raw.replace('-', ':');
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
    .description('Get a Figma file — metadata, structure, and component/style inventory (or a single node with --node-id)')
    .argument('<file-key-or-url>', 'Figma file key or full Figma URL (https://www.figma.com/design/<key>/...); a node-id query param is auto-detected')
    .option('--document', 'Include the full document node tree (can be large; omitted by default)')
    .option('--node-id <id>', 'Fetch only this node and its descendants instead of the whole file (overrides any node-id detected in the URL)')
    .action(async (fileKeyOrUrl: string, opts: { document?: boolean; nodeId?: string }) => {
      const start = Date.now();
      const { success, fail } = await import('../../lib/output.js');
      try {
        const fileKey = parseFileKey(fileKeyOrUrl);
        const isUrl = fileKeyOrUrl.startsWith('http://') || fileKeyOrUrl.startsWith('https://');
        const nodeId = opts.nodeId ? parseNodeId(opts.nodeId) : isUrl ? parseNodeId(fileKeyOrUrl) : undefined;

        if (nodeId) {
          const data = await getHttp(program).figma<FigmaNodesResponse>(
            `/v1/files/${encodeURIComponent(fileKey)}/nodes`,
            { params: { ids: nodeId } }
          );
          const node = data.nodes[nodeId];
          if (!node) {
            throw new Error(`Node ${nodeId} not found in file ${fileKey}`);
          }
          success(
            {
              fileKey,
              nodeId,
              name: data.name,
              lastModified: data.lastModified,
              thumbnailUrl: data.thumbnailUrl,
              document: node.document,
              componentCount: node.components ? Object.keys(node.components).length : 0,
              styleCount: node.styles ? Object.keys(node.styles).length : 0
            },
            'figma',
            'file',
            start
          );
          return;
        }

        const params: Record<string, string | number | boolean | undefined> = {};
        if (!opts.document) {
          params['depth'] = 1;
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
