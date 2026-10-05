#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
const [query, candidateId, key = randomUUID()] = process.argv.slice(2);
const token = process.env.QUOLLITY_PLACES_TOKEN;
if (!query || !token)
  throw new Error(
    'Set QUOLLITY_PLACES_TOKEN and pass a query. First run lists candidates; a second argument selects one.',
  );
const base = 'https://quollity.uk/places/api';
async function call(path, body, idempotencyKey) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(JSON.stringify({ status: response.status, ...data }));
  return data;
}
const lookup = await call('/place-lookups', { query });
if (!candidateId) {
  process.stdout.write(JSON.stringify(lookup, null, 2) + '\n');
} else {
  const candidate = lookup.candidates.find(
    (c) => c.candidateId === candidateId,
  );
  if (!candidate)
    throw new Error(
      'That candidate is not in the current results. Run without selection to review them.',
    );
  const body = {
    lookupId: lookup.lookupId,
    candidateId,
    duplicateAction: 'reuse_exact',
  };
  // Retry the exact request/key inside this invocation; a new lookup is a new request.
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await call('/places/import', body, key);
      break;
    } catch (error) {
      if (!(error instanceof TypeError) || attempt === 1) throw error;
    }
  }
  process.stdout.write(JSON.stringify(response, null, 2) + '\n');
}
