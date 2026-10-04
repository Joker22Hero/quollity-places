PRAGMA foreign_keys = ON;

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 100),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE people_login_aliases (
  login_email TEXT PRIMARY KEY COLLATE NOCASE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT
);
CREATE TABLE place_types (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  parent_type_id TEXT REFERENCES place_types(id),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  short_name TEXT,
  place_type_id TEXT NOT NULL REFERENCES place_types(id) ON DELETE RESTRICT,
  place_kind TEXT NOT NULL DEFAULT 'physical_place' CHECK(place_kind IN ('physical_place','experience')),
  wishlist INTEGER NOT NULL DEFAULT 0 CHECK(wishlist IN (0,1)),
  city TEXT, region TEXT,
  country_code TEXT CHECK(country_code IS NULL OR (length(country_code)=2 AND country_code GLOB '[A-Z][A-Z]')),
  latitude REAL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL CHECK(longitude BETWEEN -180 AND 180),
  website_url TEXT, description TEXT, notes TEXT,
  operator TEXT, meeting_point TEXT, duration_minutes INTEGER CHECK(duration_minutes > 0),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((latitude IS NULL) = (longitude IS NULL)),
  CHECK(place_kind='experience' OR (operator IS NULL AND meeting_point IS NULL AND duration_minutes IS NULL))
);
CREATE INDEX places_type_country ON places(place_type_id,country_code,archived_at);
CREATE TABLE trip_references (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, country TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, canonical_url TEXT NOT NULL,
  validated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE place_visits (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  trip_id TEXT REFERENCES trip_references(id) ON DELETE RESTRICT,
  date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT CHECK(end_date IS NULL OR end_date >= date),
  rating_tenths INTEGER CHECK(rating_tenths IS NULL OR (typeof(rating_tenths)='integer' AND rating_tenths BETWEEN 10 AND 50)),
  notes TEXT,
  would_revisit TEXT CHECK(would_revisit IN ('definitely','maybe','probably_not')),
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id,place_id)
);
CREATE INDEX visits_place_date ON place_visits(place_id,archived_at,date DESC);
CREATE INDEX visits_trip ON place_visits(trip_id,date);
CREATE TABLE visit_attendees (
  visit_id TEXT NOT NULL REFERENCES place_visits(id) ON DELETE RESTRICT,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  PRIMARY KEY(visit_id,person_id)
);
CREATE TABLE ranking_boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  place_type_filter TEXT REFERENCES place_types(id) ON DELETE RESTRICT,
  country_filter TEXT,
  region_filter TEXT,
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE place_rankings (
  board_id TEXT NOT NULL REFERENCES ranking_boards(id) ON DELETE RESTRICT,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  rank INTEGER NOT NULL CHECK(rank > 0),
  note TEXT,
  PRIMARY KEY(board_id,place_id),
  UNIQUE(board_id,rank)
);
CREATE TABLE place_snap_links (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  visit_id TEXT,
  snap_id TEXT NOT NULL,
  caption TEXT,
  is_cover INTEGER NOT NULL DEFAULT 0 CHECK(is_cover IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
  FOREIGN KEY(visit_id,place_id) REFERENCES place_visits(id,place_id) ON DELETE RESTRICT,
  UNIQUE(place_id,snap_id)
);
CREATE UNIQUE INDEX one_snap_cover ON place_snap_links(place_id) WHERE is_cover=1;
CREATE VIEW place_summaries AS
SELECT p.*, t.label AS type_label,
  COUNT(v.id) AS visit_count, COUNT(v.rating_tenths) AS rated_visit_count,
  AVG(v.rating_tenths)/10.0 AS average_rating, MAX(v.date) AS latest_visit_date
FROM places p JOIN place_types t ON t.id=p.place_type_id
LEFT JOIN place_visits v ON v.place_id=p.id AND v.archived_at IS NULL
GROUP BY p.id;
