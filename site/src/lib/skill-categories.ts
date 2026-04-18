import type { CollectionEntry } from 'astro:content';

export const categories: Record<string, { label: string; order: string[] }> = {
  'setup': {
    label: 'Getting Started',
    order: [
      'local-setup',
    ],
  },
  'pr-workflow': {
    label: 'PR Workflow',
    order: [
      'review-pull-request',
      'address-pr-feedback',
      'create-bug-from-pr-finding',
      'check-build-status',
    ],
  },
  'security': {
    label: 'Security & Vulnerability',
    order: [
      'review-vulnerabilities',
      'vulnerability-triage-to-tickets',
      'dependency-cve-remediation',
      'threat-model-to-backlog',
    ],
  },
  'code-quality': {
    label: 'Code Quality & Compliance',
    order: [
      'pre-merge-quality-check',
      'tech-debt-to-backlog',
      'license-audit-to-tickets',
    ],
  },
  'planning': {
    label: 'Planning',
    order: [
      'daily-standup-prep',
    ],
  },
};

export const categoryOrder = ['setup', 'pr-workflow', 'security', 'code-quality', 'planning'];

export function getSkillsForCategory(
  entries: CollectionEntry<'skills'>[],
  catKey: string,
): CollectionEntry<'skills'>[] {
  const cat = categories[catKey];
  if (!cat) return [];
  const getIdx = (id: string) => { const i = cat.order.indexOf(id); return i === -1 ? Infinity : i; };
  return [...entries]
    .filter(e => (e.data.category ?? 'other') === catKey)
    .sort((a, b) => getIdx(a.id) - getIdx(b.id));
}

export function getUncategorizedSkills(
  entries: CollectionEntry<'skills'>[],
): CollectionEntry<'skills'>[] {
  const knownIds = new Set(Object.values(categories).flatMap(c => c.order));
  return entries.filter(e => !knownIds.has(e.id));
}
