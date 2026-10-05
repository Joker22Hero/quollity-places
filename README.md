# Quollity Places

Quollity Places records what we visit, how we experience it, and how it compares with other places. It provides one consistent way to record visits, ratings, notes, photos, and rankings across many attraction types, with optional metadata where a type needs it.

The general architecture is implemented as a React/Vite app and a private Cloudflare Worker backed by D1. It includes place and visit management, average ratings, wishlist, archive/restore, directory filters, automatic rankings, manual ranked collections, editable attendees, validated Trips links, and reference-only hooks for future Quollity Snaps integration.

Photos belong to **Quollity Snaps**. Places does not upload or store its own media. Gateway publication, the Trips consumer UI, and the Snaps picker are follow-up integration work.

## Run locally

Use Node 22.13 or newer and pnpm 11.19.0, matching the other Quollity component's package-manager conventions.

```sh
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm dev
```

The migrations seed the type taxonomy and Michael/Jack with their existing Quollity person IDs. They do not seed example places or visits. Local editor authentication is restricted to loopback hosts.

```sh
pnpm typecheck
pnpm test
pnpm build:production
pnpm deploy:dry-run
```

The production build uses `/places/` and gateway authentication. The private Worker, frontend assets, database, shared signing secret, and gateway connection are deployed. Authenticated browser verification remains pending. See [deployment status](docs/integration.md#deployment-status).

Read the [architecture](docs/architecture.md), [API contract](docs/api.md), and [integration/release notes](docs/integration.md) for implementation details and verification limits. A reviewable [gateway patch](docs/gateway-integration.patch) is included.

## Confirmed decisions

- Display and rank by the **average of active rated visits**; keep individual visit scores.
- Use an optional overall rating from **1.0 to 5.0 in 0.1 steps**.
- Maintain a separate **wishlist** flag, including for places already visited.
- **Archive** places, visits, and boards; retain history and support restore.
- Link photos to future **Quollity Snaps**, with no Places-owned media storage.
- Seed **Michael and Jack** and allow the attendee list to be edited. Adding an attendee does not grant editor access.

## Where Places fits

| Component  | Purpose                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| **Trips**  | When and where we travelled.                                                    |
| **Places** | What we did and how we rated it.                                                |
| **Zoos**   | A specialist view of zoos, their collections, animal sightings, and enclosures. |

Use **Places** in the UI. It accommodates museums and gardens as naturally as churches, cemeteries, scenic walks, and tours.

Zoos remain a separate component because they have deeper domain requirements: taxa, holdings, sightings, enclosure rankings, collection metrics, and ZTL integration. A trip can present zoo visits and place visits in the same travel history, with each opening its appropriate interface.

## Design principles

- Separate a place from each visit to it. Revisit the same record without duplicating its identity, general notes, or photos.
- Use one shared model across types. Do not create separate museum, church, garden, and tour tables.
- Keep overall ratings independent of any future dimension ratings.
- Offer rankings automatically, with explicit ranked collections for personal preferences.
- Link a visit to a trip from either component through the same underlying relationship.
- Add specialised metadata when an actual use case needs it.
- Launch Places without refactoring the existing Zoos visit system. Consider convergence later if it proves useful.

## Supported places and experiences

Start with a controlled, deliberately broad taxonomy:

| Type                | Examples                                     |
| ------------------- | -------------------------------------------- |
| Botanic garden      | Kew Gardens, Kirstenbosch                    |
| Museum              | History, science, or natural history museum  |
| Art gallery         | Art museum or gallery                        |
| Church / cathedral  | Religious buildings and their grounds        |
| Temple / shrine     | Temples and shrines                          |
| Castle / palace     | Castles, palaces, and associated gardens     |
| Historic house      | Houses and estates                           |
| Archaeological site | Excavations and ancient sites                |
| Monument            | Memorials and monuments                      |
| Scenic attraction   | Viewpoints and scenic walks                  |
| Park / garden       | Public parks and ornamental gardens          |
| Aquarium            | Only where deliberately managed outside Zoos |
| Theme park          | Theme and amusement parks                    |
| Tour                | Guided or self-contained visitor tours       |
| Cruise / boat trip  | Sightseeing and wildlife boat trips          |
| Railway / cable car | Transport visited as an experience           |
| Visitor experience  | Other organised experiences                  |
| Other               | Places that do not yet fit another type      |

Type labels and ordering are data, not separate application modules. Optional parent types can support broader browse groups such as religious sites, historic sites, and nature. Avoid detailed subtypes until they are useful.

## Core data model

The following summarises the domain model. The implemented database contract is in `migrations/`, and shared API fields are defined in `shared/contracts.ts`. Place and visit IDs use UUIDs; trip IDs come from the existing Trips catalogue.

### Places and types

```text
places
  id
  name
  short_name?
  place_type_id
  place_kind                 physical_place | experience
  city?
  region?
  country_code?
  latitude?
  longitude?
  website_url?
  description?
  notes?
  wishlist
  archived_at?
  operator?                  for experiences
  meeting_point?             for experiences
  duration_minutes?          for experiences
  created_at
  updated_at

place_types
  id
  slug
  label
  parent_type_id?
  icon?
  sort_order
```

Coordinates are optional and validated as a pair when supplied. An experience can use its main location or meeting point. Wishlist is independent of visited history; archiving controls directory visibility and preserves records.

Keep `description` for a general description and `notes` for personal, reusable observations. Do not initially add fields such as museum collection size, church denomination, or garden area.

### Visits

```text
place_visits
  id
  place_id
  trip_id?
  date
  end_date?
  attendees
  overall_rating?
  notes?
  would_revisit?             definitely | maybe | probably_not
  created_at
  updated_at
```

Every visit belongs to one place. A place can have many visits, including visits without a trip. Dates describe the visit in local calendar terms; `end_date`, when supplied, must not precede `date`. Attendees use person identifiers; Michael and Jack share the stable IDs already used in Zoos. People can be renamed or deactivated while keeping their history.

Overall ratings belong to visits so impressions can change over time. A place's displayed score and automatic ranking use the average of all active rated visits. Unrated visits do not affect the average; archived visits remain in history but are excluded. Keep the full average for ranking and display it to one decimal place, with all individual visit scores available.

An eventual generic `visits(subject_type, subject_id, ...)` model may be worth considering. It is not a prerequisite for Places and must not force a Zoos migration at launch.

### Notes

Place notes describe lasting observations, such as excellent glasshouses or grounds that require most of a day. Visit notes describe that occasion, such as arrival times, closures, weather, or what was seen.

V1 uses freeform notes at both levels. Structured note blocks with optional headings, text, and ordering can follow the existing Zoos approach later, while preserving ownership by either a place or a visit.

### Photo references to Snaps

```text
place_snap_links
  id
  place_id
  visit_id?
  snap_id
  caption?
  is_cover
  sort_order
```

Photos are owned by the future Quollity Snaps component. Places stores relationships to external photo IDs, not media files. A reference can describe the place generally or belong to a matching visit, and one can be marked as a cover reference.

The foundation provides the relationship schema and API. Thumbnail rendering and photo selection will be connected when Snaps provides its ID, authorisation, and URL contracts. No separate photo library, upload workflow, or photo limits are introduced here.

## Ratings

Use an optional overall score from **1.0 to 5.0**, with **0.1 precision** as confirmed. Store ratings as integer tenths and derive averages for display and rankings. An unrated visit is distinct from a low score.

Example reference points:

| Score | Meaning        |
| ----- | -------------- |
| 5.0   | Exceptional    |
| 4.5   | Excellent      |
| 4.0   | Very good      |
| 3.5   | Good           |
| 3.0   | Worth visiting |
| 2.5   | Fine           |
| 2.0   | Disappointing  |
| 1.0   | Poor           |

“Would revisit” is optional and separate from quality: an excellent place may still feel complete after one visit. A recommendation field can be added later if useful.

### Future dimension ratings

Add dimensions once real entries show which comparisons matter:

```text
rating_dimensions
  id
  place_type_id
  slug
  label
  sort_order

place_rating_values
  visit_id
  dimension_id
  rating
```

Each visit/dimension pair has at most one score. Dimensions must apply to the place's type, and missing values remain unrated. Type changes must preserve historical scores rather than silently deleting them.

| Type               | Possible dimensions                                                            |
| ------------------ | ------------------------------------------------------------------------------ |
| Botanic garden     | Plant collection, landscape/design, glasshouses, presentation, wildlife/nature |
| Museum             | Collection, presentation, building, interpretation, uniqueness                 |
| Church / cathedral | Architecture, interior, historic interest, art, atmosphere                     |
| Theme park         | Rides, theming, operations, landscaping, food                                  |

Dimensions are optional. Never calculate the overall rating from their average.

## Rankings and highlights

Automatic rankings use the displayed place score and can be filtered by type, country, region, or city. Provide useful defaults such as favourite places overall, botanic gardens, museums, and places visited in Japan. Show ties clearly and use a stable secondary order for display; exclude unrated places from rating-based ranks.

Explicit ranking boards capture preferences that scores alone cannot express:

```text
ranking_boards
  id
  name
  place_type_filter?
  country_filter?
  region_filter?
  created_by
  created_at
  updated_at

place_rankings
  board_id
  place_id
  rank
  note?
```

A board is an explicit ordered selection, with each place appearing at most once and each position unique within that board. Optional filters constrain eligibility. Automatic rankings are derived views and do not require stored board rows. Manual order applies within its board and does not change a place's rating or other rankings.

Seed a shortlist from ratings and let the user reorder it by drag-and-drop, with accessible move controls. Show scores alongside manual positions.

**Highlights** use the same ranked-collection model across types: best architecture, best gardens, best interiors, best viewpoints, best historic sites, best experiences, most surprising, and most disappointing. Alhambra can appear in several boards without duplicating its place record.

A later comparison view can show overall and dimension scores side by side, with missing scores clearly indicated and the source visit available.

## Main screens

### Directory

Use a visual card directory with:

- Counts of distinct visited places, countries, and types.
- Top-rated places and recently visited places.
- Browse groups by type and country.
- Filters for type, country, trip, attendee, rating, year, and photos.
- A map for places with coordinates.

Count places separately from visits. Derive visit-related filters from visits so repeat visits do not inflate place totals. Offer a useful fallback when a card has no cover image.

### Place page

Use a compact header with name, location, type, displayed overall rating, and relevant rank. When Snaps is connected, follow it with a cover image. The foundation provides sections for:

1. Visits, including dates, attendees, scores, and trip links.
2. General place notes.
3. Linked Snaps references with captions; highlight previews follow the Snaps integration.
4. Rankings and highlight-board membership.
5. Location and website.
6. Dimension ratings when that feature is introduced.

Keep visit notes and historical ratings accessible from each visit. Avoid oversized headings and excessive whitespace. All examples and illustrative scores in design work are placeholders, not imported personal history.

## Trips integration

A realised trip day should show the places visited, their visit scores, and links to full records. The place page should link back to each associated trip.

Support both entry points:

- **From Trips:** “Add place visited” selects or creates a place and adds a visit linked to that trip.
- **From Places:** “Add visit” records the visit and optionally links an existing trip.

Both actions create the same place-visit relationship. Trip names, itinerary text, and ratings must not become separate copies of the place record. Confirm how trip identifiers and day links work in the existing Trips contract before implementing integration.

Combined trip history can include, for example, ZooParc de Beauval as a zoo visit, Château de Cheverny as a castle visit, and Maison de la Magie as a museum visit. Each opens in its own component. Do not duplicate Zoos records in Places merely to assemble this view.

## V1 scope

1. Places and a controlled type taxonomy.
2. Physical places and experiences in the same model.
3. One or more visits per place, with optional validated trip links and attendees.
4. Optional overall ratings and “would revisit”.
5. Freeform place and visit notes.
6. Reference-only photo hooks for future Quollity Snaps; media remains owned by Snaps.
7. Automatic rankings by rating, type, and geography.
8. Manual ranked lists, including cross-category highlights.
9. A card directory, filters, and individual place pages.
10. Coordinates and a map/location view.
11. A shared visit API for Places and the future Trips consumer UI.

Defer dimension ratings, structured notes, comparison views, broader photo-library integration, recommendation metrics, and a generic cross-component visit abstraction. Specialised metadata should follow demonstrated needs.

## Remaining integration work

- Apply and release the reviewed gateway binding/routes/navigation patch alongside the private Places Worker.
- Select the real production D1 database and configure the shared gateway secret.
- Add the Trips consumer UI for place visits on realised days, using the provided Places API.
- Agree Snaps photo IDs, canonical URLs, authorised thumbnails, and reference validation before enabling the photo picker.
- Run a live browser and Cloudflare runtime check in an environment that permits local server ports.
- Add dimension ratings, structured notes, and comparison views when real usage shows what is useful.

The initial rating, archive, wishlist, photo-ownership, and attendee decisions have been resolved above.

## V1 acceptance criteria

- Revisiting a place adds a visit to the existing record and preserves previous notes and ratings.
- General notes and Snaps references remain useful across visits; visit-specific content stays attached to its visit.
- Unrated visits, places without photos, and places without coordinates work throughout the UI.
- Directory counts and rankings treat a place as one entity even when it has many visits.
- Manual board ordering persists without altering ratings or unrelated boards.
- Places creates and validates trip-linked visits through one API; the Trips consumer uses the same relationship when integrated.
- A tour can record an operator, meeting point, duration, and location without a separate module.
- Zoo visits can appear alongside place visits in trip history without migrating Zoos into Places.
