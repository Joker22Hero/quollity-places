# Places API

All paths below are child-Worker paths. Through the gateway prefix them with `/places`. Requests require a verified Quollity gateway role, or loopback-only local editor authentication. JSON writes require `Content-Type: application/json`.

| Method | Path                                  | Purpose                                                            |
| ------ | ------------------------------------- | ------------------------------------------------------------------ |
| GET    | `/api/session`                        | Current role and optional editor person.                           |
| GET    | `/api/types`                          | Controlled type taxonomy.                                          |
| GET    | `/api/people`                         | Active and inactive attendees.                                     |
| POST   | `/api/people`                         | Add an attendee; does not grant editor access.                     |
| PUT    | `/api/people/:id`                     | Rename or activate/deactivate a person.                            |
| GET    | `/api/trips`                          | Validated Trips catalogue; empty locally if unconnected.           |
| GET    | `/api/places`                         | Paginated directory and filtered counts.                           |
| POST   | `/api/places`                         | Create a place.                                                    |
| GET    | `/api/places/rankings`                | Automatic ranks, with ties, before pagination.                     |
| GET    | `/api/places/:id`                     | Place summary, visit history, Snaps references, board memberships. |
| PUT    | `/api/places/:id`                     | Replace editable place fields.                                     |
| PUT    | `/api/places/:id/archive`             | Archive/restore via `{ "archived": true/false }`.                  |
| POST   | `/api/places/:placeId/visits`         | Add a visit, optionally validating a trip ID.                      |
| GET    | `/api/visits?tripId=...`              | Active linked visits for a realised trip.                          |
| PUT    | `/api/visits/:id`                     | Replace editable visit fields.                                     |
| PUT    | `/api/visits/:id/archive`             | Archive/restore a visit.                                           |
| GET    | `/api/boards`                         | Active boards; `archived=true` selects archived boards.            |
| POST   | `/api/boards`                         | Create a filtered or cross-category ranked collection.             |
| GET    | `/api/boards/:id`                     | Board and ordered entries.                                         |
| PUT    | `/api/boards/:id`                     | Rename a board or update compatible filters.                       |
| PUT    | `/api/boards/:id/entries`             | Atomically replace the ordered list.                               |
| PUT    | `/api/boards/:id/archive`             | Archive/restore a board.                                           |
| POST   | `/api/places/:placeId/snap-links`     | Create/update a future Snaps reference by external ID.             |
| DELETE | `/api/places/:placeId/snap-links/:id` | Unlink a reference; never delete Snaps media.                      |

`PUT` for a place or visit replaces its editable fields; omitted optional values become defaults or null. Use the full input object when editing. Shared request/response schemas in `shared/contracts.ts` are the authoritative field contracts. New entities receive server-generated UUIDs. Creates return HTTP 201, updates return 200, and reference unlinking returns 204.

## Directory filters

`q`, `type`, `country` (uppercase two-letter code), `region`, `trip`, `attendee` (person UUID), `year` (four digits), `minRating`, `wishlist=true|false`, `hasSnaps=true|false`, `archived=true|false`, `sort=name|rating|recent`, `limit`, and `offset`.

Unrated places remain in the directory and are excluded from automatic rating ranks. Manual boards can include unrated places. A place's score always reflects all its active rated visits.

## Examples

Create a place:

```json
{
  "name": "Example garden",
  "placeTypeId": "botanic-garden",
  "placeKind": "physical_place",
  "countryCode": "GB",
  "wishlist": true,
  "notes": "General observations."
}
```

Add a visit using the returned place ID:

```json
{
  "date": "2026-05-20",
  "attendeeIds": ["0f780640-84b1-4aef-9374-823f600a4101"],
  "overallRating": 4.7,
  "notes": "Observations from this visit.",
  "wouldRevisit": "definitely",
  "tripId": null
}
```

Replace a board's list; array order determines rank:

```json
{
  "entries": [
    { "placeId": "<place UUID>", "note": "Favourite interior." },
    { "placeId": "<another place UUID>", "note": null }
  ]
}
```

## Errors

Errors return `{ "error": "message" }` and a suitable HTTP status: 400 for invalid inputs, 401 for missing gateway verification, 403 for forbidden actions, 404 for missing records, 409 for conflicting state, 413 for oversized requests, and 503 for unavailable Trips integration. Unexpected failures include a request ID and are logged without request bodies or secrets.
