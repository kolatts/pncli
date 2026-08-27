export type TestingLevel = 'untested' | 'basic' | 'beta' | 'live';

export interface Integration {
  /** CLI command name — must match the service's entry in the `Services:` help block in src/cli.ts. */
  slug: string;
  name: string;
  description: string;
  active: boolean;
  testing: TestingLevel;
}

/**
 * Every service pncli integrates with gets a panel here — the grid on the
 * homepage is the public inventory, so a service that ships without a row is a
 * service nobody knows exists.
 *
 * `testing` is the maturity of validation against a real instance, not of the
 * code. New integrations start at `untested` and only move up once someone has
 * actually pointed them at a live server:
 *
 *   untested — shipped, never run against a live instance
 *   basic    — smoke-tested against one instance; the common commands work
 *   beta     — exercised across several commands and instances, edges still rough
 *   live     — used routinely in day-to-day work
 *
 * `src/lib/integrations-coverage.test.ts` fails the build if a CLI service is
 * missing from this list (or listed here but not registered in the CLI).
 */
export const integrations: Integration[] = [
  { slug: 'git',         name: 'Git',            description: 'Local repository operations',    active: true, testing: 'live'     },
  { slug: 'jira',        name: 'Jira',           description: 'Issues, sprints, projects',      active: true, testing: 'beta'     },
  { slug: 'bitbucket',   name: 'Bitbucket',      description: 'Pull requests, repositories',    active: true, testing: 'basic'    },
  { slug: 'github',      name: 'GitHub',         description: 'Pull requests, reviews, issues', active: true, testing: 'basic'    },
  { slug: 'confluence',  name: 'Confluence',     description: 'Pages, spaces, content',         active: true, testing: 'beta'     },
  { slug: 'sonar',       name: 'SonarQube',      description: 'Code quality & security',        active: true, testing: 'basic'    },
  { slug: 'checkmarx',   name: 'Checkmarx',      description: 'Vulnerability scanning (SAST)',  active: true, testing: 'untested' },
  { slug: 'sde',         name: 'SDElements',     description: 'Security requirements',          active: true, testing: 'basic'    },
  { slug: 'ado',         name: 'Azure DevOps',   description: 'Work items, pipelines',          active: true, testing: 'beta'     },
  { slug: 'artifactory', name: 'Artifactory',    description: 'Artifact repository',            active: true, testing: 'basic'    },
  { slug: 'jenkins',     name: 'Jenkins',        description: 'CI/CD pipelines',                active: true, testing: 'basic'    },
  { slug: 'contrast',    name: 'Contrast IAST',  description: 'Runtime application security',   active: true, testing: 'untested' },
  { slug: 'servicenow',  name: 'ServiceNow',     description: 'IT service management',          active: true, testing: 'untested' },
  { slug: 'sonatypeiq',  name: 'Sonatype IQ',    description: 'Dependency policy enforcement',  active: true, testing: 'untested' },
  { slug: 'openshift',   name: 'OpenShift',      description: 'Pods, events, logs, metrics',    active: true, testing: 'untested' },
  { slug: 'dynatrace',   name: 'Dynatrace',      description: 'Problems, entities, traces',     active: true, testing: 'basic'    },
  { slug: 'logscale',    name: 'LogScale',       description: 'Log queries, repositories',      active: true, testing: 'untested' },
  { slug: 'figma',       name: 'Figma',          description: 'Design files, comments, history', active: true, testing: 'untested' },
  { slug: 'deps',        name: 'Dependencies',   description: 'CVE detection, license audit',   active: true, testing: 'basic'    },
];

/** Most-validated first. Ties keep the declaration order above. */
const TESTING_RANK: Record<TestingLevel, number> = {
  live: 0,
  beta: 1,
  basic: 2,
  untested: 3,
};

/**
 * The grid renders in this order rather than declaration order, so the
 * integrations someone can actually rely on lead and the untested ones sit at
 * the bottom. Add new entries wherever they read best in the array above.
 */
export function integrationsByMaturity(list: Integration[] = integrations): Integration[] {
  return [...list].sort((a, b) => TESTING_RANK[a.testing] - TESTING_RANK[b.testing]);
}

export interface RemovedIntegration {
  name: string;
  removedIn: string;
  reason: string;
}

/**
 * Integrations that shipped and were then taken out. Kept visible so users on an
 * older version know why the commands vanished rather than filing it as a bug.
 */
export const removedIntegrations: RemovedIntegration[] = [
  {
    name: 'IBM UrbanCode Deploy',
    removedIn: 'v2.0.0',
    reason:
      'UCD has no personal access token that works as a standalone credential, so the only ' +
      'workable auth was a username and password. That fails pncli’s authentication bar, ' +
      'and shipping it invited people to put a real account password in a config file.',
  },
];
