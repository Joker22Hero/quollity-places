import { Hono } from 'hono';
import { z } from 'zod';
import {
  lookupInputSchema,
  importInputSchema,
  selectionSchema,
  applyLocationSchema,
  candidateSchema,
  locationFields,
} from '../../shared/place-entry';
import { eligibleForBoard } from '../../shared/rankings';
import type { AppEnv } from '../app-types';
import { readJson } from '../http';
import {
  prepareWrite,
  commitWrite,
  importedPlaceExpression,
  problem,
  principal,
  canonical,
  audit,
  revisionGuard,
} from '../mutations';
import { sha256 } from '../../shared/agent-auth';
import { lookupProvider } from '../geocoding';
import {
  getPlace,
  placeFromRow,
  boardFromRow,
  requireActivePlace,
  requireType,
  type PlaceRow,
  type BoardRow,
} from '../repository';
import {
  selectedCandidate,
  inputFromCandidate,
  exactMatch,
  checkDuplicates,
  insertPlace,
  sourceStatements,
  locationDetail,
  probableMatches,
} from '../place-entry';
export const placeEntry = new Hono<AppEnv>();
placeEntry.post('/place-lookups', async (c) => {
  const input = await readJson(c.req.raw, lookupInputSchema),
    db = c.env.DB,
    now = Date.now();
  const window = Math.floor(now / 60000);
  const rate = await db
    .prepare(
      'INSERT INTO place_lookup_limits(principal,window,count) VALUES(?,?,1) ON CONFLICT(principal,window) DO UPDATE SET count=count+1 RETURNING count',
    )
    .bind(principal(c), window)
    .first<{ count: number }>();
  if (rate && rate.count > 30)
    return c.json(
      {
        error: 'Too many lookups. Try again in a minute.',
        code: 'rate_limited',
      },
      429,
      { 'Retry-After': '60' },
    );
  await db.batch([
    db
      .prepare('DELETE FROM place_lookup_limits WHERE window<?')
      .bind(window - 2),
    db.prepare('DELETE FROM place_lookups WHERE expires_at<=?').bind(now),
    db.prepare('DELETE FROM place_lookup_cache WHERE expires_at<=?').bind(now),
    db.prepare('DELETE FROM duplicate_reviews WHERE expires_at<=?').bind(now),
    db.prepare('DELETE FROM api_idempotency WHERE expires_at<=?').bind(now),
  ]);
  const pattern =
    '%' +
    input.query
      .split(',')[0]
      .trim()
      .replace(/[\\%_]/g, '\\$&') +
    '%';
  const rows = await db
    .prepare(
      `SELECT * FROM place_summaries WHERE name LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' ORDER BY archived_at IS NOT NULL,name LIMIT 8`,
    )
    .bind(pattern, pattern)
    .all<PlaceRow>();
  const cacheKey = await sha256(canonical(input));
  const cached = await db
    .prepare(
      'SELECT candidates FROM place_lookup_cache WHERE cache_key=? AND expires_at>?',
    )
    .bind(cacheKey, now)
    .first<{ candidates: string }>();
  let candidates: z.infer<typeof candidateSchema>[] = [];
  let unavailable = false;
  if (cached)
    candidates = z.array(candidateSchema).parse(JSON.parse(cached.candidates));
  else if (c.env.GEOAPIFY_API_KEY) {
    try {
      candidates = await lookupProvider(input, c.env.GEOAPIFY_API_KEY);
      await db
        .prepare(
          'INSERT INTO place_lookup_cache(cache_key,candidates,expires_at) VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET candidates=excluded.candidates,expires_at=excluded.expires_at',
        )
        .bind(cacheKey, JSON.stringify(candidates), now + 86400000)
        .run();
    } catch {
      unavailable = true;
    }
  } else unavailable = true;
  const lookupId = crypto.randomUUID(),
    expires = now + 1800000;
  await db
    .prepare(
      'INSERT INTO place_lookups(id,principal,candidates,expires_at) VALUES(?,?,?,?)',
    )
    .bind(lookupId, principal(c), JSON.stringify(candidates), expires)
    .run();
  const matches = await Promise.all(
    candidates.map(async (candidate) => {
      const exact =
        candidate.kind === 'place' ? await exactMatch(db, candidate) : null;
      const probable = await probableMatches(db, inputFromCandidate(candidate));
      return {
        ...candidate,
        duplicates: [
          ...(exact
            ? [{ place: exact, reason: 'source_identity' as const }]
            : []),
          ...probable
            .filter((p) => p.id !== exact?.id)
            .map((place) => ({ place, reason: 'name_location' as const })),
        ],
      };
    }),
  );
  return c.json({
    lookupId,
    expiresAt: new Date(expires).toISOString(),
    savedMatches: rows.results.map(placeFromRow),
    candidates: matches,
    resolution: unavailable
      ? 'provider_unavailable'
      : candidates.length
        ? 'candidates'
        : 'no_match',
    warnings: unavailable
      ? [
          'Location lookup is unavailable. You can still add a place without lookup.',
        ]
      : [],
  });
});
placeEntry.post('/places/import', async (c) => {
  const input = await readJson(c.req.raw, importInputSchema),
    write = await prepareWrite(c, input, true);
  if (write.replay) return write.replay;
  const candidate = await selectedCandidate(c, input);
  if (candidate.kind === 'locality' && input.placeKind === 'physical_place')
    problem(
      400,
      'not_a_place',
      'This result is a city or area. Search for the attraction, or add it without lookup.',
    );
  const values = inputFromCandidate(candidate, {
    ...input.overrides,
    placeTypeId: input.placeTypeId ?? candidate.suggestedTypeId,
    placeKind: input.placeKind,
    wishlist: input.wishlist,
    notes: input.notes,
    shortName: input.shortName,
    description: input.description,
    operator: input.operator,
    meetingPoint: input.meetingPoint,
    durationMinutes: input.durationMinutes,
  });
  await requireType(c.env.DB, values.placeTypeId);
  async function reuse() {
    const existing =
      input.placeKind === 'physical_place' && candidate.kind === 'place'
        ? await exactMatch(c.env.DB, candidate)
        : null;
    if (!existing) return null;
    if (existing.archivedAt)
      problem(
        409,
        'place_archived',
        'This place is archived. Restore it explicitly before adding visits.',
        { placeId: existing.id },
      );
    if (input.duplicateAction !== 'reuse_exact')
      problem(409, 'place_exists', 'This place is already saved.', {
        placeId: existing.id,
      });
    return commitWrite(
      c,
      write,
      [],
      importedPlaceExpression('existing', ['overrides_not_applied']),
      [existing.id],
      200,
      existing.id,
    );
  }
  const existing = await reuse();
  if (existing) return existing;
  await checkDuplicates(c, values, input.duplicateReviewToken);
  const id = crypto.randomUUID();
  try {
    return await commitWrite(
      c,
      write,
      [
        insertPlace(c.env.DB, id, values),
        ...sourceStatements(c.env.DB, id, candidate, values),
      ],
      importedPlaceExpression(
        'created',
        candidate.precision === 'approximate' ? ['approximate_location'] : [],
      ),
      [id],
      201,
      id,
    );
  } catch (error) {
    const winner = await reuse();
    if (winner) return winner;
    throw error;
  }
});
placeEntry.post('/places/:id/location-preview', async (c) => {
  const place = await requireActivePlace(c.env.DB, c.req.param('id')),
    candidate = await selectedCandidate(
      c,
      await readJson(c.req.raw, selectionSchema),
    );
  const detail = await locationDetail(c.env.DB, place.id);
  const protectedField = (field: (typeof locationFields)[number]) =>
    detail.provenance.some((p) => p.field === field && p.overridden) ||
    (place[field] !== null &&
      !detail.provenance.some((p) => p.field === field));
  return c.json({
    revision: place.revision,
    candidate,
    changes: locationFields
      .filter(
        (field) =>
          candidate[field] !== null &&
          (candidate[field] !== place[field] ||
            ((field === 'latitude' || field === 'longitude') &&
              (candidate.latitude !== place.latitude ||
                candidate.longitude !== place.longitude))),
      )
      .map((field) => ({
        field,
        current: place[field],
        proposed: candidate[field],
        protected:
          field === 'latitude' || field === 'longitude'
            ? protectedField('latitude') || protectedField('longitude')
            : protectedField(field),
      })),
  });
});
placeEntry.patch('/places/:id/location', async (c) => {
  const id = c.req.param('id'),
    place = await requireActivePlace(c.env.DB, id),
    input = await readJson(c.req.raw, applyLocationSchema),
    candidate = await selectedCandidate(c, input);
  if (input.revision !== place.revision)
    problem(
      409,
      'stale_revision',
      'This place changed. Preview the location again.',
    );
  if (candidate.kind === 'locality' && place.placeKind === 'physical_place')
    problem(
      400,
      'not_a_place',
      'Choose an attraction or address rather than a city or area.',
    );
  if (input.fields.some((field) => candidate[field] === null))
    problem(
      400,
      'missing_source_value',
      'The selected source has no value for one of these fields.',
    );
  if (input.fields.includes('latitude') !== input.fields.includes('longitude'))
    problem(400, 'coordinate_pair', 'Apply both coordinates together.');
  const exact = await exactMatch(c.env.DB, candidate);
  if (place.placeKind === 'physical_place' && exact && exact.id !== id)
    problem(
      409,
      'place_exists',
      'This source belongs to another saved place.',
      { placeId: exact.id },
    );
  const proposed = inputFromCandidate(candidate, {
    ...place,
    ...Object.fromEntries(
      input.fields.map((field) => [field, candidate[field]]),
    ),
  });
  const boards = await c.env.DB.prepare(
    'SELECT b.* FROM ranking_boards b JOIN place_rankings r ON r.board_id=b.id WHERE r.place_id=? AND b.archived_at IS NULL',
  )
    .bind(id)
    .all<BoardRow>();
  if (
    boards.results.some(
      (row) => !eligibleForBoard({ ...place, ...proposed }, boardFromRow(row)),
    )
  )
    problem(
      409,
      'incompatible_board',
      'Remove this place from incompatible ranking boards before changing its location.',
    );
  const guard = revisionGuard(c.env.DB, id, input.revision);
  const sqlFields = {
    city: 'city',
    region: 'region',
    countryCode: 'country_code',
    latitude: 'latitude',
    longitude: 'longitude',
    websiteUrl: 'website_url',
  };
  // Location repair records location evidence; it cannot silently change attraction identity.
  try {
    await c.env.DB.batch([
      guard.start,
      c.env.DB.prepare(
        `UPDATE places SET ${input.fields.map((f) => `${sqlFields[f]}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).bind(...input.fields.map((f) => proposed[f]), id),
      ...sourceStatements(
        c.env.DB,
        id,
        candidate,
        proposed,
        input.fields,
        'location',
      ),
      audit(c, 'location.update', id),
      guard.end,
    ]);
  } catch (error) {
    if (/mutation_guards|CHECK constraint/.test(String(error)))
      problem(
        409,
        'stale_revision',
        'This place changed. Preview the location again.',
      );
    throw error;
  }
  return c.json({ place: await getPlace(c.env.DB, id) });
});
