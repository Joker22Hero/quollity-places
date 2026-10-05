import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { placeSchema } from '../shared/contracts';
import { Directory } from '../src/Directory';
import { PlacePage } from '../src/PlacePage';
import { BoardPage } from '../src/BoardPage';
import { PlaceForm } from '../src/PlaceForm';
import { Shell } from '../src/App';

const state = vi.hoisted(() => ({
  references: {} as Record<string, unknown>,
  resources: {} as Record<string, unknown>,
}));
vi.mock('../src/state', () => ({
  useReferenceData: () => state.references,
  useResource: (path: string) => ({
    data: state.resources[path],
    loading: false,
    error: '',
  }),
}));
const id = '9fe0d83b-3926-4d88-aa81-e0109ec7e001';
const boardId = '9fe0d83b-3926-4d88-aa81-e0109ec7e002';
const visitId = '9fe0d83b-3926-4d88-aa81-e0109ec7e003';
const person = {
  id: '0f780640-84b1-4aef-9374-823f600a4101',
  displayName: 'Michael',
  active: true,
};
const place = placeSchema.parse({
  id,
  name: 'Example Garden',
  placeTypeId: 'botanic-garden',
  typeLabel: 'Botanic garden',
  countryCode: 'GB',
  city: 'London',
  wishlist: true,
  notes: 'General <script>unsafe()</script> notes',
  archivedAt: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  visitCount: 2,
  ratedVisitCount: 2,
  averageRating: 4.5,
  latestVisitDate: '2026-05-01',
});
const board = {
  id: boardId,
  name: 'Favourite gardens',
  placeTypeFilter: 'botanic-garden',
  countryFilter: null,
  regionFilter: null,
  archivedAt: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  createdBy: person.id,
};
beforeEach(() => {
  state.references = {
    session: { role: 'editor', person, readOnly: false },
    types: [{ id: 'botanic-garden', label: 'Botanic garden' }],
    people: [person],
    trips: [],
    tripsError: null,
    refresh: () => {},
  };
  state.resources = {
    '/places?limit=60': {
      places: [place],
      stats: { total: 1, visited: 1, countries: 1, types: 1 },
      limit: 60,
      offset: 0,
    },
    [`/places/${id}`]: {
      place,
      boards: [],
      snaps: [],
      visits: [
        {
          id: visitId,
          placeId: id,
          date: '2026-05-01',
          endDate: null,
          overallRating: 5,
          notes: 'Visit-specific memory',
          wouldRevisit: 'definitely',
          trip: null,
          tripId: null,
          attendees: [person],
          archivedAt: null,
        },
      ],
    },
    [`/boards/${boardId}`]: {
      board,
      entries: [{ place, rank: 1, note: 'Personal preference' }],
    },
    '/places?limit=500&sort=rating': {
      places: [place],
      stats: { total: 1 },
      limit: 500,
      offset: 0,
    },
  };
});

describe('React page rendering', () => {
  it('routes viewer account and editor boundaries to the shared Gateway menu', () => {
    state.references.session = { role: 'viewer', person: null, readOnly: true };
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/new']}>
        <Shell />
      </MemoryRouter>,
    );
    expect(html).toContain('aria-label="Read-only · Quollity account"');
    expect(html.match(/href="\/#account"/g)).toHaveLength(2);
    expect(html).toContain('Open Quollity account');
    expect(html).toContain('Editor access required');
    expect(html).not.toContain('Place name and location');
    expect(html).not.toContain('href="/editor"');
    expect(html).toContain('href="#places-content"');
  });
  it('shows editor identity in the shared account link and retains creation controls', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>,
    );
    expect(html).toContain('Signed in as Michael · Quollity account');
    expect(html).toContain('Michael · Editor');
    expect(html).toContain('href="/#account"');
    expect(html).toContain('Add place');
    expect(html).toContain('aria-label="Places navigation"');
    expect(html).toContain('aria-label="Quollity Places home"');
    expect(html).toContain('Quollity Places</strong>');
    expect(html).toMatch(/src="[^"]*images\/quollityplaces-logo-128\.png"/);
    expect(html).not.toContain('aria-label="Quollity navigation"');
    expect(html).not.toContain('href="/zoos/"');
    expect(html).toContain('href="/rankings"');
    expect(html).toContain('href="/people"');
  });

  it('starts new-place entry with search and an accessible manual fallback', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PlaceForm />
      </MemoryRouter>,
    );
    expect(html).toContain('Place name and location');
    expect(html).toContain('Add without lookup');
    expect(html).not.toContain('name="latitude"');
    expect(html).not.toContain('name="longitude"');
  });
  it('shows a place once in the directory with average rating and wishlist', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Directory />
      </MemoryRouter>,
    );
    expect(html).toContain('Example Garden');
    expect(html).toContain('4.5');
    expect(html).toContain('2 visits');
    expect(html).toContain('Wishlist');
    expect(html.match(/class="place-card"/g)).toHaveLength(1);
  });
  it('separates visit scores and notes from the place average and escapes note text', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[`/place/${id}`]}>
        <Routes>
          <Route path="/place/:id" element={<PlacePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(html).toContain('Average of 2 rated visits');
    expect(html).toContain('5.0');
    expect(html).toContain('Visit-specific memory');
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).not.toContain('<script>unsafe()');
  });
  it('renders viewer collections without edit or ordering controls', () => {
    state.references.session = { role: 'viewer', person: null, readOnly: true };
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[`/boards/${boardId}`]}>
        <Routes>
          <Route path="/boards/:id" element={<BoardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(html).toContain('Favourite gardens');
    expect(html).not.toContain('Save order');
    expect(html).not.toContain('Archive collection');
    expect(html).not.toContain('Edit collection details');
  });
});
