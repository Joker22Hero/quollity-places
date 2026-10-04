import { Link, useSearchParams } from 'react-router-dom';
import { schemas } from './api';
import { countryName, Loading, PlaceCard } from './components';
import { useReferenceData, useResource } from './state';

export function Directory() {
  const { types, people, trips, session } = useReferenceData();
  const [params, setParams] = useSearchParams();
  const query = new URLSearchParams(params);
  query.set('limit', '60');
  const { data, error, loading } = useResource(
    `/places?${query}`,
    schemas.directory,
  );
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete('offset');
    setParams(next, { replace: true });
  }
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Your world, remembered</p>
          <h1>Places</h1>
          <p className="intro">
            The places you loved. The experiences that stayed with you.
          </p>
        </div>
        {!session.readOnly && (
          <Link className="button" to="/new">
            + Add place
          </Link>
        )}
      </header>
      {data && (
        <div className="stats">
          <div>
            <strong>{data.stats.visited}</strong>
            <span>places visited</span>
          </div>
          <div>
            <strong>{data.stats.countries}</strong>
            <span>countries</span>
          </div>
          <div>
            <strong>{data.stats.types}</strong>
            <span>types explored</span>
          </div>
        </div>
      )}
      <section className="filters" aria-label="Filter places">
        <label>
          Search
          <input
            type="search"
            placeholder="Name or city"
            value={params.get('q') ?? ''}
            onChange={(event) => filter('q', event.target.value)}
          />
        </label>
        <label>
          Type
          <select
            value={params.get('type') ?? ''}
            onChange={(event) => filter('type', event.target.value)}
          >
            <option value="">All types</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Country
          <input
            maxLength={2}
            placeholder="Country code"
            value={params.get('country') ?? ''}
            onChange={(event) =>
              filter('country', event.target.value.toUpperCase())
            }
          />
        </label>
        <label>
          Trip
          <select
            value={params.get('trip') ?? ''}
            onChange={(event) => filter('trip', event.target.value)}
          >
            <option value="">All trips</option>
            {trips.map((trip) => (
              <option key={trip.tripId} value={trip.tripId}>
                {trip.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Visited by
          <select
            value={params.get('attendee') ?? ''}
            onChange={(event) => filter('attendee', event.target.value)}
          >
            <option value="">Anyone</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year
          <input
            inputMode="numeric"
            maxLength={4}
            placeholder="Any year"
            value={params.get('year') ?? ''}
            onChange={(event) => filter('year', event.target.value)}
          />
        </label>
        <label>
          Minimum rating
          <select
            value={params.get('minRating') ?? ''}
            onChange={(event) => filter('minRating', event.target.value)}
          >
            <option value="">Any rating</option>
            {[1, 2, 3, 4, 4.5, 5].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Show
          <select
            value={params.get('wishlist') ?? ''}
            onChange={(event) => filter('wishlist', event.target.value)}
          >
            <option value="">All places</option>
            <option value="true">Wishlist</option>
            <option value="false">Outside wishlist</option>
          </select>
        </label>
        <label>
          Order
          <select
            value={params.get('sort') ?? 'name'}
            onChange={(event) => filter('sort', event.target.value)}
          >
            <option value="name">Name</option>
            <option value="rating">Top rated</option>
            <option value="recent">Recently visited</option>
          </select>
        </label>
        <label>
          Records
          <select
            value={params.get('archived') ?? 'false'}
            onChange={(event) => filter('archived', event.target.value)}
          >
            <option value="false">Active</option>
            <option value="true">Archived</option>
          </select>
        </label>
        <button className="secondary" onClick={() => setParams({})}>
          Reset filters
        </button>
      </section>
      <Loading loading={loading} error={error} />
      {data && (
        <>
          <div className="section-heading">
            <h2>
              {params.get('sort') === 'rating'
                ? 'Top rated'
                : params.get('sort') === 'recent'
                  ? 'Recently visited'
                  : 'Your directory'}
            </h2>
            <span>
              {data.stats.total} place{data.stats.total === 1 ? '' : 's'}
              {params.get('country')
                ? ` in ${countryName(params.get('country'))}`
                : ''}
            </span>
          </div>
          {data.places.length ? (
            <div className="cards">
              {data.places.map((place) => (
                <PlaceCard key={place.id} place={place} />
              ))}
            </div>
          ) : (
            <div className="empty">
              <h2>
                {params.size
                  ? 'No places match these filters'
                  : 'Start with somewhere memorable'}
              </h2>
              <p>
                {params.size
                  ? 'Adjust the filters to explore your directory.'
                  : 'Add a place, then record a visit. Your history and rankings will grow from there.'}
              </p>
              {!params.size && !session.readOnly && (
                <Link className="button" to="/new">
                  Add your first place
                </Link>
              )}
            </div>
          )}
          <div className="pagination">
            {data.offset > 0 && (
              <button
                className="secondary"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set('offset', String(Math.max(0, data.offset - 60)));
                  setParams(next);
                }}
              >
                Previous
              </button>
            )}
            {data.offset + data.limit < data.stats.total && (
              <button
                className="secondary"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set('offset', String(data.offset + 60));
                  setParams(next);
                }}
              >
                Next
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
