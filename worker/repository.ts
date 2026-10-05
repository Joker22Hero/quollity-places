import type { Board, Place, Visit, SnapLink } from '../shared/contracts';
import { snapUrl } from '../shared/paths';
import { fail } from './http';
export type PersonRow = { id: string; display_name: string; active: number };
export const personFromRow = (row: PersonRow) => ({
  id: row.id,
  displayName: row.display_name,
  active: Boolean(row.active),
});
export type PlaceRow = {
  revision: number;
  id: string;
  name: string;
  short_name: string | null;
  place_type_id: string;
  place_kind: 'physical_place' | 'experience';
  wishlist: number;
  city: string | null;
  region: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  website_url: string | null;
  description: string | null;
  notes: string | null;
  operator: string | null;
  meeting_point: string | null;
  duration_minutes: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  type_label: string;
  visit_count: number;
  rated_visit_count: number;
  average_rating: number | null;
  latest_visit_date: string | null;
};
export function placeFromRow(row: PlaceRow): Place {
  return {
    id: row.id,
    revision: row.revision,
    name: row.name,
    shortName: row.short_name,
    placeTypeId: row.place_type_id,
    placeKind: row.place_kind,
    wishlist: Boolean(row.wishlist),
    city: row.city,
    region: row.region,
    countryCode: row.country_code,
    latitude: row.latitude,
    longitude: row.longitude,
    websiteUrl: row.website_url,
    description: row.description,
    notes: row.notes,
    operator: row.operator,
    meetingPoint: row.meeting_point,
    durationMinutes: row.duration_minutes,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    typeLabel: row.type_label,
    visitCount: row.visit_count,
    ratedVisitCount: row.rated_visit_count,
    averageRating: row.average_rating,
    latestVisitDate: row.latest_visit_date,
  };
}
export async function getPlace(db: D1Database, id: string) {
  const row = await db
    .prepare('SELECT * FROM place_summaries WHERE id=?')
    .bind(id)
    .first<PlaceRow>();
  if (!row) fail(404, 'Place not found.');
  return placeFromRow(row);
}
export async function requireActivePlace(db: D1Database, id: string) {
  const place = await getPlace(db, id);
  if (place.archivedAt) fail(409, 'Restore this place before editing it.');
  return place;
}
export async function requireType(db: D1Database, id: string | null) {
  if (
    id &&
    !(await db
      .prepare('SELECT id FROM place_types WHERE id=?')
      .bind(id)
      .first())
  )
    fail(400, 'Unknown place type.');
}
export type BoardRow = {
  id: string;
  name: string;
  place_type_filter: string | null;
  country_filter: string | null;
  region_filter: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
export const boardFromRow = (row: BoardRow): Board => ({
  id: row.id,
  name: row.name,
  placeTypeFilter: row.place_type_filter,
  countryFilter: row.country_filter,
  regionFilter: row.region_filter,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});
export async function getBoard(db: D1Database, id: string) {
  const row = await db
    .prepare('SELECT * FROM ranking_boards WHERE id=?')
    .bind(id)
    .first<BoardRow>();
  if (!row) fail(404, 'Ranking board not found.');
  return boardFromRow(row);
}
export type VisitRow = {
  id: string;
  place_id: string;
  trip_id: string | null;
  date: string;
  end_date: string | null;
  rating_tenths: number | null;
  notes: string | null;
  would_revisit: Visit['wouldRevisit'];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  trip_name: string | null;
  trip_country: string | null;
  trip_start: string | null;
  trip_end: string | null;
  trip_url: string | null;
};
export const visitSelect = `SELECT v.*, t.name AS trip_name, t.country AS trip_country, t.start_date AS trip_start, t.end_date AS trip_end, t.canonical_url AS trip_url FROM place_visits v LEFT JOIN trip_references t ON t.id=v.trip_id`;
export async function visitsFromRows(
  db: D1Database,
  rows: VisitRow[],
): Promise<Visit[]> {
  if (!rows.length) return [];
  const attendees: (PersonRow & { visit_id: string })[] = [];
  for (let offset = 0; offset < rows.length; offset += 80) {
    const part = rows.slice(offset, offset + 80);
    const result = await db
      .prepare(
        `SELECT a.visit_id,p.* FROM visit_attendees a JOIN people p ON p.id=a.person_id WHERE a.visit_id IN (${part.map(() => '?').join(',')}) ORDER BY p.display_name`,
      )
      .bind(...part.map((row) => row.id))
      .all<PersonRow & { visit_id: string }>();
    attendees.push(...result.results);
  }
  return rows.map((row) => ({
    id: row.id,
    placeId: row.place_id,
    date: row.date,
    endDate: row.end_date,
    overallRating: row.rating_tenths === null ? null : row.rating_tenths / 10,
    notes: row.notes,
    wouldRevisit: row.would_revisit,
    tripId: row.trip_id,
    trip:
      row.trip_id && row.trip_name
        ? {
            tripId: row.trip_id,
            name: row.trip_name,
            country: row.trip_country!,
            startDate: row.trip_start!,
            endDate: row.trip_end!,
            canonicalUrl: row.trip_url!,
            suggested: false,
          }
        : null,
    attendees: attendees
      .filter((person) => person.visit_id === row.id)
      .map(personFromRow),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
export type SnapRow = {
  id: string;
  place_id: string;
  visit_id: string | null;
  snap_id: string;
  caption: string | null;
  is_cover: number;
  sort_order: number;
};
export const snapFromRow = (row: SnapRow): SnapLink => ({
  id: row.id,
  placeId: row.place_id,
  visitId: row.visit_id,
  snapId: row.snap_id,
  caption: row.caption,
  isCover: Boolean(row.is_cover),
  sortOrder: row.sort_order,
  canonicalUrl: snapUrl(row.snap_id),
});
