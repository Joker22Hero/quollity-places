# Integrating and releasing Places

The foundation is built locally. No Cloudflare resources have been provisioned, no production data has been changed, and the sibling repositories have not been modified.

## Gateway

A reviewable patch is supplied at `docs/gateway-integration.patch`. It adds the private `PLACES` service binding, `/places` redirects and proxy routes, navigation, and a gateway home card. The gateway's existing signature and session handling remain the integration contract.

From the gateway repository, inspect and check the patch before applying it:

```sh
git apply --check ../quollity-places/docs/gateway-integration.patch
git apply ../quollity-places/docs/gateway-integration.patch
```

The patch is prepared against the gateway files present when this foundation was built. Recheck it if the gateway changes.

## Production configuration

1. Provision the dedicated `quollity-places-db` D1 database and record its real database ID in the production environment of `wrangler.jsonc`.
2. Configure `QUOLLITY_INTERNAL_SECRET` as a Worker secret using the same trusted shared secret as the gateway and Trips. Never commit it.
3. Apply Places migrations to the production D1 database after reviewing the schema.
4. Run the production build and Wrangler dry run. Production auth must remain `gateway`; Workers.dev and preview URLs must remain disabled.
5. Deploy the private child Worker, then release the gateway change and verify viewer/editor access through `/places/`.

The configuration intentionally has no resource IDs or R2 bucket. Do not deploy until the intended D1 database has been explicitly selected. Deployment is outside the current architecture task.

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
