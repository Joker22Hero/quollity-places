import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './app-types';
import { authenticate } from './auth';
import { fail, readJson } from './http';
import { personInputSchema } from '../shared/contracts';
import { personFromRow, type PersonRow } from './repository';
import { tripsCatalogue } from './trips';
import { places } from './routes/places';
import { visits } from './routes/visits';
import { boards } from './routes/boards';
import { snaps } from './routes/snaps';
import { placeEntry } from './routes/place-entry';
import { agentSession } from './agent';
import { openapi } from './openapi';

export const app = new Hono<AppEnv>();
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  if (c.req.header('Authorization') !== undefined)
    fail(401, 'Authenticate bearer credentials through the Quollity gateway.');
  if (!(await agentSession(c)))
    c.set('session', await authenticate(c.req.raw, c.env));
  const session = c.get('session');
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    if (session.readOnly) fail(403, 'An editor account is required.');
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin)
      fail(403, 'Cross-origin writes are not allowed.');
  }
  await next();
});
app.get('/api/session', (c) => c.json(c.get('session')));
app.get('/api/types', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id,slug,label,parent_type_id,sort_order FROM place_types ORDER BY sort_order',
  ).all<{
    id: string;
    slug: string;
    label: string;
    parent_type_id: string | null;
    sort_order: number;
  }>();
  return c.json({
    types: rows.results.map((row) => ({
      id: row.id,
      slug: row.slug,
      label: row.label,
      parentTypeId: row.parent_type_id,
      sortOrder: row.sort_order,
    })),
  });
});
app.get('/api/people', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM people ORDER BY display_name COLLATE NOCASE',
  ).all<PersonRow>();
  return c.json({ people: rows.results.map(personFromRow) });
});
app.post('/api/people', async (c) => {
  const input = await readJson(c.req.raw, personInputSchema);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO people(id,display_name,active) VALUES(?,?,?)',
  )
    .bind(id, input.displayName, input.active ? 1 : 0)
    .run();
  return c.json({ person: { id, ...input } }, 201);
});
app.put('/api/people/:id', async (c) => {
  const id = c.req.param('id');
  const input = await readJson(c.req.raw, personInputSchema);
  if (!input.active && c.get('session').person?.id === id)
    fail(409, 'You cannot deactivate your current editor account.');
  const result = await c.env.DB.prepare(
    'UPDATE people SET display_name=?,active=? WHERE id=?',
  )
    .bind(input.displayName, input.active ? 1 : 0, id)
    .run();
  if (!result.meta.changes) fail(404, 'Person not found.');
  return c.json({ person: { id, ...input } });
});
app.get('/api/trips', async (c) =>
  c.json({
    trips: await tripsCatalogue(
      c.env,
      c.req.header('X-Quollity-Identity') ?? '',
    ),
  }),
);
app.get('/api/openapi.json', (c) => c.json(openapi));
app.route('/api', placeEntry);
app.route('/api/places', places);
app.route('/api', visits);
app.route('/api/boards', boards);
app.route('/api', snaps);
app.all('/api/*', (c) => c.json({ error: 'API endpoint not found.' }, 404));
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  c.header('Cache-Control', 'private, no-store');
  if (error instanceof HTTPException)
    return error
      .getResponse()
      .headers.get('Content-Type')
      ?.includes('application/json')
      ? error.getResponse()
      : c.json({ error: error.message }, error.status);
  if (
    /constraint failed|UNIQUE constraint|FOREIGN KEY constraint/i.test(
      error.message,
    )
  )
    return c.json(
      { error: 'This change conflicts with existing records.' },
      409,
    );
  const requestId = crypto.randomUUID();
  console.error(
    JSON.stringify({
      event: 'request_failed',
      requestId,
      path: new URL(c.req.url).pathname,
      error: error.message,
    }),
  );
  return c.json(
    { error: 'The request could not be completed.', requestId },
    500,
  );
});
export default app;
