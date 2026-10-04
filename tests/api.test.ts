import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../worker/index';
import { signature } from '../worker/auth';
import { database } from './sqlite';
const michael = '0f780640-84b1-4aef-9374-823f600a4101';
let db: ReturnType<typeof database>;
let env: Record<string, unknown>;
beforeEach(() => {
  db = database();
  env = {
    DB: db,
    AUTH_MODE: 'local',
    LOCAL_IDENTITY: 'michael',
    ASSETS: { fetch: () => new Response('asset') },
  };
});
afterEach(() => db.sqlite.close());
async function call(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  headers: Record<string, string> = {},
) {
  return app.request(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    undefined,
    env,
  );
}
async function jsonCall(path: string, body?: unknown, method?: string) {
  const response = await call(path, body, method);
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBeLessThan(300);
  return data;
}
async function addPlace(name = 'Kew Gardens', placeTypeId = 'botanic-garden') {
  return (await jsonCall('/places', { name, placeTypeId, countryCode: 'GB' }))
    .place;
}
async function addVisit(
  placeId: string,
  rating: number | null,
  date = '2026-05-01',
  extra = {},
) {
  return (
    await jsonCall(`/places/${placeId}/visits`, {
      date,
      overallRating: rating,
      attendeeIds: [michael],
      ...extra,
    })
  ).visit;
}

describe('Places foundation', () => {
  it('keeps place and visit notes separate and averages only active rated visits', async () => {
    const place = await addPlace();
    await jsonCall(
      `/places/${place.id}`,
      {
        name: place.name,
        placeTypeId: place.placeTypeId,
        notes: 'General observations',
        wishlist: true,
      },
      'PUT',
    );
    await addVisit(place.id, 4, '2024-05-01', { notes: 'First visit' });
    const second = await addVisit(place.id, 5, '2026-05-01', {
      notes: 'Second visit',
    });
    await addVisit(place.id, null, '2026-06-01');
    let detail = await jsonCall(`/places/${place.id}`);
    expect(detail.place).toMatchObject({
      averageRating: 4.5,
      visitCount: 3,
      ratedVisitCount: 2,
      notes: 'General observations',
      wishlist: true,
    });
    expect(
      detail.visits.find((visit: { id: string }) => visit.id === second.id)
        .notes,
    ).toBe('Second visit');
    await jsonCall(`/visits/${second.id}/archive`, { archived: true }, 'PUT');
    detail = await jsonCall(`/places/${place.id}`);
    expect(detail.place.averageRating).toBe(4);
    expect(detail.visits).toHaveLength(3);
    await jsonCall(`/visits/${second.id}/archive`, { archived: false }, 'PUT');
    expect((await jsonCall(`/places/${place.id}`)).place.averageRating).toBe(
      4.5,
    );
  });
  it('archives places without losing visit history and blocks edits until restored', async () => {
    const place = await addPlace();
    await addVisit(place.id, 4.7);
    await jsonCall(`/places/${place.id}/archive`, { archived: true }, 'PUT');
    expect((await jsonCall('/places')).places).toHaveLength(0);
    expect((await jsonCall('/places?archived=true')).places).toHaveLength(1);
    expect((await jsonCall(`/places/${place.id}`)).visits).toHaveLength(1);
    expect(
      (await call(`/places/${place.id}/visits`, { date: '2026-06-01' })).status,
    ).toBe(409);
    await jsonCall(`/places/${place.id}/archive`, { archived: false }, 'PUT');
    expect((await jsonCall('/places')).stats.visited).toBe(1);
  });
  it('validates coordinates, calendar dates, date ranges, types, and rating precision', async () => {
    expect(
      (
        await call('/places', {
          name: 'Invalid',
          placeTypeId: 'museum',
          latitude: 45,
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('/places', { name: 'Invalid', placeTypeId: 'unknown' }))
        .status,
    ).toBe(400);
    expect(
      (
        await call('/places', {
          name: 'Invalid',
          placeTypeId: 'museum',
          websiteUrl: 'javascript:alert(1)',
        })
      ).status,
    ).toBe(400);
    const place = await addPlace();
    for (const body of [
      { date: '2026-02-30' },
      { date: '2026-05-02', endDate: '2026-05-01' },
      { date: '2026-05-01', overallRating: 4.75 },
      { date: '2026-05-01', attendeeIds: [michael, michael] },
    ])
      expect((await call(`/places/${place.id}/visits`, body)).status).toBe(400);
    await addVisit(place.id, 4.7);
  });
  it('counts distinct places and applies attendee/year filters to the same visit', async () => {
    const place = await addPlace();
    await addVisit(place.id, 4, '2024-05-01');
    await addVisit(place.id, 5, '2026-05-01', { attendeeIds: [] });
    expect((await jsonCall('/places')).stats).toMatchObject({
      visited: 1,
      countries: 1,
      types: 1,
    });
    expect(
      (await jsonCall(`/places?attendee=${michael}&year=2026`)).places,
    ).toHaveLength(0);
    expect(
      (await jsonCall(`/places?attendee=${michael}&year=2024`)).places,
    ).toHaveLength(1);
  });
  it('preserves exact averages and shared ranks across pagination', async () => {
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      const place = await addPlace(name);
      await addVisit(place.id, 4.7);
    }
    const lower = await addPlace('Delta');
    await addVisit(lower.id, 4.6);
    expect(
      (await jsonCall('/places/rankings?offset=1&limit=3')).rankings.map(
        (entry: { rank: number }) => entry.rank,
      ),
    ).toEqual([1, 1, 4]);
    expect(
      (await jsonCall('/places/rankings?country=FR')).rankings,
    ).toHaveLength(0);
  });
  it('replaces board ordering atomically, enforces eligibility, and keeps ratings independent', async () => {
    const a = await addPlace('Garden A');
    const b = await addPlace('Garden B');
    const museum = await addPlace('Museum', 'museum');
    await addVisit(a.id, 4);
    await addVisit(b.id, 5);
    const { board } = await jsonCall('/boards', {
      name: 'Favourite gardens',
      placeTypeFilter: 'botanic-garden',
    });
    await jsonCall(
      `/boards/${board.id}/entries`,
      { entries: [{ placeId: a.id, note: 'Prefer this' }, { placeId: b.id }] },
      'PUT',
    );
    expect(
      (await jsonCall(`/boards/${board.id}`)).entries.map(
        (entry: { place: { id: string } }) => entry.place.id,
      ),
    ).toEqual([a.id, b.id]);
    expect(
      (
        await call(
          `/boards/${board.id}/entries`,
          { entries: [{ placeId: museum.id }] },
          'PUT',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          `/boards/${board.id}/entries`,
          { entries: [{ placeId: a.id }, { placeId: a.id }] },
          'PUT',
        )
      ).status,
    ).toBe(400);
    expect((await jsonCall(`/boards/${board.id}`)).entries).toHaveLength(2);
    expect(
      (
        await call(
          `/places/${a.id}`,
          { name: a.name, placeTypeId: 'museum' },
          'PUT',
        )
      ).status,
    ).toBe(409);
    expect((await jsonCall('/places/rankings')).rankings[0].place.id).toBe(
      b.id,
    );
    await jsonCall(
      `/boards/${board.id}/entries`,
      { entries: [{ placeId: b.id }, { placeId: a.id }] },
      'PUT',
    );
    expect(
      (await jsonCall(`/boards/${board.id}`)).entries.map(
        (entry: { rank: number }) => entry.rank,
      ),
    ).toEqual([1, 2]);
  });
  it('links Snaps references to matching visits and replaces the cover without storing photos', async () => {
    const a = await addPlace('A');
    const b = await addPlace('B');
    const visit = await addVisit(a.id, 4);
    expect(
      (
        await call(`/places/${b.id}/snap-links`, {
          snapId: 'one',
          visitId: visit.id,
        })
      ).status,
    ).toBe(400);
    const first = await jsonCall(`/places/${a.id}/snap-links`, {
      snapId: 'one',
      visitId: visit.id,
      isCover: true,
    });
    await jsonCall(`/places/${a.id}/snap-links`, {
      snapId: 'two',
      isCover: true,
    });
    const detail = await jsonCall(`/places/${a.id}`);
    expect(
      detail.snaps.filter((snap: { isCover: boolean }) => snap.isCover),
    ).toHaveLength(1);
    expect(detail.snaps[0].snapId).toBe('two');
    expect(
      (
        await call(
          `/places/${a.id}/snap-links/${first.snap.id}`,
          undefined,
          'DELETE',
        )
      ).status,
    ).toBe(204);
    expect((await jsonCall(`/places/${a.id}`)).snaps).toHaveLength(1);
  });
  it('supports experiences without separate tables', async () => {
    const { place } = await jsonCall('/places', {
      name: 'Whale watching',
      placeTypeId: 'tour',
      placeKind: 'experience',
      operator: 'Local operator',
      durationMinutes: 180,
      meetingPoint: 'Harbour',
    });
    expect(place).toMatchObject({
      placeKind: 'experience',
      durationMinutes: 180,
    });
  });
  it('retains inactive attendees in history and blocks assigning them to new visits', async () => {
    const { person } = await jsonCall('/people', { displayName: 'Guest' });
    const place = await addPlace();
    const visit = await addVisit(place.id, 4, '2026-05-01', {
      attendeeIds: [person.id],
    });
    await jsonCall(
      `/people/${person.id}`,
      { displayName: 'Guest', active: false },
      'PUT',
    );
    expect(
      (await jsonCall(`/places/${place.id}`)).visits[0].attendees[0].active,
    ).toBe(false);
    expect(
      (
        await call(`/places/${place.id}/visits`, {
          date: '2026-05-02',
          attendeeIds: [person.id],
        })
      ).status,
    ).toBe(400);
    await jsonCall(
      `/visits/${visit.id}`,
      { date: visit.date, attendeeIds: [person.id], overallRating: 5 },
      'PUT',
    );
    expect(
      (
        await call(
          `/people/${michael}`,
          { displayName: 'Michael', active: false },
          'PUT',
        )
      ).status,
    ).toBe(409);
  });
});

describe('Gateway boundary', () => {
  const secret = 'test-secret-only';
  async function signedHeaders(
    method: string,
    path: string,
    role = 'viewer',
    timestamp = String(Math.floor(Date.now() / 1000)),
  ) {
    return {
      'X-Quollity-Role': role,
      'X-Quollity-Timestamp': timestamp,
      'X-Quollity-Signature': await signature(
        secret,
        method,
        path,
        role,
        '',
        timestamp,
      ),
    };
  }
  it('requires a valid signature on remote requests and rejects stale/replayed paths', async () => {
    env.AUTH_MODE = 'gateway';
    env.QUOLLITY_INTERNAL_SECRET = secret;
    expect((await call('/places')).status).toBe(401);
    expect(
      (
        await call(
          '/places',
          undefined,
          'GET',
          await signedHeaders('GET', '/api/places'),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          '/people',
          undefined,
          'GET',
          await signedHeaders('GET', '/api/places'),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          '/places',
          undefined,
          'GET',
          await signedHeaders('GET', '/api/places', 'viewer', '1'),
        )
      ).status,
    ).toBe(401);
  });
  it('allows viewers to read and forbids all viewer mutations', async () => {
    env.AUTH_MODE = 'gateway';
    env.QUOLLITY_INTERNAL_SECRET = secret;
    expect(
      (
        await call(
          '/places',
          { name: 'No', placeTypeId: 'museum' },
          'POST',
          await signedHeaders('POST', '/api/places'),
        )
      ).status,
    ).toBe(403);
  });
  it('rejects remote local-auth bypasses and cross-origin writes', async () => {
    const remote = await app.request(
      new Request('https://places.example/api/places'),
      undefined,
      env,
    );
    expect(remote.status).toBe(403);
    expect(
      (
        await call('/places', { name: 'No', placeTypeId: 'museum' }, 'POST', {
          Origin: 'https://other.example',
        })
      ).status,
    ).toBe(403);
  });
});

describe('Trips integration', () => {
  it('validates canonical trip IDs before creating links and exposes linked visits', async () => {
    const trip = {
      tripId: 'canonical-trip-id',
      name: 'London',
      country: 'United Kingdom',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      canonicalUrl: '/trips/london/',
      suggested: false,
    };
    env.QUOLLITY_INTERNAL_SECRET = 'test-secret';
    env.TRIPS = {
      fetch: async (request: Request) => {
        expect(new URL(request.url).pathname).toBe('/api/trips');
        expect(request.headers.get('X-Quollity-Signature')).toBeTruthy();
        return Response.json({ trips: [trip], canEdit: false });
      },
    };
    const place = await addPlace();
    expect(
      (
        await call(`/places/${place.id}/visits`, {
          date: '2026-05-01',
          tripId: 'invalid',
        })
      ).status,
    ).toBe(400);
    const visit = await addVisit(place.id, 4.7, '2026-05-01', {
      tripId: trip.tripId,
    });
    expect(visit.trip.name).toBe('London');
    const linked = await jsonCall(`/visits?tripId=${trip.tripId}`);
    expect(linked.visits[0].place.id).toBe(place.id);
    expect(linked.visits[0].canonicalUrl).toBe(`/places/place/${place.id}`);
  });
  it('does not accept arbitrary trip links when Trips is unavailable', async () => {
    const place = await addPlace();
    expect(
      (
        await call(`/places/${place.id}/visits`, {
          date: '2026-05-01',
          tripId: 'invented',
        })
      ).status,
    ).toBe(400);
    expect((await jsonCall('/trips')).trips).toEqual([]);
  });
});

describe('Record maintenance and request limits', () => {
  it('preserves local login when the current person is renamed', async () => {
    await jsonCall(
      `/people/${michael}`,
      { displayName: 'Michael H', active: true },
      'PUT',
    );
    const session = await jsonCall('/session');
    expect(session.person).toMatchObject({
      id: michael,
      displayName: 'Michael H',
    });
  });
  it('renames collections and rejects filters that invalidate existing members', async () => {
    const place = await addPlace();
    const { board } = await jsonCall('/boards', { name: 'Favourites' });
    await jsonCall(
      `/boards/${board.id}/entries`,
      { entries: [{ placeId: place.id }] },
      'PUT',
    );
    await jsonCall(
      `/boards/${board.id}`,
      { name: 'Favourite gardens', placeTypeFilter: 'botanic-garden' },
      'PUT',
    );
    expect((await jsonCall(`/boards/${board.id}`)).board.name).toBe(
      'Favourite gardens',
    );
    expect(
      (
        await call(
          `/boards/${board.id}`,
          { name: 'Museums', placeTypeFilter: 'museum' },
          'PUT',
        )
      ).status,
    ).toBe(409);
  });
  it('accepts known gateway editors and rejects unregistered editor identities', async () => {
    env.AUTH_MODE = 'gateway';
    env.QUOLLITY_INTERNAL_SECRET = 'test-secret';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = async (identity: string) => ({
      'X-Quollity-Role': 'editor',
      'X-Quollity-Identity': identity,
      'X-Quollity-Timestamp': timestamp,
      'X-Quollity-Signature': await signature(
        'test-secret',
        'POST',
        '/api/places',
        'editor',
        identity,
        timestamp,
      ),
    });
    expect(
      (
        await call(
          '/places',
          { name: 'Allowed', placeTypeId: 'museum' },
          'POST',
          await headers('mhinz.mh22@gmail.com'),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await call(
          '/places',
          { name: 'Blocked', placeTypeId: 'museum' },
          'POST',
          await headers('unknown@example.com'),
        )
      ).status,
    ).toBe(403);
  });
  it('rejects malformed or oversized JSON without writing records', async () => {
    const oversized = await call('/places', {
      name: 'Large',
      placeTypeId: 'museum',
      notes: 'x'.repeat(131073),
    });
    expect(oversized.status).toBe(413);
    const response = await app.request(
      new Request('http://localhost/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
      undefined,
      env,
    );
    expect(response.status).toBe(400);
    expect((await jsonCall('/places')).stats.total).toBe(0);
  });
  it('rolls back the whole database batch when a statement violates a foreign key', async () => {
    const place = await addPlace();
    await expect(
      db.batch([
        db
          .prepare('UPDATE places SET name=? WHERE id=?')
          .bind('Changed', place.id),
        db
          .prepare(
            'INSERT INTO visit_attendees(visit_id,person_id) VALUES(?,?)',
          )
          .bind('missing', michael),
      ]),
    ).rejects.toThrow();
    expect((await jsonCall(`/places/${place.id}`)).place.name).toBe(
      'Kew Gardens',
    );
  });
});
