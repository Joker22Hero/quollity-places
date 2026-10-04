import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Place } from '../shared/contracts';
import { eligibleForBoard } from '../shared/rankings';
import { put, schemas } from './api';
import {
  Action,
  Loading,
  MutationForm,
  nullableText,
  text,
  score,
} from './components';
import { useReferenceData, useResource } from './state';
type Entry = { place: Place; note: string | null };
export function BoardPage() {
  const { id } = useParams();
  const { session, refresh, types } = useReferenceData();
  const board = useResource(`/boards/${id}`, schemas.board);
  const directory = useResource(
    '/places?limit=500&sort=rating',
    schemas.directory,
  );
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState('');
  const [dragged, setDragged] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editDetails, setEditDetails] = useState(false);
  useEffect(() => {
    if (board.data) {
      setEntries(
        board.data.entries.map((entry) => ({
          place: entry.place,
          note: entry.note,
        })),
      );
      setDirty(false);
    }
  }, [board.data]);
  if (!board.data)
    return <Loading loading={board.loading} error={board.error} />;
  const data = board.data;
  const canEdit = !session.readOnly && !data.board.archivedAt;
  const eligible =
    directory.data?.places.filter(
      (place) =>
        eligibleForBoard(place, data.board) &&
        !entries.some((entry) => entry.place.id === place.id),
    ) ?? [];
  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= entries.length) return;
    setEntries((current) => {
      const next = [...current];
      const [entry] = next.splice(from, 1);
      next.splice(to, 0, entry);
      return next;
    });
    setDirty(true);
  }
  return (
    <>
      <Link className="back" to="/rankings">
        ← Rankings
      </Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">
            Ranked collection{data.board.archivedAt ? ' · Archived' : ''}
          </p>
          <h1>{data.board.name}</h1>
          <p className="intro">
            {types.find((type) => type.id === data.board.placeTypeFilter)
              ?.label ?? 'All types'}
            {data.board.countryFilter ? ` · ${data.board.countryFilter}` : ''}
            {data.board.regionFilter ? ` · ${data.board.regionFilter}` : ''}
          </p>
        </div>
        {!session.readOnly && (
          <Action
            run={async () => {
              await put(
                `/boards/${id}/archive`,
                { archived: !data.board.archivedAt },
                schemas.savedBoard,
              );
              refresh();
            }}
          >
            {data.board.archivedAt
              ? 'Restore collection'
              : 'Archive collection'}
          </Action>
        )}
      </header>
      {canEdit && (
        <button
          className="secondary"
          disabled={dirty}
          onClick={() => setEditDetails(!editDetails)}
        >
          Edit collection details
        </button>
      )}
      {canEdit && editDetails && (
        <MutationForm
          label="Save details"
          onCancel={() => setEditDetails(false)}
          onSave={async (form) => {
            await put(
              `/boards/${id}`,
              {
                name: text(form, 'name'),
                placeTypeFilter: nullableText(form, 'type'),
                countryFilter: nullableText(form, 'country'),
                regionFilter: nullableText(form, 'region'),
              },
              schemas.savedBoard,
            );
            setEditDetails(false);
            refresh();
          }}
        >
          <div className="form-grid">
            <label className="span-2">
              Name
              <input
                name="name"
                required
                maxLength={200}
                defaultValue={data.board.name}
              />
            </label>
            <label>
              Type filter
              <select
                name="type"
                defaultValue={data.board.placeTypeFilter ?? ''}
              >
                <option value="">Any type</option>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Country filter
              <input
                name="country"
                minLength={2}
                maxLength={2}
                defaultValue={data.board.countryFilter ?? ''}
              />
            </label>
            <label className="span-2">
              Region filter
              <input
                name="region"
                defaultValue={data.board.regionFilter ?? ''}
              />
            </label>
          </div>
        </MutationForm>
      )}
      {canEdit && (
        <>
          <div className="board-add">
            <label>
              Add a place
              <select
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">Choose a place…</option>
                {eligible.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name} · {score(place.averageRating)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!selected}
              onClick={() => {
                const place = eligible.find((place) => place.id === selected);
                if (place) {
                  setEntries([...entries, { place, note: null }]);
                  setDirty(true);
                  setSelected('');
                }
              }}
            >
              Add
            </button>
            <Action
              className="secondary"
              run={async () => {
                await put(
                  `/boards/${id}/entries`,
                  {
                    entries: entries.map((entry) => ({
                      placeId: entry.place.id,
                      note: entry.note,
                    })),
                  },
                  schemas.saved,
                );
                refresh();
              }}
            >
              Save order{dirty ? ' *' : ''}
            </Action>
          </div>
          <Loading loading={directory.loading} error={directory.error} />
          {directory.data && directory.data.stats.total > 500 && (
            <p className="muted">
              The picker currently shows the first 500 places by rating.
            </p>
          )}
          <p className="muted">
            Drag entries or use the move buttons. Save the order when you are
            finished.
          </p>
        </>
      )}
      <ol className="ranking-list">
        {entries.map((entry, index) => (
          <li
            key={entry.place.id}
            className={entry.place.archivedAt ? 'archived-entry' : ''}
            draggable={canEdit}
            onDragStart={() => setDragged(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragged !== null) move(dragged, index);
              setDragged(null);
            }}
            onDragEnd={() => setDragged(null)}
          >
            <span className="rank">{index + 1}</span>
            <div className="ranking-title">
              <Link to={`/place/${entry.place.id}`}>{entry.place.name}</Link>
              <span className="muted">
                {entry.place.typeLabel}
                {entry.place.archivedAt ? ' · Archived' : ''}
              </span>
              {canEdit ? (
                <input
                  aria-label={`Ranking note for ${entry.place.name}`}
                  placeholder="Add a ranking note"
                  value={entry.note ?? ''}
                  maxLength={2000}
                  onChange={(event) => {
                    const value = event.target.value;
                    setEntries((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, note: value || null } : item,
                      ),
                    );
                    setDirty(true);
                  }}
                />
              ) : (
                entry.note && <p>{entry.note}</p>
              )}
            </div>
            <span className="rating">{score(entry.place.averageRating)}</span>
            {canEdit && (
              <div className="actions">
                <button
                  className="icon-button"
                  aria-label={`Move ${entry.place.name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  className="icon-button"
                  aria-label={`Move ${entry.place.name} down`}
                  disabled={index === entries.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  ↓
                </button>
                <button
                  className="icon-button"
                  aria-label={`Remove ${entry.place.name}`}
                  onClick={() => {
                    setEntries(entries.filter((_, i) => i !== index));
                    setDirty(true);
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {!entries.length && (
        <div className="empty">
          <h2>A collection worth making</h2>
          <p>
            Add a shortlist of places and arrange them in your preferred order.
          </p>
        </div>
      )}
    </>
  );
}
