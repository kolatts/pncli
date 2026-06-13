import type { CollectionEntry } from 'astro:content';

export const categories: Record<string, { label: string; order: string[] }> = {
  'setup': {
    label: 'Getting Started',
    order: [
      'pncli',
    ],
  },
  'pr-workflow': {
    label: 'PR Workflow',
    order: [
      'ship',
      'code-review',
      'address-pr-feedback',
    ],
  },
  'security': {
    label: 'Security',
    order: [
      'security-review',
    ],
  },
  'planning': {
    label: 'Planning',
    order: [
      'plan',
    ],
  },
  'code-quality': {
    label: 'Code Quality',
    order: [
      'license-audit-to-tickets',
    ],
  },
  'infrastructure': {
    label: 'Infrastructure',
    order: [
      'openshift-health',
    ],
  },
};

export const categoryOrder = ['setup', 'pr-workflow', 'security', 'planning', 'code-quality', 'infrastructure'];

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
