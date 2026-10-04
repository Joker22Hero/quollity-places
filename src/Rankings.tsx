import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post, schemas } from './api';
import {
  Loading,
  MutationForm,
  nullableText,
  PlaceCard,
  text,
} from './components';
import { useReferenceData, useResource } from './state';
export function Rankings() {
  const { types, session, refresh } = useReferenceData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [create, setCreate] = useState(false);
  const query = new URLSearchParams();
  for (const key of ['type', 'country', 'region'])
    if (params.get(key)) query.set(key, params.get(key)!);
  query.set('limit', '100');
  const ranking = useResource(`/places/rankings?${query}`, schemas.rankings);
  const boards = useResource(
    `/boards?archived=${params.get('archived') === 'true'}`,
    schemas.boards,
  );
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  }
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Favourites & highlights</p>
          <h1>Rankings</h1>
          <p className="intro">
            Follow your ratings, or put your favourites in your own order.
          </p>
        </div>
        {!session.readOnly && (
          <button onClick={() => setCreate(!create)}>
            + Create collection
          </button>
        )}
      </header>
      {create && (
        <section>
          <h2>New ranked collection</h2>
          <MutationForm
            label="Create collection"
            onCancel={() => setCreate(false)}
            onSave={async (data) => {
              const result = await post(
                '/boards',
                {
                  name: text(data, 'name'),
                  placeTypeFilter: nullableText(data, 'type'),
                  countryFilter: nullableText(data, 'country'),
                  regionFilter: nullableText(data, 'region'),
                },
                schemas.savedBoard,
              );
              refresh();
              navigate(`/boards/${result.board.id}`);
            }}
          >
            <div className="form-grid">
              <label className="span-2">
                Name
                <input
                  name="name"
                  required
                  maxLength={200}
                  placeholder="Favourite gardens, best interiors…"
                />
              </label>
              <label>
                Type filter
                <select name="type">
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
                  maxLength={2}
                  minLength={2}
                  placeholder="Any country"
                />
              </label>
              <label className="span-2">
                Region filter
                <input name="region" maxLength={200} placeholder="Any region" />
              </label>
            </div>
          </MutationForm>
        </section>
      )}
      <section>
        <div className="section-heading">
          <h2>Your collections</h2>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={params.get('archived') === 'true'}
              onChange={(event) =>
                filter('archived', event.target.checked ? 'true' : '')
              }
            />
            Archived collections
          </label>
        </div>
        <Loading loading={boards.loading} error={boards.error} />
        {boards.data?.boards.length ? (
          <div className="board-grid">
            {boards.data.boards.map((board) => (
              <Link
                className="board-card"
                to={`/boards/${board.id}`}
                key={board.id}
              >
                <span className="eyebrow">
                  {board.archivedAt ? 'Archived' : 'Personal ranking'}
                </span>
                <h3>{board.name}</h3>
                <p>
                  {types.find((type) => type.id === board.placeTypeFilter)
                    ?.label ?? 'All types'}
                  {board.countryFilter ? ` · ${board.countryFilter}` : ''}
                  {board.regionFilter ? ` · ${board.regionFilter}` : ''}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          !boards.loading && (
            <p className="muted">
              Create a collection for favourite places, architecture, gardens,
              viewpoints, or any other highlight.
            </p>
          )
        )}
      </section>
      <section>
        <div className="section-heading">
          <h2>By average rating</h2>
          <span>Equal scores share a rank</span>
        </div>
        <div className="filters">
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
              placeholder="Any country"
              value={params.get('country') ?? ''}
              onChange={(event) =>
                filter('country', event.target.value.toUpperCase())
              }
            />
          </label>
          <label>
            Region
            <input
              value={params.get('region') ?? ''}
              onChange={(event) => filter('region', event.target.value)}
              placeholder="Any region"
            />
          </label>
        </div>
        <Loading loading={ranking.loading} error={ranking.error} />
        {ranking.data &&
          (ranking.data.rankings.length ? (
            <div className="cards">
              {ranking.data.rankings.map((entry) => (
                <PlaceCard
                  place={entry.place}
                  rank={entry.rank}
                  key={entry.place.id}
                />
              ))}
            </div>
          ) : (
            <p className="muted">
              Rated visits will create your automatic rankings.
            </p>
          ))}
      </section>
    </>
  );
}
