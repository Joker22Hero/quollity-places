import { z } from 'zod';
import catalog from '../data/overture-places.json';
import {
  candidateSchema,
  attributionSchema,
  type Candidate,
} from '../shared/place-entry';
import { httpUrlSchema, placeFactsSchema } from '../shared/place-facts';

const optionalText = z.string().trim().min(1).max(200).nullable().default(null);
export const overtureRecordSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  city: optionalText,
  region: optionalText,
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .default(null),
  typeId: z.enum([
    'botanic-garden',
    'museum',
    'art-gallery',
    'castle',
    'historic-house',
    'church',
    'temple',
    'monument',
    'archaeological-site',
    'scenic-attraction',
    'park-garden',
    'aquarium',
    'theme-park',
    'tour',
    'boat-trip',
    'railway-cable-car',
    'visitor-experience',
    'other',
  ]),
  websiteUrl: httpUrlSchema.nullable().default(null),
  facts: placeFactsSchema.default(() => placeFactsSchema.parse({})),
  existenceConfidence: z.number().min(0).max(1).nullable().default(null),
  release: z.string().trim().min(1).max(100),
  sources: z
    .array(
      z.strictObject({
        label: z.string().trim().min(1).max(300),
        license: z.string().trim().min(1).max(200),
        url: httpUrlSchema,
      }),
    )
    .min(1)
    .max(10),
  attribution: z.array(attributionSchema).min(1).max(15),
});
export const overtureCatalogSchema = z
  .array(overtureRecordSchema)
  .max(1000)
  .refine(
    (records) =>
      new Set(records.map((record) => record.id)).size === records.length,
    'Duplicate GERS identity',
  );
export type OvertureRecord = z.infer<typeof overtureRecordSchema>;

function normaliseName(name: string) {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
function similarity(left: string, right: string) {
  const a = normaliseName(left),
    b = normaliseName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aa = new Set(a.split(' ')),
    bb = new Set(b.split(' '));
  const intersection = [...aa].filter((word) => bb.has(word)).length;
  return (2 * intersection) / (aa.size + bb.size);
}
export function distanceMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const radians = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * radians,
    lon = (b.longitude - a.longitude) * radians;
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
const compatibleType = (a: string, b: string) =>
  a === b || a === 'other' || b === 'other';
// No remote service, global ingestion or page-render fetching. An empty bounded
// catalog leaves Geoapify intact; selected regional records can be prepared by CLI.
export function resolveOverture(
  candidate: Candidate,
  input: unknown = catalog,
): Candidate {
  const parsed = overtureCatalogSchema.safeParse(input);
  if (
    !parsed.success ||
    candidate.kind !== 'place' ||
    candidate.latitude === null ||
    candidate.longitude === null
  )
    return candidate;
  const point = {
    latitude: candidate.latitude,
    longitude: candidate.longitude,
  };
  const matches = parsed.data.flatMap((record) => {
    if (
      distanceMetres(point, record) > 150 ||
      !compatibleType(candidate.suggestedTypeId, record.typeId)
    )
      return [];
    if (
      candidate.countryCode &&
      record.countryCode &&
      candidate.countryCode !== record.countryCode
    )
      return [];
    if (
      candidate.city &&
      record.city &&
      normaliseName(candidate.city) !== normaliseName(record.city)
    )
      return [];
    if (
      candidate.facts.streetAddress &&
      record.facts.streetAddress &&
      normaliseName(candidate.facts.streetAddress) !==
        normaliseName(record.facts.streetAddress)
    )
      return [];
    const names = [
      candidate.name,
      ...candidate.facts.alternateNames,
      candidate.facts.localName,
    ].filter((v): v is string => Boolean(v));
    const score = Math.max(
      ...names.flatMap((name) =>
        [record.name, ...record.aliases].map((other) =>
          similarity(name, other),
        ),
      ),
    );
    return score >= 0.9 ? [{ record, score }] : [];
  });
  // Even a slightly higher score is insufficient to disambiguate two nearby POIs.
  if (matches.length !== 1) return candidate;
  const { record, score } = matches[0];
  const facts = { ...candidate.facts };
  for (const field of [
    'localName',
    'streetAddress',
    'postcode',
    'phone',
    'operatingStatus',
  ] as const) {
    if (record.facts[field] !== null)
      Object.assign(facts, { [field]: record.facts[field] });
  }
  facts.alternateNames = [
    ...new Set([
      ...record.aliases,
      ...record.facts.alternateNames,
      ...candidate.facts.alternateNames,
      ...(candidate.name !== record.name ? [candidate.name] : []),
    ]),
  ].slice(0, 30);
  if (record.facts.socialLinks.length)
    facts.socialLinks = record.facts.socialLinks;
  return candidateSchema.parse({
    ...candidate,
    name: record.name,
    city: record.city ?? candidate.city,
    region: record.region ?? candidate.region,
    countryCode: record.countryCode ?? candidate.countryCode,
    latitude: record.latitude,
    longitude: record.longitude,
    suggestedTypeId:
      record.typeId === 'other' ? candidate.suggestedTypeId : record.typeId,
    websiteUrl: record.websiteUrl ?? candidate.websiteUrl,
    facts,
    externalIds: [
      {
        provider: 'overture',
        id: record.id,
        confidence: score,
        url: `https://explore.overturemaps.org/?gers=${record.id}`,
        sourceVersion: record.release,
        license: [
          ...new Set(record.sources.map((source) => source.license)),
        ].join('; '),
        existenceConfidence: record.existenceConfidence,
      },
      ...candidate.externalIds.filter((id) => id.provider !== 'overture'),
    ].slice(0, 8),
    source: {
      ...candidate.source,
      attribution: [
        ...candidate.source.attribution,
        ...record.attribution,
      ].filter(
        (item, i, all) =>
          all.findIndex(
            (other) => other.label === item.label && other.url === item.url,
          ) === i,
      ),
    },
  });
}
