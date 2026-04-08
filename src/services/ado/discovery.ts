import type { AdoWorkClient } from './client/work.js';
import type { AdoFieldMeta, AdoWorkItemTypeMeta } from '../../types/config.js';

/**
 * Discovers all work item fields in the collection and maps them to AdoFieldMeta.
 */
export async function discoverFields(
  client: AdoWorkClient,
  collection: string,
  project?: string
): Promise<AdoFieldMeta[]> {
  const fields = await client.listFields(collection, project);
  return fields.map(f => ({
    referenceName: f.referenceName,
    name: f.name,
    type: f.type,
    readOnly: f.readOnly,
    ...(f.picklistId ? { picklistId: f.picklistId } : {})
  }));
}

/**
 * Discovers all work item types and their valid states per type.
 */
export async function discoverTypes(
  client: AdoWorkClient,
  collection: string,
  project: string
): Promise<AdoWorkItemTypeMeta[]> {
  const types = await client.listWorkItemTypes(collection, project);
  const result: AdoWorkItemTypeMeta[] = [];

  for (const t of types) {
    const states = await client.listTypeStates(collection, project, t.name);
    const requiredFields = (t.fields ?? [])
      .filter(f => f.alwaysRequired)
      .map(f => f.referenceName);
    result.push({
      name: t.name,
      states: states.map(s => s.name),
      requiredFields
    });
  }

  return result;
}

/**
 * Generates a default alias map for the most common field reference names.
 * Only includes aliases for fields actually present in the discovered set.
 */
export function buildDefaultAliases(fields: AdoFieldMeta[]): Record<string, string> {
  const refNames = new Set(fields.map(f => f.referenceName));

  const candidates: Array<[string, string]> = [
    ['title',         'System.Title'],
    ['state',         'System.State'],
    ['assignedto',    'System.AssignedTo'],
    ['assigned-to',   'System.AssignedTo'],
    ['description',   'System.Description'],
    ['areapath',      'System.AreaPath'],
    ['area-path',     'System.AreaPath'],
    ['iterationpath', 'System.IterationPath'],
    ['iteration',     'System.IterationPath'],
    ['tags',          'System.Tags'],
    ['priority',      'Microsoft.VSTS.Common.Priority'],
    ['severity',      'Microsoft.VSTS.Common.Severity'],
    ['effort',        'Microsoft.VSTS.Scheduling.Effort'],
    ['storypoints',   'Microsoft.VSTS.Scheduling.StoryPoints'],
    ['story-points',  'Microsoft.VSTS.Scheduling.StoryPoints'],
    ['remainingwork', 'Microsoft.VSTS.Scheduling.RemainingWork'],
    ['remaining',     'Microsoft.VSTS.Scheduling.RemainingWork'],
    ['acceptancecriteria', 'Microsoft.VSTS.Common.AcceptanceCriteria'],
    ['reprosteps',    'Microsoft.VSTS.TCM.ReproSteps'],
    ['foundinsource', 'Microsoft.VSTS.Build.FoundIn']
  ];

  const aliases: Record<string, string> = {};
  for (const [alias, ref] of candidates) {
    if (refNames.has(ref)) {
      aliases[alias] = ref;
    }
  }
  return aliases;
}
