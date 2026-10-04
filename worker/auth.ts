import type { Person, Session } from '../shared/contracts';
import { fail } from './http';
import { personFromRow, type PersonRow } from './repository';

const encoder = new TextEncoder();
export function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}
export async function signature(
  secret: string,
  method: string,
  path: string,
  role: string,
  identity: string,
  timestamp: string,
) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(
    new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(`${timestamp}.${method}.${path}.${role}.${identity}`),
      ),
    ),
  );
}
export async function gatewayRole(
  request: Request,
  secret?: string,
): Promise<'viewer' | 'editor' | null> {
  const role = request.headers.get('X-Quollity-Role');
  const timestamp = request.headers.get('X-Quollity-Timestamp');
  const signed = request.headers.get('X-Quollity-Signature');
  if (
    !secret ||
    !signed ||
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !['viewer', 'editor'].includes(role ?? '')
  )
    return null;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(
      atob(
        signed
          .replaceAll('-', '+')
          .replaceAll('_', '/')
          .padEnd(Math.ceil(signed.length / 4) * 4, '='),
      ),
      (char) => char.charCodeAt(0),
    );
  } catch {
    return null;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const identity = request.headers.get('X-Quollity-Identity') ?? '';
  const payload = `${timestamp}.${request.method}.${new URL(request.url).pathname}.${role}.${identity}`;
  return (await crypto.subtle.verify(
    'HMAC',
    key,
    bytes,
    encoder.encode(payload),
  ))
    ? (role as 'viewer' | 'editor')
    : null;
}
export async function authenticate(
  request: Request,
  env: Env,
): Promise<Session> {
  const role = await gatewayRole(request, env.QUOLLITY_INTERNAL_SECRET);
  if (role === 'viewer') return { role, person: null, readOnly: true };
  let person: Person | null = null;
  if (role === 'editor') {
    const identity =
      request.headers.get('X-Quollity-Identity')?.toLowerCase() ?? '';
    const row = await env.DB.prepare(
      'SELECT p.* FROM people p JOIN people_login_aliases a ON a.person_id=p.id WHERE a.login_email=? COLLATE NOCASE AND p.active=1',
    )
      .bind(identity)
      .first<PersonRow>();
    if (row) person = personFromRow(row);
  } else if (env.AUTH_MODE === 'local') {
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(
        new URL(request.url).hostname,
      )
    )
      fail(403, 'Local authentication is limited to loopback hosts.');
    const localIds: Record<string, string> = {
      michael: '0f780640-84b1-4aef-9374-823f600a4101',
      jack: '86eb1a08-6d8e-419b-b08d-9b6bea8b1872',
    };
    const row = await env.DB.prepare(
      'SELECT * FROM people WHERE id=? AND active=1',
    )
      .bind(localIds[env.LOCAL_IDENTITY] ?? '')
      .first<PersonRow>();
    if (row) person = personFromRow(row);
  } else fail(401, 'A verified Quollity gateway request is required.');
  if (!person) fail(403, 'This editor is not an active Quollity person.');
  return { role: 'editor', person, readOnly: false };
}
