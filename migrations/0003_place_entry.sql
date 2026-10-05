ALTER TABLE places ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER places_revision AFTER UPDATE ON places
WHEN NEW.revision = OLD.revision
BEGIN
  UPDATE places SET revision=OLD.revision+1 WHERE id=NEW.id;
END;
CREATE TABLE place_sources (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  osm_type TEXT,
  osm_id TEXT,
  purpose TEXT NOT NULL CHECK(purpose IN ('identity','location')),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  fetched_at TEXT NOT NULL,
  attribution TEXT NOT NULL
);
CREATE UNIQUE INDEX source_identity ON place_sources(provider,provider_id) WHERE purpose='identity';
CREATE UNIQUE INDEX osm_identity ON place_sources(osm_type,osm_id) WHERE purpose='identity' AND osm_type IS NOT NULL AND osm_id IS NOT NULL;
CREATE INDEX sources_place ON place_sources(place_id);
CREATE TABLE place_field_provenance (
  place_id TEXT NOT NULL REFERENCES places(id),
  field TEXT NOT NULL,
  source_id TEXT REFERENCES place_sources(id),
  imported_value TEXT NOT NULL CHECK(json_valid(imported_value)),
  overridden INTEGER NOT NULL DEFAULT 0 CHECK(overridden IN (0,1)),
  PRIMARY KEY(place_id,field)
);
CREATE TABLE place_lookup_cache (
  cache_key TEXT PRIMARY KEY,
  candidates TEXT NOT NULL CHECK(json_valid(candidates)),
  expires_at INTEGER NOT NULL
);
CREATE TABLE place_lookups (
  id TEXT PRIMARY KEY,
  principal TEXT NOT NULL,
  candidates TEXT NOT NULL CHECK(json_valid(candidates)),
  expires_at INTEGER NOT NULL
);
CREATE TABLE duplicate_reviews (
  id TEXT PRIMARY KEY,
  principal TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  matches TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE api_idempotency (
  principal TEXT NOT NULL,
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  response TEXT NOT NULL CHECK(json_valid(response)),
  status INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(principal,operation,key)
);
CREATE TABLE mutation_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
CREATE TABLE place_lookup_limits (principal TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(principal,window));
CREATE TABLE mutation_audit (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES people(id),
  token_id TEXT,
  operation TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
