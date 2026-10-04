import { Hono } from 'hono';
import { snapLinkInputSchema } from '../../shared/contracts';
import type { AppEnv } from '../app-types';
import { fail, readJson } from '../http';
import { requireActivePlace, snapFromRow, type SnapRow } from '../repository';

// Reference-only endpoints for the future Snaps integration. No media is uploaded or copied.
export const snaps = new Hono<AppEnv>();
snaps.post('/places/:placeId/snap-links', async (c) => {
  const placeId = c.req.param('placeId');
  await requireActivePlace(c.env.DB, placeId);
  const input = await readJson(c.req.raw, snapLinkInputSchema);
  if (
    input.visitId &&
    !(await c.env.DB.prepare(
      'SELECT id FROM place_visits WHERE id=? AND place_id=? AND archived_at IS NULL',
    )
      .bind(input.visitId, placeId)
      .first())
  )
    fail(400, 'The Snaps link must refer to an active visit to this place.');
  const existing = await c.env.DB.prepare(
    'SELECT id FROM place_snap_links WHERE place_id=? AND snap_id=?',
  )
    .bind(placeId, input.snapId)
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  if (input.isCover)
    statements.push(
      c.env.DB.prepare(
        'UPDATE place_snap_links SET is_cover=0 WHERE place_id=?',
      ).bind(placeId),
    );
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO place_snap_links(id,place_id,visit_id,snap_id,caption,is_cover,sort_order) VALUES(?,?,?,?,?,?,?) ON CONFLICT(place_id,snap_id) DO UPDATE SET visit_id=excluded.visit_id,caption=excluded.caption,is_cover=excluded.is_cover,sort_order=excluded.sort_order`,
    ).bind(
      id,
      placeId,
      input.visitId,
      input.snapId,
      input.caption,
      input.isCover ? 1 : 0,
      input.sortOrder,
    ),
  );
  await c.env.DB.batch(statements);
  const row = await c.env.DB.prepare(
    'SELECT * FROM place_snap_links WHERE id=?',
  )
    .bind(id)
    .first<SnapRow>();
  return c.json({ snap: snapFromRow(row!) }, existing ? 200 : 201);
});
snaps.delete('/places/:placeId/snap-links/:id', async (c) => {
  await requireActivePlace(c.env.DB, c.req.param('placeId'));
  // Unlinking a reference never deletes a photo in Snaps.
  const result = await c.env.DB.prepare(
    'DELETE FROM place_snap_links WHERE id=? AND place_id=?',
  )
    .bind(c.req.param('id'), c.req.param('placeId'))
    .run();
  if (!result.meta.changes) fail(404, 'Snaps link not found.');
  return c.body(null, 204);
});
