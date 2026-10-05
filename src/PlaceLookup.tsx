import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  lookupResponseSchema,
  type Candidate,
  type Lookup,
} from '../shared/place-entry';
import { request } from './api';
import { countryName } from './components';
export function Attribution({ candidate }: { candidate: Candidate }) {
  return (
    <small className="lookup-attribution">
      {candidate.source.attribution.map((source, index) => (
        <span key={source.url}>
          {index ? ' · ' : ''}
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.label}
          </a>
        </span>
      ))}
    </small>
  );
}
export function PlaceLookup({
  initialQuery = '',
  onSelect,
  onManual,
}: {
  initialQuery?: string;
  onSelect: (
    lookup: Lookup,
    candidate: Candidate,
    experience?: boolean,
  ) => void;
  onManual?: (query: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery),
    [country, setCountry] = useState('');
  const [result, setResult] = useState<Lookup | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError('');
    setBusy(false);
    if (query.trim().length < 3 || (country && !/^[A-Za-z]{2}$/.test(country)))
      return () => controller.abort();
    const timer = setTimeout(() => {
      setBusy(true);
      void request('/place-lookups', lookupResponseSchema, {
        method: 'POST',
        body: JSON.stringify({
          query,
          context: country ? { countryCode: country.toUpperCase() } : undefined,
        }),
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setResult(data);
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setError(error instanceof Error ? error.message : 'Lookup failed.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, country]);
  return (
    <section className="place-lookup" aria-label="Find a place">
      <div className="form-grid">
        <label className="span-2">
          Place name and location
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kew Gardens, London"
            maxLength={200}
            autoComplete="off"
          />
        </label>
        <label>
          Country filter (optional)
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            maxLength={2}
            placeholder="GB, JP, FR…"
          />
        </label>
      </div>
      <p role="status" aria-live="polite">
        {busy
          ? 'Finding places…'
          : error ||
            result?.warnings.join(' ') ||
            (result?.resolution === 'no_match'
              ? 'No external matches found. Try adding a city or country.'
              : '')}
      </p>
      {result && (
        <>
          {result.savedMatches.length > 0 && (
            <div>
              <h3>Already saved</h3>
              <ul className="lookup-results">
                {result.savedMatches.map((place) => (
                  <li key={place.id}>
                    <Link to={`/place/${place.id}`}>{place.name}</Link>
                    <span>
                      {[
                        place.city,
                        place.region,
                        countryName(place.countryCode),
                      ]
                        .filter(Boolean)
                        .join(', ')}
                      {place.archivedAt
                        ? ' · Archived — open to restore'
                        : ' · Open to add a visit'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.candidates.length > 0 && (
            <div>
              <h3>Search results</h3>
              <ul className="lookup-results">
                {result.candidates.map((candidate) => (
                  <li key={candidate.candidateId}>
                    <strong>{candidate.name}</strong>
                    <span>
                      {[
                        candidate.city,
                        candidate.region,
                        countryName(candidate.countryCode),
                      ]
                        .filter(Boolean)
                        .join(', ') || 'Location details unavailable'}
                      {candidate.kind === 'locality'
                        ? ' · Area, not an attraction'
                        : candidate.kind === 'address'
                          ? ' · Address'
                          : ''}
                    </span>
                    {candidate.duplicates.map((match) => (
                      <Link
                        key={match.place.id}
                        to={`/place/${match.place.id}`}
                      >
                        {match.reason === 'source_identity'
                          ? 'Already saved'
                          : 'Similar saved place'}
                        : {match.place.name}
                        {match.place.archivedAt ? ' (archived)' : ''}
                      </Link>
                    ))}
                    <div className="actions">
                      {candidate.kind !== 'locality' && (
                        <button
                          type="button"
                          onClick={() => onSelect(result, candidate)}
                        >
                          Select place
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => onSelect(result, candidate, true)}
                      >
                        Use location for an experience
                      </button>
                    </div>
                    <Attribution candidate={candidate} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {onManual && (
        <button
          type="button"
          className="secondary"
          onClick={() => onManual(query)}
        >
          Add without lookup
        </button>
      )}
    </section>
  );
}
