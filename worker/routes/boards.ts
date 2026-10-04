import { Hono } from 'hono';
import {
  archiveInputSchema,
  boardEntriesInputSchema,
  boardInputSchema,
} from '../../shared/contracts';
import { eligibleForBoard } from '../../shared/rankings';
import type { AppEnv } from '../app-types';
import { fail, readJson } from '../http';
import {
  boardFromRow,
  getBoard,
  placeFromRow,
  requireType,
  type BoardRow,
  type PlaceRow,
} from '../repository';

export const boards = new Hono<AppEnv>();
boards.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM ranking_boards WHERE archived_at IS ${c.req.query('archived') === 'true' ? 'NOT ' : ''}NULL ORDER BY name COLLATE NOCASE LIMIT 500`,
  ).all<BoardRow>();
  return c.json({ boards: rows.results.map(boardFromRow) });
});
boards.post('/', async (c) => {
  const input = await readJson(c.req.raw, boardInputSchema);
  await requireType(c.env.DB, input.placeTypeFilter);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO ranking_boards(id,name,place_type_filter,country_filter,region_filter,created_by) VALUES(?,?,?,?,?,?)',
  )
    .bind(
      id,
      input.name,
      input.placeTypeFilter,
      input.countryFilter,
      input.regionFilter,
      c.get('session').person!.id,
    )
    .run();
  return c.json({ board: await getBoard(c.env.DB, id) }, 201);
});
boards.get('/:id', async (c) => {
  const id = c.req.param('id');
  const board = await getBoard(c.env.DB, id);
  const entries = await c.env.DB.prepare(
    'SELECT p.*,r.rank,r.note AS ranking_note FROM place_rankings r JOIN place_summaries p ON p.id=r.place_id WHERE r.board_id=? ORDER BY r.rank',
  )
    .bind(id)
    .all<PlaceRow & { rank: number; ranking_note: string | null }>();
  return c.json({
    board,
    entries: entries.results.map((row) => ({
      rank: row.rank,
      note: row.ranking_note,
      place: placeFromRow(row),
    })),
  });
});
boards.put('/:id', async (c) => {
  const id = c.req.param('id');
  const board = await getBoard(c.env.DB, id);
  if (board.archivedAt) fail(409, 'Restore the board before editing it.');
  const input = await readJson(c.req.raw, boardInputSchema);
  await requireType(c.env.DB, input.placeTypeFilter);
  if (
    input.placeTypeFilter !== board.placeTypeFilter ||
    input.countryFilter !== board.countryFilter ||
    input.regionFilter !== board.regionFilter
  ) {
    const members = await c.env.DB.prepare(
      'SELECT p.* FROM place_summaries p JOIN place_rankings r ON r.place_id=p.id WHERE r.board_id=?',
    )
      .bind(id)
      .all<PlaceRow>();
    if (
      members.results.some(
        (row) =>
          !eligibleForBoard({ ...placeFromRow(row), archivedAt: null }, input),
      )
    )
      fail(
        409,
        'Remove incompatible places before changing the collection filters.',
      );
  }
  await c.env.DB.prepare(
    'UPDATE ranking_boards SET name=?,place_type_filter=?,country_filter=?,region_filter=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND archived_at IS NULL',
  )
    .bind(
      input.name,
      input.placeTypeFilter,
      input.countryFilter,
      input.regionFilter,
      id,
    )
    .run();
  return c.json({ board: await getBoard(c.env.DB, id) });
});
boards.put('/:id/entries', async (c) => {
  const id = c.req.param('id');
  const board = await getBoard(c.env.DB, id);
  if (board.archivedAt) fail(409, 'Restore the board before editing it.');
  const input = await readJson(c.req.raw, boardEntriesInputSchema);
  // Validate every member before replacing the order atomically.
  for (let offset = 0; offset < input.entries.length; offset += 80) {
    const part = input.entries.slice(offset, offset + 80);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM place_summaries WHERE id IN (${part.map(() => '?').join(',')})`,
    )
      .bind(...part.map((entry) => entry.placeId))
      .all<PlaceRow>();
    if (rows.results.length !== part.length)
      fail(404, 'A selected place no longer exists.');
    for (const row of rows.results) {
      const place = placeFromRow(row);
      if (!eligibleForBoard(place, board))
        fail(
          400,
          `${place.name} does not match this board's filters or is archived.`,
        );
    }
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM place_rankings WHERE board_id=?').bind(id),
    ...input.entries.map((entry, index) =>
      c.env.DB.prepare(
        'INSERT INTO place_rankings(board_id,place_id,rank,note) VALUES(?,?,?,?)',
      ).bind(id, entry.placeId, index + 1, entry.note),
    ),
    c.env.DB.prepare(
      'UPDATE ranking_boards SET updated_at=CURRENT_TIMESTAMP WHERE id=?',
    ).bind(id),
  ]);
  return c.json({ saved: true });
});
boards.put('/:id/archive', async (c) => {
  const id = c.req.param('id');
  await getBoard(c.env.DB, id);
  const input = await readJson(c.req.raw, archiveInputSchema);
  await c.env.DB.prepare(
    'UPDATE ranking_boards SET archived_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
  )
    .bind(input.archived ? new Date().toISOString() : null, id)
    .run();
  return c.json({ board: await getBoard(c.env.DB, id) });
});
