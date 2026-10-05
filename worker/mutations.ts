import type { Context } from 'hono';
import type { AppEnv } from './app-types';
import { sha256 } from '../shared/agent-auth';
import { HTTPException } from 'hono/http-exception';
export function problem(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503,
  code: string,
  error: string,
  details?: unknown,
): never {
  throw new HTTPException(status, {
    res: Response.json(
      { error, code, ...(details === undefined ? {} : { details }) },
      { status },
    ),
  });
}
export const principal = (c: Context<AppEnv>) =>
  c.get('agent')
    ? `agent:${c.get('agent')!.tokenId}:${c.get('session').person!.id}`
    : `person:${c.get('session').person!.id}`;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export type Write = {
  principal: string;
  operation: string;
  key: string;
  hash: string;
  replay: Response | null;
};
async function replay(c: Context<AppEnv>, write: Omit<Write, 'replay'>) {
  const row = await c.env.DB.prepare(
    'SELECT input_hash,response,status FROM api_idempotency WHERE principal=? AND operation=? AND key=? AND expires_at>?',
  )
    .bind(write.principal, write.operation, write.key, Date.now())
    .first<{ input_hash: string; response: string; status: number }>();
  if (!row) return null;
  if (row.input_hash !== write.hash)
    problem(
      409,
      'idempotency_conflict',
      'This key was already used with a different request.',
    );
  return new Response(row.response, {
    status: row.status,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Replayed': 'true',
    },
  });
}
export async function prepareWrite(
  c: Context<AppEnv>,
  input: unknown,
  required = false,
): Promise<Write> {
  const supplied = c.req.header('Idempotency-Key');
  if ((required || c.get('agent')) && !supplied)
    problem(
      400,
      'idempotency_required',
      'Supply an Idempotency-Key for this operation.',
    );
  if (supplied && !/^[A-Za-z0-9_.:-]{1,100}$/.test(supplied))
    problem(
      400,
      'invalid_idempotency_key',
      'Use a key of 1–100 letters, digits, or . _ : - characters.',
    );
  const write = {
    principal: principal(c),
    operation: c.req.method + ' ' + new URL(c.req.url).pathname,
    key: supplied ?? crypto.randomUUID(),
    hash: await sha256(canonical(input)),
  };
  return { ...write, replay: await replay(c, write) };
}
export function audit(c: Context<AppEnv>, operation: string, entityId: string) {
  return c.env.DB.prepare(
    'INSERT INTO mutation_audit(id,owner_id,token_id,operation,entity_id) VALUES(?,?,?,?,?)',
  ).bind(
    crypto.randomUUID(),
    c.get('session').person!.id,
    c.get('agent')?.tokenId ?? null,
    operation,
    entityId,
  );
}
// Snapshot response inside the same transaction as the write and key reservation.
export async function commitWrite(
  c: Context<AppEnv>,
  write: Write,
  statements: D1PreparedStatement[],
  expression: string,
  args: (string | number | null)[],
  status: number,
  entityId: string,
) {
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'DELETE FROM api_idempotency WHERE principal=? AND operation=? AND key=? AND expires_at<=?',
      ).bind(write.principal, write.operation, write.key, Date.now()),
      c.env.DB.prepare(
        'INSERT INTO api_idempotency(principal,operation,key,input_hash,response,status,expires_at) VALUES(?,?,?,?,?,?,?)',
      ).bind(
        write.principal,
        write.operation,
        write.key,
        write.hash,
        '{}',
        status,
        Date.now() + 7 * 86400000,
      ),
      ...statements,
      audit(c, write.operation, entityId),
      c.env.DB.prepare(
        `UPDATE api_idempotency SET response=${expression} WHERE principal=? AND operation=? AND key=?`,
      ).bind(...args, write.principal, write.operation, write.key),
    ]);
  } catch (error) {
    const existing = await replay(c, write);
    if (existing) return existing;
    throw error;
  }
  const response = (await replay(c, write))!;
  response.headers.delete('Idempotency-Replayed');
  return response;
}
const placeColumns = {
  id: 'id',
  revision: 'revision',
  name: 'name',
  shortName: 'short_name',
  placeTypeId: 'place_type_id',
  placeKind: 'place_kind',
  city: 'city',
  region: 'region',
  countryCode: 'country_code',
  latitude: 'latitude',
  longitude: 'longitude',
  websiteUrl: 'website_url',
  description: 'description',
  notes: 'notes',
  operator: 'operator',
  meetingPoint: 'meeting_point',
  durationMinutes: 'duration_minutes',
  archivedAt: 'archived_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  typeLabel: 'type_label',
  visitCount: 'visit_count',
  ratedVisitCount: 'rated_visit_count',
  averageRating: 'average_rating',
  latestVisitDate: 'latest_visit_date',
};
export const placeJson = `json_object(${Object.entries(placeColumns)
  .map(([k, v]) => `'${k}',p.${v}`)
  .join(
    ',',
  )},'facts',json(p.facts),'wishlist',json(CASE WHEN p.wishlist=1 THEN 'true' ELSE 'false' END))`;
export const savedPlaceExpression = `(SELECT json_object('place',${placeJson}) FROM place_summaries p WHERE p.id=?)`;
export const importedPlaceExpression = (
  outcome: 'created' | 'existing',
  warnings: string[],
) =>
  `(SELECT json_object('place',${placeJson},'outcome','${outcome}','warnings',json('${JSON.stringify(warnings)}')) FROM place_summaries p WHERE p.id=?)`;
export const savedVisitExpression = `(SELECT json_object('visit',json_object('id',v.id,'placeId',v.place_id,'date',v.date,'endDate',v.end_date,'overallRating',v.rating_tenths/10.0,'notes',v.notes,'wouldRevisit',v.would_revisit,'tripId',v.trip_id,'archivedAt',v.archived_at,'createdAt',v.created_at,'updatedAt',v.updated_at,'trip',json(CASE WHEN t.id IS NULL THEN 'null' ELSE json_object('tripId',t.id,'name',t.name,'country',t.country,'startDate',t.start_date,'endDate',t.end_date,'canonicalUrl',t.canonical_url,'suggested',json('false')) END),'attendees',json((SELECT json_group_array(json_object('id',a.id,'displayName',a.display_name,'active',json(CASE WHEN a.active=1 THEN 'true' ELSE 'false' END))) FROM (SELECT p.* FROM people p JOIN visit_attendees va ON va.person_id=p.id WHERE va.visit_id=v.id ORDER BY p.display_name) a)))) FROM place_visits v LEFT JOIN trip_references t ON t.id=v.trip_id WHERE v.id=?)`;
export function revisionGuard(db: D1Database, id: string, revision: number) {
  const guardId = crypto.randomUUID();
  return {
    start: db
      .prepare(
        'INSERT INTO mutation_guards(id,valid) VALUES(?,COALESCE((SELECT revision=? AND archived_at IS NULL FROM places WHERE id=?),0))',
      )
      .bind(guardId, revision, id),
    end: db.prepare('DELETE FROM mutation_guards WHERE id=?').bind(guardId),
  };
}
