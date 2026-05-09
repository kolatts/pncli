export type TestingLevel = 'untested' | 'basic' | 'beta' | 'live';

export interface Integration {
  name: string;
  description: string;
  active: boolean;
  testing: TestingLevel;
}

export const integrations: Integration[] = [
  { name: 'Git',          description: 'Local repository operations',   active: true,  testing: 'live'     },
  { name: 'Jira',         description: 'Issues, sprints, projects',     active: true,  testing: 'basic'    },
  { name: 'Bitbucket',    description: 'Pull requests, repositories',   active: true,  testing: 'basic'    },
  { name: 'Confluence',   description: 'Pages, spaces, content',        active: true,  testing: 'basic'    },
  { name: 'SonarQube',    description: 'Code quality & security',       active: true,  testing: 'basic'    },
  { name: 'Checkmarx',    description: 'Vulnerability scanning (SAST)', active: true,  testing: 'untested' },
  { name: 'SDElements',   description: 'Security requirements',         active: true,  testing: 'basic'    },
  { name: 'Azure DevOps', description: 'Work items, pipelines',         active: true,  testing: 'basic'    },
  { name: 'IBM UDeploy',  description: 'Component versions, deploys',   active: true,  testing: 'basic'    },
  { name: 'Artifactory',  description: 'Artifact repository',           active: true,  testing: 'basic'    },
  { name: 'Jenkins',      description: 'CI/CD pipelines',               active: true,  testing: 'basic'    },
  { name: 'Contrast IAST', description: 'Runtime application security', active: true,  testing: 'untested' },
  { name: 'ServiceNow',   description: 'IT service management',         active: true,  testing: 'untested' },
];
