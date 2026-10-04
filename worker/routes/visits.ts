import { Hono } from 'hono';
import { archiveInputSchema, visitInputSchema } from '../../shared/contracts';
import { placeUrl } from '../../shared/paths';
import type { AppEnv } from '../app-types';
import { fail, readJson } from '../http';
import {
  getPlace,
  requireActivePlace,
  visitSelect,
  visitsFromRows,
  type VisitRow,
} from '../repository';
import { validateTrip } from '../trips';

export const visits = new Hono<AppEnv>();
async function visitById(db: D1Database, id: string) {
  const row = await db
    .prepare(`${visitSelect} WHERE v.id=?`)
    .bind(id)
    .first<VisitRow>();
  if (!row) fail(404, 'Visit not found.');
  return (await visitsFromRows(db, [row]))[0];
}
async function validateAttendees(
  db: D1Database,
  ids: string[],
  existing: string[] = [],
) {
  for (const id of ids) {
    const row = await db
      .prepare('SELECT active FROM people WHERE id=?')
      .bind(id)
      .first<{ active: number }>();
    if (!row || (!row.active && !existing.includes(id)))
      fail(400, 'Select active attendees from the people list.');
  }
}
function attendeeStatements(db: D1Database, id: string, ids: string[]) {
  return [
    db.prepare('DELETE FROM visit_attendees WHERE visit_id=?').bind(id),
    ...ids.map((person) =>
      db
        .prepare('INSERT INTO visit_attendees(visit_id,person_id) VALUES(?,?)')
        .bind(id, person),
    ),
  ];
}
visits.post('/places/:placeId/visits', async (c) => {
  const placeId = c.req.param('placeId');
  await requireActivePlace(c.env.DB, placeId);
  const input = await readJson(c.req.raw, visitInputSchema);
  await validateAttendees(c.env.DB, input.attendeeIds);
  const id = crypto.randomUUID();
  const person = c.get('session').person!;
  const statements: D1PreparedStatement[] = [];
  if (input.tripId)
    statements.push(
      await validateTrip(
        c.env,
        input.tripId,
        c.req.header('X-Quollity-Identity') ?? '',
      ),
    );
  statements.push(
    c.env.DB.prepare(
      'INSERT INTO place_visits(id,place_id,trip_id,date,end_date,rating_tenths,notes,would_revisit,created_by) VALUES(?,?,?,?,?,?,?,?,?)',
    ).bind(
      id,
      placeId,
      input.tripId,
      input.date,
      input.endDate,
      input.overallRating === null
        ? null
        : Math.round(input.overallRating * 10),
      input.notes,
      input.wouldRevisit,
      person.id,
    ),
  );
  statements.push(...attendeeStatements(c.env.DB, id, input.attendeeIds));
  await c.env.DB.batch(statements);
  return c.json({ visit: await visitById(c.env.DB, id) }, 201);
});
visits.get('/visits', async (c) => {
  const tripId = c.req.query('tripId');
  if (!tripId || tripId.length > 200)
    fail(400, 'Supply a tripId to list linked place visits.');
  const offset = Number(c.req.query('offset') ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    fail(400, 'Invalid offset.');
  const rows = await c.env.DB.prepare(
    `${visitSelect} JOIN places p ON p.id=v.place_id WHERE v.trip_id=? AND v.archived_at IS NULL AND p.archived_at IS NULL ORDER BY v.date,v.id LIMIT 100 OFFSET ?`,
  )
    .bind(tripId, offset)
    .all<VisitRow>();
  const results = await visitsFromRows(c.env.DB, rows.results);
  const places = await Promise.all(
    [...new Set(results.map((visit) => visit.placeId))].map((id) =>
      getPlace(c.env.DB, id),
    ),
  );
  return c.json({
    visits: results.map((visit) => ({
      ...visit,
      place: places.find((place) => place.id === visit.placeId),
      canonicalUrl: placeUrl(visit.placeId),
    })),
    offset,
    limit: 100,
  });
});
visits.put('/visits/:id', async (c) => {
  const id = c.req.param('id');
  const visit = await visitById(c.env.DB, id);
  await requireActivePlace(c.env.DB, visit.placeId);
  if (visit.archivedAt) fail(409, 'Restore this visit before editing it.');
  const input = await readJson(c.req.raw, visitInputSchema);
  await validateAttendees(
    c.env.DB,
    input.attendeeIds,
    visit.attendees.map((person) => person.id),
  );
  const statements: D1PreparedStatement[] = [];
  // Retain an existing validated link when editing offline; changed links must be revalidated.
  if (input.tripId && input.tripId !== visit.tripId)
    statements.push(
      await validateTrip(
        c.env,
        input.tripId,
        c.req.header('X-Quollity-Identity') ?? '',
      ),
    );
  statements.push(
    c.env.DB.prepare(
      'UPDATE place_visits SET trip_id=?,date=?,end_date=?,rating_tenths=?,notes=?,would_revisit=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND archived_at IS NULL',
    ).bind(
      input.tripId,
      input.date,
      input.endDate,
      input.overallRating === null
        ? null
        : Math.round(input.overallRating * 10),
      input.notes,
      input.wouldRevisit,
      id,
    ),
  );
  statements.push(...attendeeStatements(c.env.DB, id, input.attendeeIds));
  await c.env.DB.batch(statements);
  return c.json({ visit: await visitById(c.env.DB, id) });
});
visits.put('/visits/:id/archive', async (c) => {
  const id = c.req.param('id');
  const visit = await visitById(c.env.DB, id);
  await requireActivePlace(c.env.DB, visit.placeId);
  const input = await readJson(c.req.raw, archiveInputSchema);
  await c.env.DB.prepare(
    'UPDATE place_visits SET archived_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
  )
    .bind(input.archived ? new Date().toISOString() : null, id)
    .run();
  return c.json({ visit: await visitById(c.env.DB, id) });
});
