# Easier place entry and agent API

Status: implemented in source, 5 October 2026. See [setup and agent access](agent-api.md) for the shipped contract, verification, and release dependencies. Production lookup credentials, agent token provisioning, and coordinated deployment remain to be configured. The sections below retain the original design rationale.

## Outcome

Add a place by searching its name, selecting the right result, and saving. Automatically fill coordinates, city, region, country, and website when available. Ask for personal choices such as type, wishlist, and notes. Keep a name-only location fallback so missing provider data never prevents saving.

The browser and agents must use the same lookup, normalisation, duplicate detection, and creation service. An agent can search and create through HTTPS without browser cookies, database access, or the shared internal signing secret.

## What exists today

- `src/PlaceForm.tsx` exposes all location fields as manual inputs and defaults new places to museum.
- `shared/contracts.ts` already permits missing geography. Only name and a valid `placeTypeId` are required for a minimal create; kind and wishlist have defaults.
- `POST /api/places` creates places, but does not enrich them, detect duplicates, or support retry-safe creation.
- `PUT /api/places/:id` replaces editable fields. It must not be used as a partial enrichment update because omitted values are cleared.
- The gateway authenticates browser sessions and signs requests to the private child Worker. Places requires editor identities to resolve to active people. There is no external agent credential flow.

## User flow

1. **Find a place.** One field labelled “Place name and location”, with the example “Kew Gardens, London”. Show saved places first, then external matches. Optionally narrow by country or a chosen trip's location; never silently restrict to the current device location.
2. **Choose the result.** Each option shows name, type hint, city/region/country, and an “Already saved” badge where applicable. Selecting a saved record opens it, with an “Add visit” action. Archived records offer an explicit restore action.
3. **Review and save.** Show an editable name, suggested type, wishlist, optional notes, and a compact location summary. If type cannot be mapped reliably, select “Other” rather than defaulting to museum. Put short name, description, website, and all geography inputs inside “Edit details”. Coordinates are filled but never required.
4. **Continue.** Save opens the place; “Add a visit” uses the existing visit form. Visits, ratings, and attendees are never inferred from lookup data.

Illustrative layout; the location text is an example, not imported data:

```text
Add a place
Place name and location  [ Kew Gardens, London             ]

Royal Botanic Gardens, Kew
Botanic garden · London, England, United Kingdom
[Select]

Name   [Royal Botanic Gardens, Kew]
Type   [Botanic garden v]       [ ] On my wishlist
Location: London · England · United Kingdom
Notes  [                                                  ]
Edit details >
[Save place]  [Cancel]
```

Provide “Add without lookup” from the start and after no results or provider failure. It asks for name, defaults type to Other, and saves with nullable location. Tours and cruises can use a searched meeting point, but retain their own name/operator and experience kind. A shared meeting point is not a shared experience identity.

For existing records, add “Find location” using the current name and any known geography. Preview changes before applying; preserve manual corrections, notes, visits, and board constraints. Do not re-query the provider on every place-page view.

## Lookup provider

Recommend a server-side Geoapify adapter for the first release. Its [autocomplete API](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/) supports place/address suggestions and geographic filters. Its [Places API](https://apidocs.geoapify.com/docs/places/) supports category/location searches and documents unrestricted caching/storage of results; [Place Details](https://apidocs.geoapify.com/docs/place-details/) supplies additional information when available. [Attribution requirements](https://www.geoapify.com/terms-and-conditions/) include OpenStreetMap attribution and Geoapify attribution on the free plan.

Named-attraction coverage is a release gate, not an assumed guarantee. Test searches for Kew Gardens, Kirstenbosch, Alhambra, a Japanese temple, a rural historic house, and an ambiguous museum name. Start with forward geocoding/autocomplete; use category-plus-name Places searches only when geographic context is known. Do not treat a returned city or street as a resolved attraction. Switch the adapter if these real searches fail; preserve the public Quollity contract.

Do not use the public OSM Nominatim endpoint for autocomplete: its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) forbids that use. A separately hosted provider is a different service.

Implementation boundaries:

- Keep the provider key in a Worker secret. Clients call Quollity, never the provider directly.
- Debounce browser lookup by 350 ms after three characters; cancel/discard stale responses. Return at most eight external candidates plus saved matches.
- Use a five-second provider timeout, bounded response size, input validation, and per-principal rate limits. Return 429 with `Retry-After` when limited.
- Cache normalised search results for 24 hours by query, language, and geographic context. Never include notes, visits, attendees, or login identity in provider requests or cache keys. Saved-record matching happens separately on each request.
- Persist a chosen candidate snapshot for 30 minutes, bound to its requesting principal. Import uses this server-held snapshot, so selection does not depend on another external request.
- Show source attribution beside suggestions and on imported location details. Preserve source attribution in API responses and exports.
- Website is nullable and must pass HTTP(S) validation. Do not invent URLs, descriptions, or missing administrative fields. Arbitrary website fetching and pasted map-link resolution can follow later.

## Geography and provenance

Retain the current `city`, `region`, `countryCode`, `latitude`, and `longitude` fields so directory filters and rankings continue to work. Add an optional structured administrative hierarchy for richer source data; do not introduce multiple manually required region fields.

- City: provider city, then town/village when appropriate. Leave null when unavailable.
- Region: first-level administrative subdivision (`state`), with provider `region` as fallback. Do not silently use a county in one country and a state in another.
- Country: uppercase two-letter code, with a readable country name in the UI.
- Coordinates: validate numeric ranges and both-or-neither. A city centroid is not an attraction coordinate. Retain precision/kind metadata so an approximate meeting-point location can be labelled honestly.
- Hierarchy: optional ordered `{ level, name, code? }` entries for source administrative divisions. Level meanings must be explicit rather than inferred from array position.
- Type: map provider categories to existing taxonomy using a small deterministic table. Multiple conflicting hints produce Other; type remains editable.

Add `place_sources` with source provider/ID, optional stable OSM object type/ID, selected normalised snapshot, fetched timestamp, attribution, and source purpose (`identity` or `location`). A physical attraction gets an identity reference; an experience's meeting point gets a location reference. Uniqueness applies to identity references only, including archived places. Provider IDs are references, not Quollity IDs, and can change upstream.

Add per-field provenance for imported fields: source reference, imported value, and manual override flag. Any editor change, including clearing a field, marks that field overridden. A refresh proposes changes to untouched source-derived fields; it never silently overwrites manual values. Apply accepted enrichment through a dedicated transaction with the current board-eligibility checks and a record revision precondition. A stale revision returns 409.

## Proposed API

These are child paths; public callers prefix `/places`, for example `https://quollity.uk/places/api/place-lookups`. Lookup POSTs require editor access because they incur external requests. Existing viewer directory reads remain unchanged.

| Method | Child path                         | Purpose                                                                           |
| ------ | ---------------------------------- | --------------------------------------------------------------------------------- |
| POST   | `/api/place-lookups`               | Read-only search; return saved matches and normalised candidates.                 |
| POST   | `/api/places/import`               | Save a selected candidate with personal fields, or reuse an exact identity match. |
| POST   | `/api/places`                      | Existing manual/minimal create; add idempotency and duplicate checks.             |
| POST   | `/api/places/:id/location-preview` | Preview a selected lookup candidate against an existing place.                    |
| PATCH  | `/api/places/:id/location`         | Apply explicitly accepted location changes with a revision precondition.          |
| GET    | `/api/openapi.json`                | Authenticated OpenAPI contract for supported agent operations.                    |

Lookup request:

```json
{
  "query": "Kew Gardens, London",
  "context": { "countryCode": "GB" },
  "limit": 5
}
```

`context` is optional and supports city/country hints or a proximity point. Distinguish a hard country filter from proximity ranking in the schema. A trip can supply context through the existing validated catalogue, without requiring a trip for place creation.

Lookup response includes `lookupId`, `expiresAt`, `savedMatches`, `candidates`, `warnings`, and `resolution` (`candidates`, `no_match`, or `provider_unavailable`). Each candidate contains `candidateId`, name, location fields, precision/kind, suggested type, source attribution, and duplicate matches with their reasons. Partial provider failure can still return local matches. No mutation occurs, and the server never turns a provider ranking into automatic permission to create.

Import request (placeholder IDs come from lookup; examples are not live data):

```json
{
  "lookupId": "<lookup UUID>",
  "candidateId": "<candidate ID>",
  "placeTypeId": "botanic-garden",
  "wishlist": true,
  "notes": "Visit the glasshouses.",
  "duplicateAction": "reuse_exact"
}
```

The import fills geography from the server snapshot. Optional whitelisted overrides allow correcting name/geography; a coordinate override must include both values. An explicit valid type overrides the hint; omission uses the mapped type or Other. Unknown fields are rejected. Missing/expired snapshots return 409 `lookup_expired`; clients re-search and select again.

Return `{ "outcome": "created" | "existing", "place": ..., "warnings": [] }`: 201 for a new record, 200 for exact reuse. Reuse never changes wishlist, notes, or any supplied field on the existing record; return an `overrides_not_applied` warning if fields were supplied. Edits are a separate explicit action. Archived exact matches return 409 `place_archived` and the existing ID; no silent restore.

New endpoints use `{ "error": "message", "code": "stable_code", "details": ... }`. Preserve existing error compatibility; document each code in OpenAPI. Fuzzy duplicate conflicts return 409 `possible_duplicate` with candidates, not an unexplained error. Invalid credentials return 401; insufficient scope returns 403.

### Duplicate detection and safe retries

Check stable source identity first, then normalised name plus geography/distance. Name/distance matches are suggestions, since a garden and palace can share coordinates. Inspect archived records too. Never deduplicate experiences solely by their meeting point, or collapse two attractions because they share a website.

`duplicateAction` defaults to `reject`; `reuse_exact` only reuses a proven identity match. A probable match requires selecting the existing place or acknowledging the proposed new record with a short-lived duplicate-review token tied to the exact input. Source identity uniqueness remains non-bypassable. Manual minimal creates run the same probable-match review.

Require `Idempotency-Key` for import and agent create/visit operations; the UI generates one key per save intent. Add support to both existing place and visit POST routes. Scope keys by principal and operation, store the request hash and committed status/body for seven days, and commit the mutation plus replay record atomically in D1. Same key/body replays the original response; changed body returns 409 `idempotency_conflict`. Concurrent requests and lost responses must not create extra records. Check a committed replay before snapshot expiry, while always rechecking current authentication and scope.

Unique source constraints protect concurrent imports with different keys. Fetch the winning identity after a conflict and follow the explicit duplicate policy. Name-only duplicates cannot be perfectly eliminated; make that limitation clear to clients rather than claiming fuzzy matching is an identity guarantee.

## Agent authentication

Add scoped personal API tokens at the Quollity gateway. A token delegates actions to an existing editor; it does not add an attendee or grant a new person editor status.

For the initial small private deployment, provision tokens with an administrative CLI. Generate a high-entropy bearer secret, display it once, and configure a gateway Worker secret containing token IDs, token hashes, owner login identities, allowed scopes, expiry, and disabled status. This avoids adding a database to the presently stateless gateway. Revocation/rotation replaces that secret registry. A browser token-management screen and persistent token registry can follow if needed.

- Clients send `Authorization: Bearer <token>` to public Places API paths over HTTPS.
- Suggested default scopes: `places:read`, `places:lookup`, `places:create`. Separate optional `visits:create` and `places:location:update` scopes; exclude people, boards, archive, and other components by default.
- With an Authorization header present, authenticate that credential explicitly; an invalid token cannot fall back to a browser session. Browser cookie authentication continues to work when no bearer credential is supplied.
- The gateway applies an explicit method/path allowlist for each scope, rejects expired/disabled credentials, strips the external token and all incoming internal auth headers, then proxies through its private Places binding.
- Introduce a Places-specific versioned internal signature containing token ID, scopes, owner identity, timestamp, method, child path/query, and body digest. Use an unambiguous canonical encoding. Places independently verifies the signature and scope, and resolves the owner to an active person through the existing aliases. Existing browser/Trips signature handling remains supported; never trust unsigned actor/scope headers.
- Keep request bodies bounded to the existing 128 KiB while computing the digest. No arbitrary cross-origin token management; machine credentials do not disable browser write protections.
- Add an audit event in the same transaction as each mutation: owner person ID, agent token ID when present, operation, entity ID, timestamp, and request ID. Visit `created_by` remains the delegating person, not a fake agent attendee. Do not log secrets or full private request bodies.

Publish OpenAPI plus a short agent guide. An agent obtains a token once, searches, selects the intended candidate based on the user's instructions, saves with an idempotency key, and optionally adds a visit through the existing endpoint. Ambiguity goes back to the caller; provider confidence alone does not justify choosing a destination. An MCP wrapper can expose these same operations later without introducing another write path.

## Delivery and acceptance

1. **Lookup and save:** provider adapter, shared schemas, source/provenance and snapshot migrations, import transaction, idempotency, duplicate review, compact create form, and manual fallback.
2. **Agent access:** gateway token provisioning/verification and signed scope delegation; child scope checks and audit events; OpenAPI and executable client example. This is required for the requested agent capability, not optional integration work.
3. **Location repair:** preview/apply enrichment on existing records with field provenance and revision checks. Keep the existing full-replacement PUT contract explicit.

Verify against the real API/SQLite test harness and authenticated browser, then the gateway and Cloudflare runtime:

- A successful named-place lookup fills available geography without asking the user to type it; a missing website/city remains null.
- No results, timeout, missing provider key, or exhausted quota still permits manual name + Other creation.
- Out-of-order browser responses cannot replace the latest search results; result selection works with keyboard and screen readers.
- Ambiguous names, city-centroid results, approximate meeting points, and two attractions at one coordinate remain distinguishable.
- Exact duplicates, archived duplicates, fuzzy review, experiences sharing a meeting point, and simultaneous imports behave as specified.
- Retrying place/visit creation after a lost response creates one record; changed-body retries conflict; expired lookup cannot break a committed replay.
- Provider refresh preserves manually changed and cleared fields, personal notes, visit history, and ranking-board restrictions.
- An agent token can perform only its granted operations. Expiry, revocation, inactive owner, forged scope/actor headers, invalid bearer plus valid cookie, and cross-component access are tested through the gateway and child.
- Provider attribution survives UI rendering and export. No provider key, bearer credential, shared signing secret, or personal visit data reaches the browser bundle/provider/logs.

Rollout requires a provider account/key and coordinated gateway/Places releases. See the setup guide for these dependencies; source implementation alone does not configure credentials or publish the release.
