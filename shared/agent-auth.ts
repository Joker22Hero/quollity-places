// Shared verbatim with the gateway. No platform or package dependencies.
export const agentScopes = [
  'places:read',
  'places:lookup',
  'places:create',
  'visits:create',
  'places:location:update',
] as const;
export type AgentScope = (typeof agentScopes)[number];
export type AgentClaims = {
  tokenId: string;
  identity: string;
  scopes: AgentScope[];
};
export type AgentToken = AgentClaims & {
  hash: string;
  expiresAt: string;
  disabled: boolean;
};
const encoder = new TextEncoder();
export async function sha256(value: string | Uint8Array<ArrayBuffer>) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export function requiredAgentScope(
  method: string,
  path: string,
): AgentScope | null {
  if (
    method === 'GET' &&
    [
      '/api/session',
      '/api/types',
      '/api/people',
      '/api/trips',
      '/api/openapi.json',
      '/api/places',
      '/api/places/rankings',
    ].includes(path)
  )
    return 'places:read';
  if (method === 'GET' && /^\/api\/places\/[a-f0-9-]{36}$/.test(path))
    return 'places:read';
  if (method === 'POST' && path === '/api/place-lookups')
    return 'places:lookup';
  if (method === 'POST' && ['/api/places', '/api/places/import'].includes(path))
    return 'places:create';
  if (method === 'POST' && /^\/api\/places\/[a-f0-9-]{36}\/visits$/.test(path))
    return 'visits:create';
  if (
    (method === 'POST' &&
      /^\/api\/places\/[a-f0-9-]{36}\/location-preview$/.test(path)) ||
    (method === 'PATCH' &&
      /^\/api\/places\/[a-f0-9-]{36}\/location$/.test(path))
  )
    return 'places:location:update';
  return null;
}
export function parseAgentClaims(value: unknown): AgentClaims | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.tokenId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(data.tokenId) ||
    typeof data.identity !== 'string' ||
    data.identity.length > 254 ||
    !data.identity.includes('@') ||
    !Array.isArray(data.scopes) ||
    !data.scopes.length ||
    data.scopes.length > agentScopes.length ||
    !data.scopes.every((s) => agentScopes.includes(s))
  )
    return null;
  return {
    tokenId: data.tokenId,
    identity: data.identity.toLowerCase(),
    scopes: [...new Set(data.scopes)],
  };
}
export async function authenticateAgent(
  authorization: string,
  registry?: string,
): Promise<AgentClaims | null> {
  if (!registry || !/^Bearer qp_[a-zA-Z0-9_-]{43}$/.test(authorization))
    return null;
  let records: unknown;
  try {
    records = JSON.parse(registry);
  } catch {
    return null;
  }
  if (!Array.isArray(records) || records.length > 100) return null;
  const hash = await sha256(authorization.slice(7));
  for (const raw of records) {
    const claims = parseAgentClaims(raw);
    if (!claims) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.hash !== 'string' || !/^[0-9a-f]{64}$/.test(entry.hash))
      continue;
    // Fixed-length comparison, including unsuccessful token matches.
    let diff = 0;
    for (let i = 0; i < 64; i++)
      diff |= hash.charCodeAt(i) ^ entry.hash.charCodeAt(i);
    if (
      diff === 0 &&
      entry.disabled === false &&
      typeof entry.expiresAt === 'string' &&
      Date.parse(entry.expiresAt) > Date.now()
    )
      return claims;
  }
  return null;
}
export async function boundedBytes(
  request: Pick<Request, 'body'>,
  limit = 131072,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new RangeError('Request exceeds 128 KiB.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
function payload(
  request: Pick<Request, 'url' | 'method' | 'headers'>,
  claims: AgentClaims,
  timestamp: string,
  bodyHash: string,
) {
  const url = new URL(request.url);
  return JSON.stringify([
    'places-agent-v1',
    timestamp,
    request.method,
    url.pathname + url.search,
    claims.tokenId,
    claims.identity,
    [...claims.scopes].sort(),
    bodyHash,
    request.headers.get('Idempotency-Key') ?? '',
  ]);
}
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
export async function agentSignature(
  secret: string,
  request: Pick<Request, 'url' | 'method' | 'headers'>,
  claims: AgentClaims,
  timestamp: string,
  bodyHash: string,
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
        encoder.encode(payload(request, claims, timestamp, bodyHash)),
      ),
    ),
  );
}
export async function verifyAgentSignature(
  secret: string,
  request: Pick<Request, 'url' | 'method' | 'headers'>,
  claims: AgentClaims,
  timestamp: string,
  signed: string,
  bodyHash: string,
) {
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 ||
    !/^[A-Za-z0-9_-]{43}$/.test(signed)
  )
    return false;
  try {
    const bytes = Uint8Array.from(
      atob(signed.replaceAll('-', '+').replaceAll('_', '/') + '='),
      (c) => c.charCodeAt(0),
    );
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'HMAC',
      key,
      bytes,
      encoder.encode(payload(request, claims, timestamp, bodyHash)),
    );
  } catch {
    return false;
  }
}
