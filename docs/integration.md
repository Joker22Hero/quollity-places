# Integrating and releasing Places

The private Places Worker and frontend were deployed on 4 October 2026. The production D1 database is provisioned and both migrations are applied. On 5 October 2026, the shared signing secret was replaced across all four Workers and the Places gateway connection was deployed. The gateway source patch was subsequently applied, committed, and redeployed from its source repository.

## Deployment status

- Account: `4228a8b5a0cd76f123470d7f29cafb02` (Joker22Hero).
- Worker: `quollity-places`; deployed version `2d259df3-d902-4fa2-859d-4b9f787bd4c5`.
- D1: `quollity-places-db`, ID `f4a30168-4d4d-4830-8a4f-24150bd2bbf4`.
- Database verification: 18 place types, two people, two migration history entries, zero places.
- Production bindings: `DB`, `TRIPS` (`travel-visual`), and `ASSETS`; authentication mode `gateway`. Workers.dev and preview URLs are disabled.
- `QUOLLITY_INTERNAL_SECRET` was replaced with one cryptographically random 256-bit value on `quollity-gateway`, `zoo-visual`, `travel-visual`, and `quollity-places`. All four Wrangler secret updates succeeded. Gateway `VIEWER_PASSWORD` and `SESSION_SIGNING_SECRET` remain configured.
- The recoverable shared secret is saved in the Places repository's ignored `.dev.vars.production`, with owner-only permissions (`0600`). Never commit or print its contents. This file is not covered by Git backups; keep a separate secure backup, such as a password manager.
- Gateway source commit: `6b379bd` (`Connect Quollity Places to gateway navigation and routing`); its working tree is clean.
- Gateway deployment version: `05f7bc7e-81fd-4cb4-93a3-a7119bb8de65`. It includes the `PLACES` binding and `/places/` routing. Deployment used `--keep-vars`.
- The patched gateway release was prepared in `/private/tmp/quollity-places-gateway-release` without changing its source repository. Type checking, all 23 gateway tests, and Wrangler deployment dry run passed. That directory is temporary; recreate it from the checked-in patch if unavailable.

For a future secret change from the Places repository, Wrangler can prompt securely:

```sh
./node_modules/.bin/wrangler secret put QUOLLITY_INTERNAL_SECRET --env production
```

The gateway release is deployed from its committed source repository. Authenticated viewer/editor browser verification at `https://quollity.uk/places/` is still pending: the native browser connection failed during this release, and the web retrieval tool could not access the private component pages.

## Gateway

A reviewable patch is supplied at `docs/gateway-integration.patch`. It adds the private `PLACES` service binding, `/places` redirects and proxy routes, navigation, and a gateway home card. The gateway's existing signature and session handling remain the integration contract.

From the gateway repository, inspect and check the patch before applying it:

```sh
git apply --check ../quollity-places/docs/gateway-integration.patch
git apply ../quollity-places/docs/gateway-integration.patch
```

The patch is prepared against the gateway files present when this foundation was built. Recheck it if the gateway changes.

## Production configuration

1. Use the dedicated `quollity-places-db` D1 database recorded in the production environment of `wrangler.jsonc`; it is already provisioned.
2. Configure `QUOLLITY_INTERNAL_SECRET` as a Worker secret using the same trusted shared secret as the gateway and Trips. Never commit it.
3. Apply pending Places migrations to the production D1 database after reviewing the schema. The initial two migrations are already applied and recorded in `d1_migrations`.
4. Run the production build and Wrangler dry run. Production auth must remain `gateway`; Workers.dev and preview URLs must remain disabled.
5. Deploy the private child Worker, then release the gateway change and verify viewer/editor access through `/places/`.

The production configuration selects the dedicated database by its real ID. Places has no R2 bucket or independent photo storage.

## Trips

Places already consumes the existing Trips catalogue and provides a linked-visit read API. The remaining Trips change is to add an authenticated `PLACES` service binding and consume `GET /api/visits?tripId=...`, grouping visits by local date in realised trip days. An “Add place visited” action should call the Places visit-create endpoint rather than introducing a duplicate relationship table.

Use canonical `tripId` values from the catalogue. A display name or slug is not a valid substitute. Stable itinerary day IDs are a separate concept and require a future explicit contract if linking to a particular day becomes necessary.

## Snaps

No photo upload or storage is implemented in Places. Before exposing a Snaps picker, establish stable photo IDs, canonical links, authorisation, and thumbnail delivery. Then connect the reference-only endpoints. Confirm or replace the provisional `/snaps/photos/:snapId` route in `shared/paths.ts`.

## Development verification in this session

- The TypeScript check passed.
- The client and Worker build passed.
- The production `/places/` build and Wrangler dry run passed.
- In-process API/SQLite integration tests passed.
- The gateway patch passed a read-only `git apply --check` against the current gateway repository.

The managed sandbox blocked package downloads and binding local server ports. Tests/builds used an isolated copy of the existing Zoos dependency set; `pnpm-lock.yaml` locks the matching dependency graph. A clean install, live browser preview, local Wrangler D1 migration, and runtime type generation remain to be verified outside that restriction.

`worker-configuration.d.ts` contains generated binding types. `worker/runtime.d.ts` is a temporary, licensed runtime-type snapshot from Zoos generated with the same installed Wrangler/workerd versions. `pnpm cf:typegen` regenerates the full types and removes that snapshot after successful runtime generation.

## Places identity and account pass — 5 October 2026 (not deployed)

Applied the family museum-terracotta/cream palette, shared green anchor,
responsive two-row navigation, accessible hover/focus and reduced motion.
Viewer/editor header status, the read-only creation boundary and load-error
recovery point to the Gateway `/#account` menu. Existing API authorization,
place/visit data, lookup and scoped-agent contracts are unchanged.

Local verification: 56 tests (API, rendering, place entry and palette contrast),
TypeScript, production build and deployment dry-run. Frontend browser fixtures
verified 1440/820/390/320px layouts, viewer/editor account links, creation boundary,
creation entry, place details, keyboard navigation, hover/reduced motion and
loading/error states. The installed local Worker emulator cannot run the
existing October compatibility date; browser checks used a frontend-only Vite
preview with mocked APIs. No live identity login or production reads/writes were
performed. Release this alongside the Gateway shared-account commit `d09a67a`;
production deployment remains a separate action.
