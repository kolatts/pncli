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
 * Shape of a normalized Figma node ID: `123:456`, or for a node inside an
 * instance, `I123:456;789:012` — one or more `<id>:<id>` segments joined by `;`.
 */
const NODE_ID_PATTERN = /^[A-Za-z0-9]+:[A-Za-z0-9]+(?:;[A-Za-z0-9]+:[A-Za-z0-9]+)*$/;

const NODE_ID_HINT = 'Expected a node ID like 12:34 or 12-34, or a Figma URL with a node-id query param';

function isUrl(input: string): boolean {
  return input.startsWith('http://') || input.startsWith('https://');
}

/**
 * Extract a Figma node ID from either a raw ID or a full Figma URL's `node-id`
 * query param. Figma URLs encode node IDs with dashes (`node-id=123-456`) where
 * the API expects colons (`123:456`); a raw ID is normalized the same way so a
 * value copy-pasted straight out of the URL bar works either way.
 *
 * Like `parseFileKey`, this is for an explicit user-supplied value and always
 * yields an ID or throws — it never silently returns nothing. Use
 * `findNodeIdInUrl` when the node ID is optional.
 */
export function parseNodeId(input: string): string {
  let raw: string | null = input;
  if (isUrl(input)) {
    try {
      raw = new URL(input).searchParams.get('node-id');
    } catch {
      raw = null;
    }
    if (raw === null) {
      throw new Error(`Could not extract a Figma node ID from URL: ${input}\n${NODE_ID_HINT}`);
    }
  }
  const nodeId = raw.trim().replace(/-/g, ':');
  if (!NODE_ID_PATTERN.test(nodeId)) {
    throw new Error(`Invalid Figma node ID: ${input}\n${NODE_ID_HINT}`);
  }
  return nodeId;
}

/**
 * Auto-detect an optional node ID from a Figma URL's `node-id` query param.
 * Returns `undefined` when the URL has no `node-id` at all (the caller then
 * fetches the whole file), but a `node-id` that is present and malformed is
 * still an error rather than a silent fallback.
 */
export function findNodeIdInUrl(url: string): string | undefined {
  if (!new URL(url).searchParams.has('node-id')) return undefined;
  return parseNodeId(url);
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
        // An explicit --node-id must resolve or fail loudly; a node-id in the
        // positional URL is optional and only used when present.
        const nodeId = opts.nodeId
          ? parseNodeId(opts.nodeId)
          : isUrl(fileKeyOrUrl)
            ? findNodeIdInUrl(fileKeyOrUrl)
            : undefined;

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
