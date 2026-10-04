// Snaps owns its media. This route is a provisional reference contract only.
export const snapUrl = (snapId: string) =>
  `/snaps/photos/${encodeURIComponent(snapId)}`;
export const placeUrl = (placeId: string) =>
  `/places/place/${encodeURIComponent(placeId)}`;
