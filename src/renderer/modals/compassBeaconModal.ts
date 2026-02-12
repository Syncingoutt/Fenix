// Shared compass/beacon/probe/scalpel/resonance categorizer logic.

type CategorizerFunction = (itemName: string, itemGroup: string, baseId: string) => boolean;

export const categorizers: Record<string, CategorizerFunction> = {
  resonance: (name, group, baseId) =>
    baseId === '5028' || baseId === '5040',
  beaconsT8: (name, group, baseId) =>
    group === 'beacon' && (name.includes('(Timemark 8)') || name === 'Deep Space Beacon'),
  beaconsT7: (name, group, baseId) =>
    group === 'beacon' && (name.includes('(Timemark 7)') || (!name.includes('(Timemark 8)') && name !== 'Deep Space Beacon')),
  probes: (name, group, baseId) =>
    group === 'probe',
  scalpels: (name, group, baseId) =>
    group === 'scalpel',
  compasses: (name, group, baseId) =>
    group === 'compass'
};
