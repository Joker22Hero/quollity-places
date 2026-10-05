// These IDs belong to Quollity's compact taxonomy (0002_reference_data.sql).
// Categories may come from Geoapify dotted paths, OSM tags, or Overture
// snake_case taxonomy values. Provider categories never become application IDs.
const specificMappings: [RegExp, string][] = [
  [/\b(botanical|botanic)\b/, 'botanic-garden'],
  [/\bmuseums?\b/, 'museum'],
  [/\b(gallery|galleries)\b/, 'art-gallery'],
  [/\b(cathedral|church|churches|chapel|basilica)\b/, 'church'],
  [/\b(temple|shrine)\b/, 'temple'],
  [/\b(castle|palace)\b/, 'castle'],
  [/\b(manor|historic house|stately home)\b/, 'historic-house'],
  [/\b(archaeological|archeological|archaeology)\b/, 'archaeological-site'],
  [/\b(memorial|monument)\b/, 'monument'],
  [/\b(viewpoint|observation deck|scenic overlook)\b/, 'scenic-attraction'],
  [/\baquarium\b/, 'aquarium'],
  [/\b(theme park|amusement park)\b/, 'theme-park'],
  [/\b(tour operator|tour provider|guided tour|tours?)\b/, 'tour'],
  [/\b(boat trip|cruise)\b/, 'boat-trip'],
  [/\b(cable car|funicular|heritage railway)\b/, 'railway-cable-car'],
];
const generalMappings: [RegExp, string][] = [
  [/\bmuseums?\b/, 'museum'],
  [/\b(parks?|gardens?)\b/, 'park-garden'],
];
const normaliseCategory = (value: string) =>
  value
    .toLowerCase()
    .replace(/[._:/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function suggestedType(
  categories: string[],
  raw: Record<string, unknown>,
): string {
  const values = [
    ...categories,
    ...[
      'tourism',
      'leisure',
      'historic',
      'building',
      'amenity',
      'garden',
      'garden:type',
    ].flatMap((key) => (typeof raw[key] === 'string' ? [raw[key]] : [])),
  ].map(normaliseCategory);
  const specific = new Set(specificMappings.filter(([pattern])=>values.some(value=>pattern.test(value))).map(([,type])=>type));
  const general = new Set(generalMappings.filter(([pattern])=>values.some(value=>pattern.test(value))).map(([,type])=>type));
  // Generic garden/park is an ancestor of botanical gardens and theme parks.
  if(specific.has('botanic-garden') || specific.has('theme-park')) general.delete('park-garden');
  const matches=new Set([...specific,...general]);
  return matches.size===1 ? [...matches][0] : 'other';
}
