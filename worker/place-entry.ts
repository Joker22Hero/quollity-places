import type { Context } from 'hono';
import type { AppEnv } from './app-types';
import {
  placeInputSchema,
  type Place,
  type PlaceInput,
} from '../shared/contracts';
import {
  candidateSchema,
  locationFields,
  type Candidate,
  type LocationField,
} from '../shared/place-entry';
import { sha256 } from '../shared/agent-auth';
import { canonical, principal, problem } from './mutations';
import { placeFromRow, type PlaceRow } from './repository';
export const columns = [
  'name',
  'short_name',
  'place_type_id',
  'place_kind',
  'wishlist',
  'city',
  'region',
  'country_code',
  'latitude',
  'longitude',
  'website_url',
  'description',
  'notes',
  'operator',
  'meeting_point',
  'duration_minutes',
];
export function placeValues(input: PlaceInput) {
  return [
    input.name,
    input.shortName,
    input.placeTypeId,
    input.placeKind,
    input.wishlist ? 1 : 0,
    input.city,
    input.region,
    input.countryCode,
    input.latitude,
    input.longitude,
    input.websiteUrl,
    input.description,
    input.notes,
    input.operator,
    input.meetingPoint,
    input.durationMinutes,
  ];
}
export function insertPlace(db: D1Database, id: string, input: PlaceInput) {
  return db
    .prepare(
      `INSERT INTO places(id,${columns.join(',')}) VALUES(?,${columns.map(() => '?').join(',')})`,
    )
    .bind(id, ...placeValues(input));
}
export async function exactMatch(
  db: D1Database,
  candidate: Candidate,
): Promise<Place | null> {
  const row = await db
    .prepare(
      `SELECT p.* FROM place_summaries p JOIN place_sources s ON s.place_id=p.id WHERE s.purpose='identity' AND ((s.provider=? AND s.provider_id=?) OR (s.osm_type IS NOT NULL AND s.osm_type=? AND s.osm_id=?)) LIMIT 1`,
    )
    .bind(
      candidate.source.provider,
      candidate.source.providerId,
      candidate.source.osmType,
      candidate.source.osmId,
    )
    .first<PlaceRow>();
  return row ? placeFromRow(row) : null;
}
export const normaliseName = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
function nearby(a: PlaceInput, b: Place) {
  if (
    a.latitude === null ||
    b.latitude === null ||
    a.longitude === null ||
    b.longitude === null
  )
    return false;
  const radians = (value: number) => (value * Math.PI) / 180;
  const lat = radians(a.latitude - b.latitude),
    lon = radians(a.longitude - b.longitude);
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) < 300;
}
export async function probableMatches(
  db: D1Database,
  input: PlaceInput,
  exclude?: string,
) {
  // Bound to same kind/country where known; never deduplicate by coordinates alone.
  const rows = await db
    .prepare(
      `SELECT * FROM place_summaries WHERE place_kind=? ${input.countryCode ? 'AND (country_code=? OR country_code IS NULL)' : ''} ORDER BY name LIMIT 5000`,
    )
    .bind(input.placeKind, ...(input.countryCode ? [input.countryCode] : []))
    .all<PlaceRow>();
  return rows.results
    .map(placeFromRow)
    .filter(
      (p) =>
        p.id !== exclude &&
        normaliseName(p.name) === normaliseName(input.name) &&
        (nearby(input, p) ||
          !input.city ||
          !p.city ||
          normaliseName(input.city) === normaliseName(p.city)),
    )
    .slice(0, 8);
}
export async function checkDuplicates(
  c: Context<AppEnv>,
  input: PlaceInput,
  review?: string,
  exclude?: string,
) {
  const matches = await probableMatches(c.env.DB, input, exclude);
  if (!matches.length) return;
  const hash = await sha256(canonical(input)),
    matchIds = matches.map((p) => p.id).sort();
  if (review) {
    const row = await c.env.DB.prepare(
      'SELECT matches FROM duplicate_reviews WHERE id=? AND principal=? AND input_hash=? AND expires_at>?',
    )
      .bind(review, principal(c), hash, Date.now())
      .first<{ matches: string }>();
    if (row && row.matches === JSON.stringify(matchIds)) return;
  }
  const token = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO duplicate_reviews(id,principal,input_hash,matches,expires_at) VALUES(?,?,?,?,?)',
  )
    .bind(
      token,
      principal(c),
      hash,
      JSON.stringify(matchIds),
      Date.now() + 1800000,
    )
    .run();
  problem(
    409,
    'possible_duplicate',
    'A similar place is already saved. Open it, or confirm that this is a different place.',
    { matches, duplicateReviewToken: token },
  );
}
export async function selectedCandidate(
  c: Context<AppEnv>,
  input: { lookupId: string; candidateId: string },
) {
  const row = await c.env.DB.prepare(
    'SELECT candidates FROM place_lookups WHERE id=? AND principal=? AND expires_at>?',
  )
    .bind(input.lookupId, principal(c), Date.now())
    .first<{ candidates: string }>();
  if (!row)
    problem(
      409,
      'lookup_expired',
      'This lookup expired. Search and select the place again.',
    );
  const candidate = (JSON.parse(row.candidates) as unknown[])
    .map((v) => candidateSchema.parse(v))
    .find((v) => v.candidateId === input.candidateId);
  if (!candidate)
    problem(
      400,
      'invalid_candidate',
      'Select a candidate returned by this lookup.',
    );
  return candidate;
}
export function inputFromCandidate(
  candidate: Candidate,
  overrides: Partial<PlaceInput> = {},
) {
  const result = placeInputSchema.safeParse({
    name: candidate.name,
    placeTypeId: candidate.suggestedTypeId,
    ...Object.fromEntries(locationFields.map((k) => [k, candidate[k]])),
    ...overrides,
  });
  if (!result.success)
    problem(
      400,
      'invalid_place',
      result.error.issues.map((issue) => issue.message).join('; '),
    );
  return result.data;
}
export function sourceStatements(
  db: D1Database,
  placeId: string,
  candidate: Candidate,
  input: PlaceInput,
  fields: readonly LocationField[] = locationFields,
  purpose: 'identity' | 'location' = input.placeKind === 'physical_place' &&
  candidate.kind === 'place'
    ? 'identity'
    : 'location',
) {
  const sourceId = crypto.randomUUID();
  return [
    db
      .prepare(
        'INSERT INTO place_sources(id,place_id,provider,provider_id,osm_type,osm_id,purpose,snapshot,fetched_at,attribution) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        sourceId,
        placeId,
        candidate.source.provider,
        candidate.source.providerId,
        candidate.source.osmType,
        candidate.source.osmId,
        purpose,
        JSON.stringify(candidate),
        candidate.source.fetchedAt,
        JSON.stringify(candidate.source.attribution),
      ),
    ...fields.map((field) =>
      db
        .prepare(
          'INSERT INTO place_field_provenance(place_id,field,source_id,imported_value,overridden) VALUES(?,?,?,?,?) ON CONFLICT(place_id,field) DO UPDATE SET source_id=excluded.source_id,imported_value=excluded.imported_value,overridden=excluded.overridden',
        )
        .bind(
          placeId,
          field,
          sourceId,
          JSON.stringify(candidate[field]),
          input[field] === candidate[field] ? 0 : 1,
        ),
    ),
  ];
}
export async function locationDetail(db: D1Database, id: string) {
  const [sources, fields] = await Promise.all([
    db
      .prepare(
        'SELECT id,purpose,snapshot FROM place_sources WHERE place_id=? ORDER BY fetched_at DESC,id',
      )
      .bind(id)
      .all<{
        id: string;
        purpose: 'identity' | 'location';
        snapshot: string;
      }>(),
    db
      .prepare(
        'SELECT field,overridden FROM place_field_provenance WHERE place_id=?',
      )
      .bind(id)
      .all<{ field: LocationField; overridden: number }>(),
  ]);
  return {
    sources: sources.results.map((s) => ({
      id: s.id,
      purpose: s.purpose,
      candidate: candidateSchema.parse(JSON.parse(s.snapshot)),
    })),
    provenance: fields.results.map((p) => ({
      field: p.field,
      overridden: Boolean(p.overridden),
    })),
  };
}
export function manualOverrideStatements(
  db: D1Database,
  id: string,
  current: Place,
  input: PlaceInput,
) {
  return locationFields
    .filter((field) => current[field] !== input[field])
    .map((field) =>
      db
        .prepare(
          'INSERT INTO place_field_provenance(place_id,field,source_id,imported_value,overridden) VALUES(?,?,NULL,?,1) ON CONFLICT(place_id,field) DO UPDATE SET overridden=1',
        )
        .bind(id, field, JSON.stringify(current[field])),
    );
}
