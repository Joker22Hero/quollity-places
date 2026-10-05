import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Visit } from '../shared/contracts';
import { put, schemas } from './api';
import { Action, Loading, locationName, score } from './components';
import { PlaceForm } from './PlaceForm';
import { VisitForm } from './VisitForm';
import { LocationRepair } from './LocationRepair';
import { Attribution } from './PlaceLookup';
import { useReferenceData, useResource } from './state';
export function PlacePage() {
  const { id } = useParams();
  const { session, refresh } = useReferenceData();
  const { data, error, loading } = useResource(`/places/${id}`, schemas.place);
  const [repairLocation, setRepairLocation] = useState(false);
  const [editPlace, setEditPlace] = useState(false);
  const [editVisit, setEditVisit] = useState<Visit | 'new' | null>(null);
  if (!data) return <Loading loading={loading} error={error} />;
  const { place, visits, snaps, boards } = data;
  const archived = Boolean(place.archivedAt);
  const canEdit = !session.readOnly && !archived;
  const activeVisits = visits.filter((visit) => !visit.archivedAt);
  const archivedVisits = visits.filter((visit) => visit.archivedAt);
  return (
    <>
      <Link className="back" to="/">
        ← Places
      </Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">
            {place.typeLabel}
            {place.placeKind === 'experience' ? ' · Experience' : ''}
            {place.wishlist ? ' · Wishlist' : ''}
            {archived ? ' · Archived' : ''}
          </p>
          <h1>{place.name}</h1>
          <p className="intro">{locationName(place)}</p>
          <div className="score-line">
            <strong>{score(place.averageRating)}</strong>
            <span>
              {place.ratedVisitCount
                ? `Average of ${place.ratedVisitCount} rated visit${place.ratedVisitCount === 1 ? '' : 's'}`
                : 'No ratings yet'}{' '}
              · {place.visitCount} visit{place.visitCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        {!session.readOnly && (
          <div className="actions">
            {canEdit && (
              <button onClick={() => setEditPlace(!editPlace)}>
                Edit place
              </button>
            )}
            <Action
              run={async () => {
                await put(
                  `/places/${id}/archive`,
                  { archived: !archived },
                  schemas.savedPlace,
                );
                setEditPlace(false);
                setEditVisit(null);
                refresh();
              }}
            >
              {archived ? 'Restore place' : 'Archive place'}
            </Action>
          </div>
        )}
      </header>
      {editPlace && canEdit && (
        <section>
          <h2>Edit place</h2>
          <PlaceForm place={place} onDone={() => setEditPlace(false)} />
        </section>
      )}
      {place.description && (
        <p className="description prose">{place.description}</p>
      )}
      <div className="detail-grid">
        <div>
          <section>
            <div className="section-heading">
              <h2>Your visits</h2>
              {canEdit && (
                <button onClick={() => setEditVisit('new')}>+ Add visit</button>
              )}
            </div>
            {editVisit && canEdit && (
              <VisitForm
                key={editVisit === 'new' ? 'new' : editVisit.id}
                placeId={place.id}
                visit={editVisit === 'new' ? undefined : editVisit}
                onDone={() => setEditVisit(null)}
              />
            )}
            {activeVisits.length ? (
              <div className="visits">
                {activeVisits.map((visit) => (
                  <article key={visit.id} className="visit">
                    <div className="section-heading">
                      <h3>
                        {visit.date}
                        {visit.endDate && visit.endDate !== visit.date
                          ? ` — ${visit.endDate}`
                          : ''}
                      </h3>
                      <span className="rating">
                        {score(visit.overallRating)}
                      </span>
                    </div>
                    <p className="muted">
                      {visit.attendees
                        .map((person) => person.displayName)
                        .join(' + ') || 'Attendees not recorded'}
                    </p>
                    {visit.trip && (
                      <p>
                        During{' '}
                        <a href={visit.trip.canonicalUrl}>{visit.trip.name}</a>
                      </p>
                    )}
                    {visit.notes && <p className="prose">{visit.notes}</p>}
                    {visit.wouldRevisit && (
                      <p className="muted">
                        Would revisit: {visit.wouldRevisit.replaceAll('_', ' ')}
                      </p>
                    )}
                    {canEdit && (
                      <div className="actions">
                        <button
                          className="secondary"
                          onClick={() => setEditVisit(visit)}
                        >
                          Edit visit
                        </button>
                        <Action
                          run={async () => {
                            await put(
                              `/visits/${visit.id}/archive`,
                              { archived: true },
                              schemas.savedVisit,
                            );
                            refresh();
                          }}
                        >
                          Archive visit
                        </Action>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No active visits recorded yet.</p>
            )}
            {archivedVisits.length > 0 && (
              <details>
                <summary>
                  {archivedVisits.length} archived visit
                  {archivedVisits.length === 1 ? '' : 's'}
                </summary>
                {archivedVisits.map((visit) => (
                  <article className="visit" key={visit.id}>
                    <h3>
                      {visit.date} · {score(visit.overallRating)}
                    </h3>
                    <p className="prose">{visit.notes}</p>
                    {canEdit && (
                      <Action
                        run={async () => {
                          await put(
                            `/visits/${visit.id}/archive`,
                            { archived: false },
                            schemas.savedVisit,
                          );
                          refresh();
                        }}
                      >
                        Restore visit
                      </Action>
                    )}
                  </article>
                ))}
              </details>
            )}
          </section>
          <section>
            <h2>Place notes</h2>
            <p className={place.notes ? 'prose' : 'muted'}>
              {place.notes ??
                'Add observations that remain useful across visits.'}
            </p>
          </section>
          <section>
            <h2>Photos in Snaps</h2>
            {snaps.length ? (
              <ul className="simple-list">
                {snaps.map((snap) => (
                  <li key={snap.id}>
                    <a href={snap.canonicalUrl}>
                      {snap.caption ?? snap.snapId}
                    </a>
                    {snap.isCover && (
                      <span className="muted"> · Cover reference</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Photos will be linked from Quollity Snaps when it is connected.
              </p>
            )}
          </section>
        </div>
        <aside>
          <section>
            <h2>Ranked collections</h2>
            {boards.length ? (
              <ul className="simple-list">
                {boards.map((board) => (
                  <li key={board.id}>
                    <span className="rank">#{board.rank}</span>
                    <Link to={`/boards/${board.id}`}>{board.name}</Link>
                    {board.note && <p className="muted">{board.note}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Add this place to a favourite or highlight collection.
              </p>
            )}
            <Link to="/rankings">Explore rankings →</Link>
          </section>
          <section>
            <h2>Location</h2>
            {canEdit && (
              <button
                type="button"
                className="secondary"
                onClick={() => setRepairLocation(!repairLocation)}
              >
                Find location
              </button>
            )}
            {repairLocation && canEdit && (
              <LocationRepair
                place={place}
                onDone={() => setRepairLocation(false)}
              />
            )}
            {data.location?.sources.slice(0, 1).map((source) => (
              <div key={source.id}>
                <Attribution candidate={source.candidate} />
                {source.candidate.precision === 'approximate' && (
                  <p className="muted">Approximate location</p>
                )}
              </div>
            ))}
            <p>{locationName(place) || 'No location recorded.'}</p>
            {place.latitude !== null && place.longitude !== null && (
              <>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${place.latitude}&mlon=${place.longitude}#map=15/${place.latitude}/${place.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on OpenStreetMap ↗
                </a>
                <iframe
                  title={`Location of ${place.name}`}
                  loading="lazy"
                  className="map"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${place.longitude - 0.03}%2C${place.latitude - 0.02}%2C${place.longitude + 0.03}%2C${place.latitude + 0.02}&layer=mapnik&marker=${place.latitude}%2C${place.longitude}`}
                />
              </>
            )}
            {place.websiteUrl && (
              <p>
                <a href={place.websiteUrl} target="_blank" rel="noreferrer">
                  Official website ↗
                </a>
              </p>
            )}
          </section>
          {place.placeKind === 'experience' && (
            <section>
              <h2>Experience</h2>
              <dl>
                <dt>Operator</dt>
                <dd>{place.operator ?? 'Not recorded'}</dd>
                <dt>Meeting point</dt>
                <dd>{place.meetingPoint ?? 'Not recorded'}</dd>
                <dt>Duration</dt>
                <dd>
                  {place.durationMinutes
                    ? `${place.durationMinutes} minutes`
                    : 'Not recorded'}
                </dd>
              </dl>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
