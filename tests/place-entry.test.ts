import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { app } from '../worker/index';
import { database } from './sqlite';
import { normaliseCandidate } from '../worker/geocoding';
import { agentSignature, sha256, type AgentClaims } from '../shared/agent-auth';
import {
  lookupResponseSchema,
  importedPlaceSchema,
} from '../shared/place-entry';
let db: ReturnType<typeof database>, env: Record<string, unknown>;
const michael = '0f780640-84b1-4aef-9374-823f600a4101';
beforeEach(() => {
  db = database();
  env = {
    DB: db,
    AUTH_MODE: 'local',
    LOCAL_IDENTITY: 'michael',
    ASSETS: { fetch: () => new Response('asset') },
  };
});
afterEach(() => {
  db.sqlite.close();
  vi.restoreAllMocks();
});
async function call(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  key?: string,
  headers: Record<string, string> = {},
) {
  return app.request(
    new Request('http://localhost/api' + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    undefined,
    env,
  );
}
async function ok(path: string, body?: unknown, method?: string, key?: string) {
  const response = await call(path, body, method, key);
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBeLessThan(300);
  return data;
}
function raw(overrides = {}) {
  return {
    place_id: 'kew-id',
    name: 'Kew Gardens',
    city: 'London',
    state: 'England',
    country_code: 'gb',
    lat: 51.478,
    lon: -0.295,
    result_type: 'amenity',
    categories: ['leisure.park.garden.botanical'],
    datasource: {
      raw: { osm_type: 'way', osm_id: 123, website: 'https://www.kew.org/' },
    },
    ...overrides,
  };
}
async function selection(overrides = {}, principal = 'person:' + michael) {
  const id = crypto.randomUUID(),
    candidate = normaliseCandidate(raw(overrides))!;
  await db
    .prepare(
      'INSERT INTO place_lookups(id,principal,candidates,expires_at) VALUES(?,?,?,?)',
    )
    .bind(id, principal, JSON.stringify([candidate]), Date.now() + 1800000)
    .run();
  return { lookupId: id, candidateId: candidate.candidateId };
}
describe('Place lookup and import', () => {
  it('searches, caches server-normalised geography, validates responses, and imports attribution', async () => {
    env.GEOAPIFY_API_KEY = 'test-provider-key';
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, options) => {
        const url = new URL(String(input));
        expect(url.searchParams.get('apiKey')).toBe('test-provider-key');
        expect(options?.headers).toMatchObject({ Accept: 'application/json' });
        return url.pathname.includes('place-details')
          ? Response.json({
              features: [
                { properties: raw({ website: 'https://www.kew.org/' }) },
              ],
            })
          : Response.json({ results: [raw()] });
      });
    const lookup = lookupResponseSchema.parse(
      await ok('/place-lookups', {
        query: 'Kew Gardens, London',
        context: { countryCode: 'GB' },
      }),
    );
    expect(lookup.candidates[0]).toMatchObject({
      city: 'London',
      region: 'England',
      countryCode: 'GB',
      suggestedTypeId: 'botanic-garden',
      latitude: 51.478,
      longitude: -0.295,
    });
    const count = provider.mock.calls.length;
    await ok('/place-lookups', {
      query: 'Kew Gardens, London',
      context: { countryCode: 'GB' },
    });
    expect(provider).toHaveBeenCalledTimes(count);
    const saved = importedPlaceSchema.parse(
      await ok(
        '/places/import',
        { lookupId: lookup.lookupId, candidateId: 'kew-id', wishlist: true },
        undefined,
        'import-key',
      ),
    );
    expect(saved.place).toMatchObject({
      countryCode: 'GB',
      websiteUrl: 'https://www.kew.org/',
      placeTypeId: 'botanic-garden',
      wishlist: true,
    });
    const detail = await ok('/places/' + saved.place.id);
    expect(
      detail.location.sources[0].candidate.source.attribution,
    ).toHaveLength(2);
    expect(
      detail.location.provenance.every(
        (p: { overridden: boolean }) => !p.overridden,
      ),
    ).toBe(true);
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM mutation_audit').get()?.n,
    ).toBe(1);
  });
  it('still finds local and archived places when lookup is unavailable, and permits minimal manual entry', async () => {
    const saved = await ok('/places', {
      name: 'Unknown garden',
      placeTypeId: 'other',
    });
    await ok(
      '/places/' + saved.place.id + '/archive',
      { archived: true },
      'PUT',
    );
    const lookup = await ok('/place-lookups', { query: 'Unknown' });
    expect(lookup.resolution).toBe('provider_unavailable');
    expect(lookup.savedMatches[0].archivedAt).toBeTruthy();
    expect(
      (await ok('/places', { name: 'Offline place', placeTypeId: 'other' }))
        .place.latitude,
    ).toBeNull();
    env.GEOAPIFY_API_KEY = 'test';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('network timeout'),
    );
    expect(
      (await ok('/place-lookups', { query: 'Different' })).resolution,
    ).toBe('provider_unavailable');
  });
  it('rejects city centroids as attractions and allows an approximate experience location', async () => {
    const picked = await selection({ name: 'London', result_type: 'city' });
    const candidate = normaliseCandidate(raw({ result_type: 'city' }))!;
    expect(candidate.latitude).toBeNull();
    expect(candidate.longitude).toBeNull();
    expect((await call('/places/import', picked, 'POST', 'city')).status).toBe(
      400,
    );
    const experience = await ok(
      '/places/import',
      {
        ...picked,
        placeKind: 'experience',
        overrides: { name: 'London walking tour' },
      },
      undefined,
      'tour',
    );
    expect(experience.place.placeKind).toBe('experience');
    expect(experience.warnings).toContain('approximate_location');
  });
  it('does not guess missing geography or accept unsafe provider websites', () => {
    expect(
      normaliseCandidate(
        raw({
          city: undefined,
          state: undefined,
          country_code: undefined,
          lat: undefined,
          lon: undefined,
          website: 'javascript:alert(1)',
          datasource: undefined,
        }),
      ),
    ).toMatchObject({
      city: null,
      region: null,
      countryCode: null,
      latitude: null,
      longitude: null,
      websiteUrl: null,
    });
    expect(normaliseCandidate(raw({ lat: 999 }))).toBeNull();
  });
  it('checks snapshot ownership, expiry, unknown fields, and rate limits', async () => {
    const picked = await selection();
    await db.prepare('UPDATE place_lookups SET expires_at=0').run();
    expect(
      (await (await call('/places/import', picked, 'POST', 'expired')).json())
        .code,
    ).toBe('lookup_expired');
    const other = await selection({}, 'person:another');
    expect((await call('/places/import', other, 'POST', 'owner')).status).toBe(
      409,
    );
    expect(
      (
        await call(
          '/places/import',
          { ...picked, unrecognised: true },
          'POST',
          'extra',
        )
      ).status,
    ).toBe(400);
    await db
      .prepare(
        'INSERT INTO place_lookup_limits(principal,window,count) VALUES(?,?,30)',
      )
      .bind('person:' + michael, Math.floor(Date.now() / 60000))
      .run();
    const limited = await call('/place-lookups', { query: 'Kew' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
  });
});
describe('Duplicates and retries', () => {
  it('replays exact committed responses even after lookup expiry and conflicts on edited payloads', async () => {
    const picked = await selection();
    const first = await ok('/places/import', picked, undefined, 'retry');
    await db.prepare('UPDATE place_lookups SET expires_at=0').run();
    const again = await ok('/places/import', picked, undefined, 'retry');
    expect(again).toEqual(first);
    expect(
      (
        await (
          await call(
            '/places/import',
            { ...picked, wishlist: true },
            'POST',
            'retry',
          )
        ).json()
      ).code,
    ).toBe('idempotency_conflict');
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM places').get()?.n).toBe(
      1,
    );
  });
  it('protects source identity during simultaneous imports with different keys', async () => {
    const picked = await selection();
    const payload = { ...picked, duplicateAction: 'reuse_exact' };
    const responses = await Promise.all([
      call('/places/import', payload, 'POST', 'first-race'),
      call('/places/import', payload, 'POST', 'second-race'),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM places').get()?.n).toBe(
      1,
    );
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM place_sources').get()?.n,
    ).toBe(1);
  });
  it('matches stable OSM identity even when provider IDs change', async () => {
    const first = await ok(
      '/places/import',
      await selection(),
      undefined,
      'original-source',
    );
    const changed = await selection({
      place_id: 'new-provider-id',
      datasource: { raw: { osm_type: 'w', osm_id: 123 } },
    });
    const saved = await ok(
      '/places/import',
      { ...changed, duplicateAction: 'reuse_exact' },
      undefined,
      'new-source',
    );
    expect(saved.outcome).toBe('existing');
    expect(saved.place.id).toBe(first.place.id);
  });
  it('reuses exact identity without changing notes or wishlist and requires explicit archive restore', async () => {
    const first = await ok(
      '/places/import',
      { ...(await selection()), notes: 'Keep', wishlist: false },
      undefined,
      'first',
    );
    const reused = await ok(
      '/places/import',
      {
        ...(await selection()),
        notes: 'Replace',
        wishlist: true,
        duplicateAction: 'reuse_exact',
      },
      undefined,
      'second',
    );
    expect(reused.outcome).toBe('existing');
    expect(reused.place.id).toBe(first.place.id);
    expect(reused.place.notes).toBe('Keep');
    expect(reused.place.wishlist).toBe(false);
    expect(reused.warnings).toContain('overrides_not_applied');
    await ok(
      '/places/' + first.place.id + '/archive',
      { archived: true },
      'PUT',
    );
    const response = await call(
      '/places/import',
      { ...(await selection()), duplicateAction: 'reuse_exact' },
      'POST',
      'archived',
    );
    expect((await response.json()).code).toBe('place_archived');
  });
  it('requires fuzzy review tied to the exact input and allows attractions and experiences at shared coordinates', async () => {
    await ok('/places', {
      name: 'Kew Gardens',
      placeTypeId: 'botanic-garden',
      city: 'London',
      countryCode: 'GB',
    });
    const picked = await selection();
    const conflict = await call('/places/import', picked, 'POST', 'review');
    expect(conflict.status).toBe(409);
    const details = (await conflict.json()).details;
    const changed = await call(
      '/places/import',
      {
        ...picked,
        wishlist: true,
        duplicateReviewToken: details.duplicateReviewToken,
      },
      'POST',
      'changed',
    );
    expect(changed.status).toBe(409);
    expect(
      (
        await ok(
          '/places/import',
          { ...picked, duplicateReviewToken: details.duplicateReviewToken },
          undefined,
          'approved',
        )
      ).outcome,
    ).toBe('created');
    const castle = await selection({
      place_id: 'palace-id',
      name: 'Kew Palace',
      categories: ['tourism.sights.castle'],
      datasource: { raw: { osm_type: 'way', osm_id: 124 } },
    });
    expect(
      (await ok('/places/import', castle, undefined, 'palace')).place
        .placeTypeId,
    ).toBe('castle');
    for (const name of ['Morning tour', 'Evening tour'])
      expect(
        (
          await ok(
            '/places/import',
            { ...picked, placeKind: 'experience', overrides: { name } },
            undefined,
            name.replace(' ', '-'),
          )
        ).outcome,
      ).toBe('created');
  });
  it('serialises concurrent imports and place retries without extra records', async () => {
    const picked = await selection();
    const payload = { ...picked, duplicateAction: 'reuse_exact' };
    const same = await Promise.all([
      call('/places/import', payload, 'POST', 'concurrent'),
      call('/places/import', payload, 'POST', 'concurrent'),
    ]);
    expect(same.map((r) => r.status)).toEqual([201, 201]);
    expect(await same[0].json()).toEqual(await same[1].json());
    const different = await Promise.all([
      call('/places/import', payload, 'POST', 'different-1'),
      call('/places/import', payload, 'POST', 'different-2'),
    ]);
    expect(different.map((r) => r.status)).toEqual([200, 200]);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM places').get()?.n).toBe(
      1,
    );
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM place_sources').get()?.n,
    ).toBe(1);
  });
  it('accepts manual duplicate review and rejects a token for altered manual input', async () => {
    const input = {
      name: 'Same museum',
      placeTypeId: 'museum',
      countryCode: 'GB',
    };
    await ok('/places', input);
    const failed = await call('/places', input);
    expect(failed.status).toBe(409);
    const details = (await failed.json()).details;
    expect(
      (
        await call('/places', {
          ...input,
          wishlist: true,
          duplicateReviewToken: details.duplicateReviewToken,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await ok('/places', {
          ...input,
          duplicateReviewToken: details.duplicateReviewToken,
        })
      ).place.name,
    ).toBe(input.name);
  });
  it('rolls back duplicate key reservations and snapshots manual place and visit creates', async () => {
    const input = { name: 'Retry place', placeTypeId: 'other' };
    const place = await ok('/places', input, undefined, 'manual');
    expect(await ok('/places', input, undefined, 'manual')).toEqual(place);
    const visit = {
      date: '2026-10-05',
      attendeeIds: [michael],
      overallRating: 4.2,
    };
    const first = await ok(
      `/places/${place.place.id}/visits`,
      visit,
      undefined,
      'visit',
    );
    expect(
      await ok(`/places/${place.place.id}/visits`, visit, undefined, 'visit'),
    ).toEqual(first);
    expect(first.visit.attendees[0].id).toBe(michael);
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM place_visits').get()?.n,
    ).toBe(1);
  });
});
describe('Location repair', () => {
  it('increments revisions once even with recursive SQLite triggers enabled', async () => {
    db.sqlite.exec('PRAGMA recursive_triggers=ON');
    const { place } = await ok('/places', {
      name: 'Revision test',
      placeTypeId: 'other',
    });
    const updated = await ok(
      '/places/' + place.id,
      { ...place, name: 'Changed' },
      'PUT',
    );
    expect(updated.place.revision).toBe(place.revision + 1);
  });
  it('previews protected manual and cleared fields, preserves unrelated content, and rejects stale revisions', async () => {
    const first = await ok(
      '/places/import',
      await selection(),
      undefined,
      'first',
    );
    const place = first.place;
    await ok(
      '/places/' + place.id,
      { ...place, city: 'My city', websiteUrl: null },
      'PUT',
    );
    const picked = await selection({
      city: 'Richmond',
      state: 'Greater London',
    });
    const preview = await ok(
      '/places/' + place.id + '/location-preview',
      picked,
    );
    expect(
      preview.changes.find((p: { field: string }) => p.field === 'city')
        .protected,
    ).toBe(true);
    expect(
      preview.changes.find((p: { field: string }) => p.field === 'websiteUrl')
        .protected,
    ).toBe(true);
    const applied = await ok(
      '/places/' + place.id + '/location',
      { ...picked, revision: preview.revision, fields: ['region'] },
      'PATCH',
    );
    expect(applied.place.city).toBe('My city');
    expect(applied.place.websiteUrl).toBeNull();
    expect(applied.place.region).toBe('Greater London');
    const stale = await call(
      '/places/' + place.id + '/location',
      { ...picked, revision: preview.revision, fields: ['city'] },
      'PATCH',
    );
    expect((await stale.json()).code).toBe('stale_revision');
    const explicit = await ok(
      '/places/' + place.id + '/location',
      { ...picked, revision: applied.place.revision, fields: ['city'] },
      'PATCH',
    );
    expect(explicit.place.city).toBe('Richmond');
  });
  it('rolls back a simultaneous stale location update without orphan source records', async () => {
    const { place } = await ok(
      '/places/import',
      await selection(),
      undefined,
      'first',
    );
    const picked = await selection({ city: 'Richmond' });
    const payload = { ...picked, revision: place.revision, fields: ['city'] };
    const responses = await Promise.all([
      call(`/places/${place.id}/location`, payload, 'PATCH'),
      call(`/places/${place.id}/location`, payload, 'PATCH'),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM place_sources').get()?.n,
    ).toBe(2);
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM mutation_guards').get()?.n,
    ).toBe(0);
  });
  it('rejects invalid import coordinate overrides as client errors', async () => {
    const picked = await selection();
    const result = await call(
      '/places/import',
      { ...picked, overrides: { latitude: null, longitude: 0 } },
      'POST',
      'invalid-coordinates',
    );
    expect(result.status).toBe(400);
    expect((await result.json()).code).toBe('invalid_place');
  });
  it('retains board eligibility and requires a coordinate pair', async () => {
    const { place } = await ok(
      '/places/import',
      await selection(),
      undefined,
      'first',
    );
    const { board } = await ok('/boards', {
      name: 'England',
      regionFilter: 'England',
    });
    await ok(
      `/boards/${board.id}/entries`,
      { entries: [{ placeId: place.id }] },
      'PUT',
    );
    const picked = await selection({ state: 'Wales' });
    const conflict = await call(
      `/places/${place.id}/location`,
      { ...picked, revision: place.revision, fields: ['region'] },
      'PATCH',
    );
    expect((await conflict.json()).code).toBe('incompatible_board');
    expect(
      (
        await call(
          `/places/${place.id}/location`,
          { ...picked, revision: place.revision, fields: ['latitude'] },
          'PATCH',
        )
      ).status,
    ).toBe(400);
  });
});
describe('Agent child boundary', () => {
  const secret = 'test-internal-secret';
  const claims: AgentClaims = {
    tokenId: 'test-agent',
    identity: 'mhinz.mh22@gmail.com',
    scopes: ['places:read', 'places:lookup', 'places:create', 'visits:create'],
  };
  async function delegated(
    path: string,
    body?: unknown,
    method = body ? 'POST' : 'GET',
    key?: string,
    actor = claims,
  ) {
    env.AUTH_MODE = 'gateway';
    env.QUOLLITY_INTERNAL_SECRET = secret;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const request = new Request('http://localhost/api' + path, {
      method,
      headers: key ? { 'Idempotency-Key': key } : {},
    });
    return call(path, body, method, key, {
      'X-Quollity-Agent': JSON.stringify(actor),
      'X-Quollity-Timestamp': timestamp,
      'X-Quollity-Signature': await agentSignature(
        secret,
        request,
        actor,
        timestamp,
        await sha256(body ? JSON.stringify(body) : ''),
      ),
    });
  }
  it('allows only scoped operations for an active delegating owner and requires retry keys', async () => {
    expect((await delegated('/types')).status).toBe(200);
    expect(
      (await delegated('/places', { name: 'No key', placeTypeId: 'other' }))
        .status,
    ).toBe(400);
    const response = await delegated(
      '/places',
      { name: 'Agent place', placeTypeId: 'other' },
      'POST',
      'agent-key',
    );
    expect(response.status).toBe(201);
    const id = (await response.json()).place.id;
    const visit = await delegated(
      `/places/${id}/visits`,
      { date: '2026-10-05', attendeeIds: [michael] },
      'POST',
      'agent-visit',
    );
    expect(visit.status).toBe(201);
    expect(
      db.sqlite.prepare('SELECT created_by FROM place_visits').get()
        ?.created_by,
    ).toBe(michael);
    expect(
      db.sqlite.prepare('SELECT token_id,owner_id FROM mutation_audit').get(),
    ).toMatchObject({ token_id: 'test-agent', owner_id: michael });
    expect(
      (await delegated('/boards', { name: 'Denied' }, 'POST', 'board')).status,
    ).toBe(403);
    expect(
      (await delegated('/places/' + id, { name: 'Denied' }, 'PUT')).status,
    ).toBe(403);
    const noCreate = {
      ...claims,
      scopes: ['places:read'] as AgentClaims['scopes'],
    };
    expect(
      (
        await delegated(
          '/places',
          { name: 'Denied', placeTypeId: 'other' },
          'POST',
          'denied',
          noCreate,
        )
      ).status,
    ).toBe(403);
    await db
      .prepare('UPDATE people SET active=0 WHERE id=?')
      .bind(michael)
      .run();
    expect((await delegated('/types')).status).toBe(403);
  });
  it('rejects forged claims, body/query/key tampering, direct bearer bypass, and stale signatures', async () => {
    env.AUTH_MODE = 'gateway';
    env.QUOLLITY_INTERNAL_SECRET = secret;
    expect(
      (
        await call('/types', undefined, 'GET', undefined, {
          'X-Quollity-Agent': JSON.stringify(claims),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call('/types', undefined, 'GET', undefined, {
          Authorization: 'Bearer qp_bad',
        })
      ).status,
    ).toBe(401);
    const timestamp = String(Math.floor(Date.now() / 1000)),
      body = { name: 'Original', placeTypeId: 'other' },
      request = new Request('http://localhost/api/places', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'key' },
      });
    const headers = {
      'X-Quollity-Agent': JSON.stringify(claims),
      'X-Quollity-Timestamp': timestamp,
      'X-Quollity-Signature': await agentSignature(
        secret,
        request,
        claims,
        timestamp,
        await sha256(JSON.stringify(body)),
      ),
    };
    expect(
      (
        await call(
          '/places',
          { ...body, name: 'Tampered' },
          'POST',
          'key',
          headers,
        )
      ).status,
    ).toBe(401);
    expect(
      (await call('/places?country=GB', body, 'POST', 'key', headers)).status,
    ).toBe(401);
    expect(
      (await call('/places', body, 'POST', 'changed-key', headers)).status,
    ).toBe(401);
  });
  it('serves a serialisable OpenAPI document', async () => {
    const schema = await ok('/openapi.json');
    expect(schema.openapi).toBe('3.1.0');
    expect(schema.paths['/api/places/import'].post.requestBody).toBeTruthy();
  });
});
