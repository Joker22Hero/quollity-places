-- Optional factual data; personal and visit data remain in their existing tables.
ALTER TABLE places ADD COLUMN facts TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(facts));
ALTER TABLE place_sources ADD COLUMN confidence REAL CHECK(confidence IS NULL OR (confidence>=0 AND confidence<=1));
CREATE TABLE place_enrichment_cache (
  cache_key TEXT PRIMARY KEY,
  candidate TEXT NOT NULL CHECK(json_valid(candidate)),
  expires_at INTEGER NOT NULL
);
