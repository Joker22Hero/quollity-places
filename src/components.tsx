import { Link } from 'react-router-dom';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { Place } from '../shared/contracts';

export const score = (value: number | null) =>
  value === null ? 'Unrated' : value.toFixed(1);
export const countryName = (code: string | null) =>
  code
    ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code)
    : '';
export const locationName = (place: Place) =>
  [place.city, place.region, countryName(place.countryCode)]
    .filter(Boolean)
    .join(', ');
export function Loading({
  loading,
  error,
}: {
  loading: boolean;
  error: string;
}) {
  return loading ? (
    <p aria-busy="true">Loading…</p>
  ) : error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}
export function PlaceCard({ place, rank }: { place: Place; rank?: number }) {
  return (
    <Link className="place-card" to={`/place/${place.id}`}>
      <div
        className={`card-art ${place.placeKind === 'experience' ? 'experience' : ''}`}
        aria-hidden="true"
      >
        <span>{place.typeLabel}</span>
        <strong>
          {place.shortName?.slice(0, 1) ?? place.name.slice(0, 1)}
        </strong>
      </div>
      <div className="card-body">
        <div className="card-line">
          <span className="eyebrow">
            {rank ? `#${rank} · ` : ''}
            {place.typeLabel}
          </span>
          <span className="rating">{score(place.averageRating)}</span>
        </div>
        <h2>{place.name}</h2>
        <p>{locationName(place) || 'Location to be added'}</p>
        <div className="card-meta">
          <span>
            {place.visitCount
              ? `${place.visitCount} visit${place.visitCount === 1 ? '' : 's'}`
              : 'Not visited yet'}
          </span>
          {place.wishlist && <span>Wishlist</span>}
          {place.archivedAt && <span>Archived</span>}
        </div>
      </div>
    </Link>
  );
}
export function MutationForm({
  onSave,
  children,
  label = 'Save',
  onCancel,
}: {
  onSave: (data: FormData) => Promise<void>;
  children: ReactNode;
  label?: string;
  onCancel?: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await onSave(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The change failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="editor">
      <fieldset disabled={busy}>{children}</fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button disabled={busy}>{busy ? 'Saving…' : label}</button>
        {onCancel && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
export function Action({
  run,
  children,
  className = 'secondary',
}: {
  run: () => Promise<void>;
  children: ReactNode;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <span className="action-wrap">
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await run();
          } catch (error) {
            setError(
              error instanceof Error ? error.message : 'The change failed.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : children}
      </button>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </span>
  );
}
export const text = (data: FormData, key: string) =>
  String(data.get(key) ?? '').trim();
export const nullableText = (data: FormData, key: string) =>
  text(data, key) || null;
export const nullableNumber = (data: FormData, key: string) =>
  text(data, key) ? Number(text(data, key)) : null;
