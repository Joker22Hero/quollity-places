import type { Board, Place } from './contracts';

export function eligibleForBoard(
  place: Place,
  board: Pick<Board, 'placeTypeFilter' | 'countryFilter' | 'regionFilter'>,
) {
  return (
    !place.archivedAt &&
    (!board.placeTypeFilter || place.placeTypeId === board.placeTypeFilter) &&
    (!board.countryFilter || place.countryCode === board.countryFilter) &&
    (!board.regionFilter ||
      place.region?.toLocaleLowerCase() ===
        board.regionFilter.toLocaleLowerCase())
  );
}

// Preserve the full average for ordering; round only for display.
export function automaticRanking(places: Place[]) {
  const rated = places
    .filter((place) => !place.archivedAt && place.averageRating !== null)
    .sort(
      (a, b) =>
        b.averageRating! - a.averageRating! ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  let rank = 0;
  return rated.map((place, index) => {
    if (
      index === 0 ||
      Math.abs(place.averageRating! - rated[index - 1].averageRating!) > 1e-8
    )
      rank = index + 1;
    return { place, rank };
  });
}
