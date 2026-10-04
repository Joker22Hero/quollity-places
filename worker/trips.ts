import { tripCatalogueSchema, type Trip } from '../shared/contracts';
import { signature } from './auth';
import { fail } from './http';

export async function tripsCatalogue(
  env: Env,
  identity: string,
): Promise<Trip[]> {
  // Local development is useful without the sibling Trips Worker.
  if (!('TRIPS' in env) || !env.TRIPS || !env.QUOLLITY_INTERNAL_SECRET) {
    if (env.AUTH_MODE === 'local') return [];
    fail(503, 'Trips catalogue is not connected.');
  }
  const path = '/api/trips';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  let response: Response;
  try {
    response = await env.TRIPS.fetch(
      new Request(`https://trips.internal${path}`, {
        headers: {
          Accept: 'application/json',
          'X-Quollity-Role': 'viewer',
          'X-Quollity-Identity': identity,
          'X-Quollity-Timestamp': timestamp,
          'X-Quollity-Signature': await signature(
            env.QUOLLITY_INTERNAL_SECRET,
            'GET',
            path,
            'viewer',
            identity,
            timestamp,
          ),
        },
        signal: AbortSignal.timeout(10000),
      }),
    );
  } catch {
    fail(503, 'Trips catalogue is unavailable.');
  }
  if (!response.ok || !response.body)
    fail(503, 'Trips catalogue is unavailable.');
  // Bound the service response before JSON parsing.
  const reader = response.body!.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1048576) {
        await reader.cancel();
        fail(503, 'Trips catalogue is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return tripCatalogueSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    ).trips;
  } catch {
    fail(503, 'Trips catalogue returned an invalid response.');
  }
}
export async function validateTrip(env: Env, tripId: string, identity: string) {
  const trip = (await tripsCatalogue(env, identity)).find(
    (trip) => trip.tripId === tripId,
  );
  if (!trip) fail(400, 'Choose a trip from the Quollity Trips catalogue.');
  // Store a validated display cache, not a second source of truth for trip identity.
  return env.DB.prepare(
    `INSERT INTO trip_references(id,name,country,start_date,end_date,canonical_url) VALUES(?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,country=excluded.country,start_date=excluded.start_date,end_date=excluded.end_date,canonical_url=excluded.canonical_url,validated_at=CURRENT_TIMESTAMP`,
  ).bind(
    trip.tripId,
    trip.name,
    trip.country,
    trip.startDate,
    trip.endDate,
    trip.canonicalUrl,
  );
}
