# Places lookup and agent access

Place entry now supports name search, result selection, automatic geography, manual entry, duplicate review, and source attribution. Existing places have a “Find location” preview that preserves manual values unless explicitly selected. Agents use the same endpoints as the browser.

## Enable lookup

Configure a Geoapify account and `GEOAPIFY_API_KEY` on the Places Worker. Locally, copy `.dev.vars.example` to the ignored `.dev.vars` file and set the key there. Without the key, the app still searches saved places and permits manual entry; it reports external lookup as unavailable.

For production, use the secure Wrangler prompt from this repository:

```sh
./node_modules/.bin/wrangler secret put GEOAPIFY_API_KEY --config wrangler.jsonc --env production
```

Run this from the Places repository. Its production environment explicitly targets
`quollity-places`. The gateway repository has no `production` environment; configure
its secrets there without `--env production`. If Wrangler reports that the production
environment is missing, check the working directory and configuration path before
creating another Worker.

The server uses Geoapify forward geocoding, a named POI fallback where geographic context is available, and bounded place-detail enrichment. Search results are cached for 24 hours and selections last 30 minutes. Keys stay server-side. Country context is a hard filter; proximity is a ranking bias. Results labelled as cities/areas cannot be imported as physical attractions; tours may use them as approximate location context, without a fabricated attraction coordinate.

Search data is incomplete in some regions. Before releasing lookup, verify named-attraction coverage for Kew Gardens, Kirstenbosch, Alhambra, a Japanese temple, a rural historic house, and an ambiguous museum name with the real provider account. Provider fixtures test the adapter and flow, not live coverage.

## Configure agent credentials

The gateway source implements `PLACES_AGENT_TOKENS`, an optional secret containing a JSON array of token records. An empty or absent registry grants no agent access. Each record has `tokenId`, SHA-256 `hash`, delegating editor `identity`, `scopes`, `expiresAt`, and `disabled`.

Create a token locally as the owner. Use a private registry file outside either Git repository. The CLI preserves existing records, writes with owner-only permissions, and displays the new bearer token once:

```sh
node scripts/create-agent-token.mjs \
  mhinz.mh22@gmail.com 2027-01-01T00:00:00Z \
  /private/tmp/quollity-agent-registry.json \
  places:read places:lookup places:create
```

Save the bearer token in a password manager or the agent's secret store. The private registry contains hashes, not usable bearer tokens; securely retain it to manage rotation and revocation. The expiry example must be changed to a future date when issuing a token.

From the gateway repository, install that registry as a secret:

```sh
./node_modules/.bin/wrangler secret put PLACES_AGENT_TOKENS < /private/tmp/quollity-agent-registry.json
```

Changing `disabled` to true or removing a record and replacing the secret revokes its token. A token cannot outlive its expiry, an allowed gateway editor identity, or its active Places person. Adding a person/attendee does not issue a credential or grant editor status. Credential installation and source deployment are separate operations; implementation does not automatically issue access.

| Scope                    | Allowed operations                                                        |
| ------------------------ | ------------------------------------------------------------------------- |
| `places:read`            | Session, types, people, trips, directory, place detail/rankings, OpenAPI. |
| `places:lookup`          | Place lookup.                                                             |
| `places:create`          | Manual place creation and selected-candidate import.                      |
| `visits:create`          | Create visits for an active place.                                        |
| `places:location:update` | Preview and explicitly apply selected location fields.                    |

Archive, general replacement edits, people management, boards, and other Quollity components are excluded. An invalid bearer token never falls back to a browser cookie. The gateway verifies credentials, strips external/internal authentication headers, and signs owner/scopes/token ID plus method, child path/query, body digest, timestamp, and idempotency key. Places independently verifies that signature, scopes, and active owner.

## Agent workflow

All public endpoints below start with `https://quollity.uk/places`. Send `Authorization: Bearer <token>` and JSON `Content-Type` on writes. Inspect the authenticated `GET /api/openapi.json` for field schemas and errors.

1. `POST /api/place-lookups` with `{ "query": "Kew Gardens, London" }`.
2. Review `savedMatches`, each candidate's `duplicates`, name, geography, kind/precision, and source attribution. Open a matching existing record when appropriate. Ask the caller to choose if the location is ambiguous.
3. `POST /api/places/import` with a selected `lookupId`/`candidateId`, optional personal fields/type/overrides, and `duplicateAction: "reuse_exact"`. Send an `Idempotency-Key` generated once for this save intent.
4. Optionally create a visit with `POST /api/places/:id/visits`, its own idempotency key, a local calendar date, and explicitly supplied attendees/rating/trip ID. Trip IDs must come from the catalogue.

Example import body:

```json
{
  "lookupId": "<returned UUID>",
  "candidateId": "<returned candidate ID>",
  "placeTypeId": "botanic-garden",
  "wishlist": true,
  "duplicateAction": "reuse_exact"
}
```

New records return 201 and `outcome: "created"`. A proven existing source identity returns 200 and `outcome: "existing"` when reuse is requested. Reuse does not apply supplied notes, wishlist, or overrides; the response warns `overrides_not_applied`. An archived match returns `place_archived` and requires an explicit browser restore. Missing type hints use the existing Other type.

A minimal manual create remains `POST /api/places` with `{ "name": "My place", "placeTypeId": "other" }`. Geography is optional. Provide both coordinates or neither. Place `PUT` remains full replacement; omitted fields are cleared. Use the location PATCH for enrichment instead of sending partial PUT bodies.

For `possible_duplicate`, inspect `details.matches`. Reuse the existing record, or obtain explicit confirmation that this is a separate place, then resubmit with `details.duplicateReviewToken`. The token is tied to the principal, exact normalised place input, current match IDs, and 30-minute expiry. A source identity is never bypassable. Fuzzy matching compares normalised names and geographic context within a bounded pool of up to 5,000 records of the same kind/country; it is a warning, not proof of identity.

For retries, reuse the exact request body and key. Committed responses are retained for seven days and replay even after the lookup expires. A changed body with the same key returns `idempotency_conflict`. Re-searching creates a new lookup body and is a new save intent; do not reuse the old key for that body. Use a new key for each genuinely separate visit, including revisits on the same date.

Location repair is two operations: POST `/api/places/:id/location-preview` with the selection, then PATCH `/api/places/:id/location` with selection, returned `revision`, and an explicit `fields` array. Preview marks existing manual fields as protected; applying them is an explicit override. Coordinates must be accepted together. Missing source values cannot clear existing fields. A stale revision or incompatible ranking-board location returns 409. This endpoint records location evidence, without silently replacing a place's source identity.

A small executable client is supplied:

```sh
# Supply QUOLLITY_PLACES_TOKEN securely through the agent's environment.
node scripts/agent-add-place.mjs 'Kew Gardens, London'
# After reviewing the candidate IDs, select one:
node scripts/agent-add-place.mjs 'Kew Gardens, London' '<candidate ID>'
```

This client lists candidates before creation and retries only an identical network-failed import inside the same invocation. It does not select the highest-ranked candidate automatically or create visits implicitly.

## Release and verification

Apply `migrations/0003_place_entry.sql` before releasing Places. It adds source/provenance records, lookup cache/snapshots, retry records, revision guards, rate limits, and mutation audit events. Existing place UUIDs, visits, notes, filters, and rankings are retained.

The coordinated gateway implementation is included in `docs/gateway-agent-access.patch` and applied to the gateway source after explicit approval. The shared authentication contract is copied verbatim from `shared/agent-auth.ts` to gateway `src/places-agent-contract.ts`; keep both copies in sync when changing it. The patch is a review artifact against the gateway source at implementation time, not a second patch to apply to an already updated checkout.

Validation covers API/SQLite integration, gateway authentication tests, TypeScript, production builds and deployment dry runs. Local D1 migrations were applied successfully. Safari verified manual creation and selected-result autofill/save against an isolated workerd preview, using synthetic lookup data. The installed local runtime supports 2026-09-01 while the production configuration specifies 2026-10-04, so only the isolated preview used the older date. Exact-date live runtime/provider verification and production release remain separate checks.
