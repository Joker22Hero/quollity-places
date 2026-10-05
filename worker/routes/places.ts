import { Hono } from 'hono';
import { z } from 'zod';
import { archiveInputSchema, placeInputSchema } from '../../shared/contracts';
import { eligibleForBoard } from '../../shared/rankings';
import type { AppEnv } from '../app-types';
import { fail, readJson } from '../http';
import {
  boardFromRow,
  getPlace,
  placeFromRow,
  requireActivePlace,
  requireType,
  snapFromRow,
  visitSelect,
  visitsFromRows,
  type BoardRow,
  type PlaceRow,
  type SnapRow,
  type VisitRow,
} from '../repository';

import { manualCreateSchema } from '../../shared/place-entry';
import {
  columns,
  placeValues,
  insertPlace,
  checkDuplicates,
  locationDetail,
  manualOverrideStatements,
} from '../place-entry';
import {
  prepareWrite,
  commitWrite,
  savedPlaceExpression,
  audit,
} from '../mutations';

export const places = new Hono<AppEnv>();
const filtersSchema = z.object({
  type: z.string().max(100).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  region: z.string().max(200).optional(),
  trip: z.string().max(200).optional(),
  attendee: z.uuid().optional(),
  year: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  q: z.string().max(200).optional(),
  wishlist: z.enum(['true', 'false']).optional(),
  hasSnaps: z.enum(['true', 'false']).optional(),
  archived: z.enum(['true', 'false']).default('false'),
  minRating: z.coerce.number().min(1).max(5).optional(),
  sort: z.enum(['name', 'rating', 'recent']).default('name'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
function whereFromFilters(input: z.output<typeof filtersSchema>) {
  const terms = [
    input.archived === 'true'
      ? 'p.archived_at IS NOT NULL'
      : 'p.archived_at IS NULL',
  ];
  const args: (string | number)[] = [];
  for (const [key, column] of [
    ['type', 'place_type_id'],
    ['country', 'country_code'],
    ['region', 'region'],
  ] as const) {
    if (input[key]) {
      terms.push(`p.${column}=? COLLATE NOCASE`);
      args.push(input[key]!);
    }
  }
  if (input.q) {
    terms.push("(p.name LIKE ? ESCAPE '\\' OR p.city LIKE ? ESCAPE '\\')");
    const pattern = `%${input.q.replace(/[\\%_]/g, '\\$&')}%`;
    args.push(pattern, pattern);
  }
  if (input.wishlist) {
    terms.push('p.wishlist=?');
    args.push(input.wishlist === 'true' ? 1 : 0);
  }
  if (input.minRating !== undefined) {
    terms.push('p.average_rating>=?');
    args.push(input.minRating);
  }
  if (input.hasSnaps)
    terms.push(
      `${input.hasSnaps === 'false' ? 'NOT ' : ''}EXISTS(SELECT 1 FROM place_snap_links s WHERE s.place_id=p.id)`,
    );
  if (input.trip || input.attendee || input.year) {
    const visitTerms = ['v.place_id=p.id', 'v.archived_at IS NULL'];
    if (input.trip) {
      visitTerms.push('v.trip_id=?');
      args.push(input.trip);
    }
    if (input.year) {
      visitTerms.push('substr(v.date,1,4)=?');
      args.push(input.year);
    }
    if (input.attendee) {
      visitTerms.push(
        'EXISTS(SELECT 1 FROM visit_attendees a WHERE a.visit_id=v.id AND a.person_id=?)',
      );
      args.push(input.attendee);
    }
    terms.push(
      `EXISTS(SELECT 1 FROM place_visits v WHERE ${visitTerms.join(' AND ')})`,
    );
  }
  return { where: terms.join(' AND '), args };
}
places.get('/', async (c) => {
  const parsed = filtersSchema.safeParse(c.req.query());
  if (!parsed.success) fail(400, 'Invalid directory filters.');
  const input = parsed.data;
  const { where, args } = whereFromFilters(input);
  const order =
    input.sort === 'rating'
      ? 'p.average_rating DESC,p.name COLLATE NOCASE,p.id'
      : input.sort === 'recent'
        ? 'p.latest_visit_date DESC,p.name COLLATE NOCASE,p.id'
        : 'p.name COLLATE NOCASE,p.id';
  const [rows, stats] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.* FROM place_summaries p WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
      .bind(...args, input.limit, input.offset)
      .all<PlaceRow>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN visit_count>0 THEN 1 ELSE 0 END),0) AS visited,COUNT(DISTINCT CASE WHEN visit_count>0 THEN country_code END) AS countries,COUNT(DISTINCT CASE WHEN visit_count>0 THEN place_type_id END) AS types FROM place_summaries p WHERE ${where}`,
    )
      .bind(...args)
      .first<{
        total: number;
        visited: number;
        countries: number;
        types: number;
      }>(),
  ]);
  return c.json({
    places: rows.results.map(placeFromRow),
    stats,
    limit: input.limit,
    offset: input.offset,
  });
});
places.get('/rankings', async (c) => {
  const parsed = filtersSchema.safeParse(c.req.query());
  if (!parsed.success) fail(400, 'Invalid ranking filters.');
  const { where, args } = whereFromFilters(parsed.data);
  // Rank in SQL across the whole filtered set, then paginate, preserving ties.
  const rows = await c.env.DB.prepare(
    `SELECT p.*,RANK() OVER(ORDER BY p.average_rating DESC) AS rank FROM place_summaries p WHERE ${where} AND p.average_rating IS NOT NULL ORDER BY p.average_rating DESC,p.name COLLATE NOCASE,p.id LIMIT ? OFFSET ?`,
  )
    .bind(...args, parsed.data.limit, parsed.data.offset)
    .all<PlaceRow & { rank: number }>();
  return c.json({
    rankings: rows.results.map((row) => ({
      rank: row.rank,
      place: placeFromRow(row),
    })),
  });
});
places.post('/', async (c) => {
  const input = await readJson(c.req.raw, manualCreateSchema);
  const write = await prepareWrite(c, input);
  if (write.replay) return write.replay;
  await requireType(c.env.DB, input.placeTypeId);
  const { duplicateReviewToken, ...values } = input;
  await checkDuplicates(c, values, duplicateReviewToken);
  const id = crypto.randomUUID();
  return commitWrite(
    c,
    write,
    [insertPlace(c.env.DB, id, input)],
    savedPlaceExpression,
    [id],
    201,
    id,
  );
});
places.get('/:id', async (c) => {
  const id = c.req.param('id');
  const place = await getPlace(c.env.DB, id);
  const [visitRows, snaps, boards] = await Promise.all([
    c.env.DB.prepare(
      `${visitSelect} WHERE v.place_id=? ORDER BY v.date DESC,v.created_at DESC,v.id LIMIT 500`,
    )
      .bind(id)
      .all<VisitRow>(),
    c.env.DB.prepare(
      'SELECT * FROM place_snap_links WHERE place_id=? ORDER BY is_cover DESC,sort_order,id',
    )
      .bind(id)
      .all<SnapRow>(),
    c.env.DB.prepare(
      'SELECT b.*,r.rank,r.note FROM ranking_boards b JOIN place_rankings r ON r.board_id=b.id WHERE r.place_id=? AND b.archived_at IS NULL ORDER BY b.name',
    )
      .bind(id)
      .all<BoardRow & { rank: number; note: string | null }>(),
  ]);
  return c.json({
    place,
    location: await locationDetail(c.env.DB, id),
    visits: await visitsFromRows(c.env.DB, visitRows.results),
    snaps: snaps.results.map(snapFromRow),
    boards: boards.results.map((row) => ({
      ...boardFromRow(row),
      rank: row.rank,
      note: row.note,
    })),
  });
});
places.put('/:id', async (c) => {
  const id = c.req.param('id');
  await requireActivePlace(c.env.DB, id);
  const input = await readJson(c.req.raw, placeInputSchema);
  await requireType(c.env.DB, input.placeTypeId);
  const current = await getPlace(c.env.DB, id);
  if (
    input.placeTypeId !== current.placeTypeId ||
    input.countryCode !== current.countryCode ||
    input.region !== current.region
  ) {
    const boards = await c.env.DB.prepare(
      'SELECT b.* FROM ranking_boards b JOIN place_rankings r ON r.board_id=b.id WHERE r.place_id=? AND b.archived_at IS NULL',
    )
      .bind(id)
      .all<BoardRow>();
    if (
      boards.results.some(
        (row) => !eligibleForBoard({ ...current, ...input }, boardFromRow(row)),
      )
    )
      fail(
        409,
        'Remove this place from incompatible ranking boards before changing its type or location.',
      );
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE places SET ${columns.map((column) => `${column}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=? AND archived_at IS NULL`,
    ).bind(...placeValues(input), id),
    ...manualOverrideStatements(c.env.DB, id, current, input),
    ...(current.placeKind === 'physical_place' &&
    input.placeKind === 'experience'
      ? [
          c.env.DB.prepare(
            "UPDATE place_sources SET purpose='location' WHERE place_id=? AND purpose='identity'",
          ).bind(id),
        ]
      : []),
    audit(c, 'place.update', id),
  ]);
  return c.json({ place: await getPlace(c.env.DB, id) });
});
places.put('/:id/archive', async (c) => {
  const id = c.req.param('id');
  await getPlace(c.env.DB, id);
  const input = await readJson(c.req.raw, archiveInputSchema);
  await c.env.DB.prepare(
    'UPDATE places SET archived_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
  )
    .bind(input.archived ? new Date().toISOString() : null, id)
    .run();
  return c.json({ place: await getPlace(c.env.DB, id) });
});
