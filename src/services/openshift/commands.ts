import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { success, fail, writeRawOutput } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

// ── Kubernetes API response shapes ────────────────────────────────────────────

interface K8sContainerState {
  waiting?: { reason?: string; message?: string };
  running?: { startedAt?: string };
  terminated?: { exitCode?: number; reason?: string; message?: string };
}

interface K8sContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state?: K8sContainerState;
  lastState?: K8sContainerState;
  image?: string;
}

interface K8sPodCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

interface K8sEnvVar {
  name: string;
  value?: string;
  valueFrom?: Record<string, unknown>;
}

interface K8sResourceRequirements {
  limits?: { cpu?: string; memory?: string };
  requests?: { cpu?: string; memory?: string };
}

interface K8sContainer {
  name: string;
  image?: string;
  env?: K8sEnvVar[];
  resources?: K8sResourceRequirements;
  [key: string]: unknown;
}

interface K8sPod {
  metadata: { name: string; namespace: string; creationTimestamp?: string; labels?: Record<string, string>; annotations?: Record<string, string>; [key: string]: unknown };
  spec: { containers?: Array<K8sContainer>; initContainers?: Array<K8sContainer>; nodeName?: string; [key: string]: unknown };
  status: {
    phase?: string;
    reason?: string;
    message?: string;
    conditions?: K8sPodCondition[];
    containerStatuses?: K8sContainerStatus[];
    initContainerStatuses?: K8sContainerStatus[];
    startTime?: string;
    [key: string]: unknown;
  };
}

interface K8sPodList {
  items: K8sPod[];
}

interface K8sEvent {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  eventTime?: string;
  regarding?: { kind?: string; name?: string; namespace?: string };
  involvedObject?: { kind?: string; name?: string; namespace?: string };
  source?: { component?: string };
  reportingComponent?: string;
}

interface K8sEventList {
  items: K8sEvent[];
}

interface K8sPodMetrics {
  metadata: { name: string };
  containers: Array<{ name: string; usage: { cpu: string; memory: string } }>;
}

interface K8sPodMetricsList {
  items: K8sPodMetrics[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function containerState(s?: K8sContainerState): string {
  if (!s) return 'unknown';
  if (s.waiting) return s.waiting.reason ?? 'Waiting';
  if (s.terminated) return s.terminated.reason ?? 'Terminated';
  if (s.running) return 'Running';
  return 'unknown';
}

function getHttp(program: Command) {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config as string | undefined });
  if (!config.openshift.baseUrl) {
    throw new PncliError('OpenShift not configured. Run: pncli config init');
  }
  return createHttpClient(config, Boolean(opts.dryRun));
}

function podAge(creationTimestamp?: string): string {
  if (!creationTimestamp) return 'unknown';
  const ageMs = Date.now() - new Date(creationTimestamp).getTime();
  const ageSeconds = Math.floor(ageMs / 1000);
  if (ageSeconds < 60) return `${ageSeconds}s`;
  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) return `${ageMinutes}m`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours}h`;
  return `${Math.floor(ageHours / 24)}d`;
}

// ── Unit conversion helpers ───────────────────────────────────────────────────

/**
 * Parse a Kubernetes CPU quantity and return millicores (m).
 * Supports: n (nanocores), u (microseconds), m (millicores), whole cores.
 */
function parseCpuMillicores(cpu: string | undefined): number | null {
  if (!cpu) return null;
  if (cpu.endsWith('n')) return Math.round(Number(cpu.slice(0, -1)) / 1_000_000);
  if (cpu.endsWith('u')) return Math.round(Number(cpu.slice(0, -1)) / 1_000);
  if (cpu.endsWith('m')) return Number(cpu.slice(0, -1));
  const whole = Number(cpu);
  if (!Number.isNaN(whole)) return Math.round(whole * 1000);
  return null;
}

/**
 * Parse a Kubernetes memory quantity and return mebibytes (Mi).
 * Supports binary (Ki, Mi, Gi, Ti) and decimal (K, M, G) suffixes and plain bytes.
 */
function parseMemMiB(mem: string | undefined): number | null {
  if (!mem) return null;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  if (mem.endsWith('Ki')) return round2(Number(mem.slice(0, -2)) / 1024);
  if (mem.endsWith('Mi')) return Number(mem.slice(0, -2));
  if (mem.endsWith('Gi')) return Math.round(Number(mem.slice(0, -2)) * 1024);
  if (mem.endsWith('Ti')) return Math.round(Number(mem.slice(0, -2)) * 1024 * 1024);
  if (mem.endsWith('K')) return round2(Number(mem.slice(0, -1)) * 1000 / (1024 * 1024));
  if (mem.endsWith('M')) return round2(Number(mem.slice(0, -1)) * 1000 * 1000 / (1024 * 1024));
  if (mem.endsWith('G')) return Math.round(Number(mem.slice(0, -1)) * 1000 * 1000 * 1000 / (1024 * 1024));
  const bytes = Number(mem);
  if (!Number.isNaN(bytes)) return round2(bytes / (1024 * 1024));
  return null;
}

// ── Commands ──────────────────────────────────────────────────────────────────

export function registerOpenShiftCommands(program: Command): void {
  const oc = program.command('openshift').description('OpenShift / Kubernetes operations');

  oc
    .command('pods')
    .description('List pod health summary for a namespace — pre-processed for LLM analysis. Use --raw to return the full unmodified Kubernetes pod objects.')
    .requiredOption('--namespace <ns>', 'Kubernetes namespace')
    .option('--label-selector <selector>', 'Label selector (e.g. app=my-app)')
    .option('--raw', 'Return full Kubernetes pod objects without summarization (includes env vars, images, node name, annotations, resources, etc.)', false)
    .action(async (opts: { namespace: string; labelSelector?: string; raw?: boolean }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const params: Record<string, string> = {};
        if (opts.labelSelector) params['labelSelector'] = opts.labelSelector;

        const podList = await http.openshift<K8sPodList>(
          `/api/v1/namespaces/${encodeURIComponent(opts.namespace)}/pods`,
          { params }
        );

        if (opts.raw) {
          success(
            { namespace: opts.namespace, count: podList.items.length, pods: podList.items },
            'openshift', 'pods', start
          );
          return;
        }

        const summaryCounters = {
          total: podList.items.length,
          running: 0,
          pending: 0,
          failed: 0,
          succeeded: 0,
          unknown: 0,
          crashLoopBackOff: 0,
          oomKilled: 0,
          imagePullBackOff: 0,
          totalRestarts: 0,
        };

        const pods = podList.items.map(pod => {
          const phase = pod.status.phase ?? 'Unknown';

          // Tally phase
          switch (phase.toLowerCase()) {
            case 'running': summaryCounters.running++; break;
            case 'pending': summaryCounters.pending++; break;
            case 'failed': summaryCounters.failed++; break;
            case 'succeeded': summaryCounters.succeeded++; break;
            default: summaryCounters.unknown++; break;
          }

          // Process container statuses
          const allStatuses = [
            ...(pod.status.containerStatuses ?? []),
            ...(pod.status.initContainerStatuses ?? [])
          ];

          let podRestarts = 0;
          const containers = allStatuses.map(cs => {
            podRestarts += cs.restartCount;
            summaryCounters.totalRestarts += cs.restartCount;

            const currentState = containerState(cs.state);
            const lastState = containerState(cs.lastState);

            if (currentState === 'CrashLoopBackOff') summaryCounters.crashLoopBackOff++;
            if (currentState === 'ImagePullBackOff' || currentState === 'ErrImagePull') summaryCounters.imagePullBackOff++;
            if (lastState === 'OOMKilled' || cs.lastState?.terminated?.reason === 'OOMKilled') summaryCounters.oomKilled++;

            const entry: Record<string, unknown> = {
              name: cs.name,
              ready: cs.ready,
              restartCount: cs.restartCount,
              state: currentState,
            };
            if (cs.lastState?.terminated) {
              entry['lastExitCode'] = cs.lastState.terminated.exitCode;
              entry['lastReason'] = cs.lastState.terminated.reason;
            }
            return entry;
          });

          const readyCount = allStatuses.filter(cs => cs.ready).length;
          const totalCount = pod.spec.containers?.length ?? allStatuses.length;

          const entry: Record<string, unknown> = {
            name: pod.metadata.name,
            phase,
            ready: `${readyCount}/${totalCount}`,
            restartCount: podRestarts,
            age: podAge(pod.metadata.creationTimestamp),
          };

          // Surface top-level pod problem reason if present
          const podReason = pod.status.reason ?? pod.status.conditions?.find(c => c.status === 'False')?.reason;
          if (podReason) entry['reason'] = podReason;
          if (pod.status.message) entry['message'] = pod.status.message;
          if (containers.length > 0) entry['containers'] = containers;
          if (pod.metadata.labels && Object.keys(pod.metadata.labels).length > 0) {
            entry['labels'] = pod.metadata.labels;
          }

          return entry;
        });

        // Sort: most-problematic first (failed/pending/high-restarts)
        pods.sort((a, b) => {
          const phasePriority = (p: unknown) => {
            if (p === 'Failed') return 0;
            if (p === 'Pending') return 1;
            if (p === 'Unknown') return 2;
            return 3;
          };
          const pDiff = phasePriority(a['phase']) - phasePriority(b['phase']);
          if (pDiff !== 0) return pDiff;
          return ((b['restartCount'] as number) ?? 0) - ((a['restartCount'] as number) ?? 0);
        });

        success({ namespace: opts.namespace, summary: summaryCounters, pods }, 'openshift', 'pods', start);
      } catch (err) { fail(err, 'openshift', 'pods', start); }
    });

  oc
    .command('events')
    .description('List Warning events for a namespace — pre-filtered for LLM analysis')
    .requiredOption('--namespace <ns>', 'Kubernetes namespace')
    .option('--field-selector <selector>', 'Additional field selector (e.g. involvedObject.name=my-pod)')
    .option('--all', 'Include Normal events in addition to Warning events', false)
    .action(async (opts: { namespace: string; fieldSelector?: string; all?: boolean }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const params: Record<string, string> = {};

        // Build field selector: default to Warning-only unless --all
        const selectors: string[] = [];
        if (!opts.all) selectors.push('type=Warning');
        if (opts.fieldSelector) selectors.push(opts.fieldSelector);
        if (selectors.length > 0) params['fieldSelector'] = selectors.join(',');

        const eventList = await http.openshift<K8sEventList>(
          `/api/v1/namespaces/${encodeURIComponent(opts.namespace)}/events`,
          { params }
        );

        const events = eventList.items.map(ev => {
          const obj = ev.involvedObject ?? ev.regarding;
          const entry: Record<string, unknown> = {
            type: ev.type ?? 'Normal',
            reason: ev.reason,
            object: obj ? `${obj.kind ?? 'Object'}/${obj.name ?? '?'}` : undefined,
            message: ev.message,
            count: ev.count ?? 1,
            firstTime: ev.firstTimestamp ?? ev.eventTime,
            lastTime: ev.lastTimestamp ?? ev.eventTime,
          };
          const source = ev.source?.component ?? ev.reportingComponent;
          if (source) entry['source'] = source;
          return entry;
        });

        // Sort by count descending (highest frequency first)
        events.sort((a, b) => ((b['count'] as number) ?? 0) - ((a['count'] as number) ?? 0));

        success({ namespace: opts.namespace, count: events.length, events }, 'openshift', 'events', start);
      } catch (err) { fail(err, 'openshift', 'events', start); }
    });

  oc
    .command('logs')
    .description('Get recent log lines from a pod container')
    .requiredOption('--namespace <ns>', 'Kubernetes namespace')
    .requiredOption('--pod <name>', 'Pod name')
    .option('--container <name>', 'Container name (defaults to first container)')
    .option('--lines <n>', 'Number of most-recent lines to return', '100')
    .option('--previous', 'Return logs from the previous container instance', false)
    .action(async (opts: { namespace: string; pod: string; container?: string; lines?: string; previous?: boolean }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const lines = opts.lines ? parseInt(opts.lines, 10) : 100;

        const logText = await http.openshiftText(
          `/api/v1/namespaces/${encodeURIComponent(opts.namespace)}/pods/${encodeURIComponent(opts.pod)}/log`,
          {
            lines,
            params: {
              ...(opts.container ? { container: opts.container } : {}),
              ...(opts.previous ? { previous: 'true' } : {}),
            }
          }
        );

        success(
          {
            pod: opts.pod,
            namespace: opts.namespace,
            container: opts.container ?? '(default)',
            previous: opts.previous ?? false,
            lines,
            log: logText,
          },
          'openshift', 'logs', start
        );
      } catch (err) { fail(err, 'openshift', 'logs', start); }
    });

  oc
    .command('pod-metrics')
    .description('Get CPU and memory usage for pods in a namespace (requires metrics-server)')
    .requiredOption('--namespace <ns>', 'Kubernetes namespace')
    .action(async (opts: { namespace: string }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const metricsList = await http.openshift<K8sPodMetricsList>(
          `/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(opts.namespace)}/pods`
        );

        const pods = metricsList.items.map(pm => ({
          name: pm.metadata.name,
          containers: pm.containers.map(c => ({
            name: c.name,
            cpu: c.usage.cpu,
            memory: c.usage.memory,
          })),
        }));

        success({ namespace: opts.namespace, pods }, 'openshift', 'pod-metrics', start);
      } catch (err) { fail(err, 'openshift', 'pod-metrics', start); }
    });

  oc
    .command('resource-usage')
    .description('Combined CPU/memory usage, limits, and requests for all pods in a namespace — all values normalized to millicores (m) and mebibytes (Mi). Requires metrics-server. Use --csv to emit a spreadsheet-friendly CSV.')
    .requiredOption('--namespace <ns>', 'Kubernetes namespace')
    .option('--label-selector <selector>', 'Label selector (e.g. app=my-app)')
    .option('--csv', 'Output as CSV instead of JSON (suitable for Excel)', false)
    .action(async (opts: { namespace: string; labelSelector?: string; csv?: boolean }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const nsEncoded = encodeURIComponent(opts.namespace);
        const podParams: Record<string, string> = {};
        if (opts.labelSelector) podParams['labelSelector'] = opts.labelSelector;

        // Fetch pod list (limits/requests) and metrics (usage) in parallel
        const [podList, metricsList] = await Promise.all([
          http.openshift<K8sPodList>(`/api/v1/namespaces/${nsEncoded}/pods`, { params: podParams }),
          http.openshift<K8sPodMetricsList>(`/apis/metrics.k8s.io/v1beta1/namespaces/${nsEncoded}/pods`, { params: podParams }),
        ]);

        // Index metrics by pod name → container name for O(1) join
        const metricsIndex = new Map<string, Map<string, { cpu: string; memory: string }>>();
        for (const pm of metricsList.items) {
          const containerMap = new Map<string, { cpu: string; memory: string }>();
          for (const c of pm.containers) {
            containerMap.set(c.name, c.usage);
          }
          metricsIndex.set(pm.metadata.name, containerMap);
        }

        interface ResourceRow {
          pod: string;
          container: string;
          cpuUsageMillicores: number | null;
          memUsageMiB: number | null;
          cpuLimitsMillicores: number | null;
          memLimitsMiB: number | null;
          cpuRequestsMillicores: number | null;
          memRequestsMiB: number | null;
        }

        const rows: ResourceRow[] = [];

        for (const pod of podList.items) {
          const podName = pod.metadata.name;
          const podMetrics = metricsIndex.get(podName);
          const containers = pod.spec.containers ?? [];

          for (const container of containers) {
            const usage = podMetrics?.get(container.name);
            rows.push({
              pod: podName,
              container: container.name,
              cpuUsageMillicores: parseCpuMillicores(usage?.cpu),
              memUsageMiB: parseMemMiB(usage?.memory),
              cpuLimitsMillicores: parseCpuMillicores(container.resources?.limits?.cpu),
              memLimitsMiB: parseMemMiB(container.resources?.limits?.memory),
              cpuRequestsMillicores: parseCpuMillicores(container.resources?.requests?.cpu),
              memRequestsMiB: parseMemMiB(container.resources?.requests?.memory),
            });
          }
        }

        if (opts.csv) {
          const header = 'Pod,Container,CPU Usage (m),Memory Usage (Mi),CPU Limits (m),Memory Limits (Mi),CPU Requests (m),Memory Requests (Mi)';
          const lines = rows.map(r =>
            [
              r.pod,
              r.container,
              r.cpuUsageMillicores ?? '',
              r.memUsageMiB ?? '',
              r.cpuLimitsMillicores ?? '',
              r.memLimitsMiB ?? '',
              r.cpuRequestsMillicores ?? '',
              r.memRequestsMiB ?? '',
            ].join(',')
          );
          writeRawOutput([header, ...lines].join('\n') + '\n');
        } else {
          success(
            { namespace: opts.namespace, count: rows.length, units: { cpu: 'm', memory: 'Mi' }, rows },
            'openshift', 'resource-usage', start
          );
        }
      } catch (err) { fail(err, 'openshift', 'resource-usage', start); }
    });
}
