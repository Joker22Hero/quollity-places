import type { Context } from 'hono';
import type { AppEnv } from './app-types';
import {
  boundedBytes,
  sha256,
  parseAgentClaims,
  verifyAgentSignature,
  requiredAgentScope,
} from '../shared/agent-auth';
import { personFromRow, type PersonRow } from './repository';
import { problem } from './mutations';
export async function agentSession(c: Context<AppEnv>) {
  const encoded = c.req.header('X-Quollity-Agent');
  if (!encoded) return false;
  if (!c.env.QUOLLITY_INTERNAL_SECRET || encoded.length > 2048)
    problem(401, 'invalid_delegation', 'Invalid agent delegation.');
  let claims;
  try {
    claims = parseAgentClaims(JSON.parse(encoded));
  } catch {
    claims = null;
  }
  if (!claims) problem(401, 'invalid_delegation', 'Invalid agent delegation.');
  let bytes;
  try {
    bytes = await boundedBytes(c.req.raw.clone());
  } catch {
    problem(413, 'request_too_large', 'Request exceeds 128 KiB.');
  }
  const verified = await verifyAgentSignature(
    c.env.QUOLLITY_INTERNAL_SECRET,
    c.req.raw,
    claims,
    c.req.header('X-Quollity-Timestamp') ?? '',
    c.req.header('X-Quollity-Signature') ?? '',
    await sha256(bytes),
  );
  if (!verified)
    problem(401, 'invalid_delegation', 'Invalid agent delegation.');
  const scope = requiredAgentScope(c.req.method, new URL(c.req.url).pathname);
  if (!scope || !claims.scopes.includes(scope))
    problem(
      403,
      'insufficient_scope',
      'This token does not permit this operation.',
    );
  const row = await c.env.DB.prepare(
    'SELECT p.* FROM people p JOIN people_login_aliases a ON a.person_id=p.id WHERE a.login_email=? COLLATE NOCASE AND p.active=1',
  )
    .bind(claims.identity)
    .first<PersonRow>();
  if (!row)
    problem(
      403,
      'inactive_owner',
      'The delegating editor is not an active Quollity person.',
    );
  c.set('agent', claims);
  c.set('session', {
    role: 'editor',
    person: personFromRow(row),
    readOnly: false,
  });
  return true;
}
