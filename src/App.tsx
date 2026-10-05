import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { Directory } from './Directory';
import { PlacePage } from './PlacePage';
import { PlaceForm } from './PlaceForm';
import { Rankings } from './Rankings';
import { BoardPage } from './BoardPage';
import { People } from './People';
import { DataProvider, useReferenceData } from './state';
export function Shell() {
  const { session } = useReferenceData();
  return (
    <>
      <a className="skip-link" href="#places-content">
        Skip to Places
      </a>
      <header className="places-header">
        <nav className="main-nav" aria-label="Quollity navigation">
          <a className="brand" href="/">
            Quollity
          </a>
          <a className="sibling" href="/zoos/">
            Zoos
          </a>
          <a className="sibling" href="/trips/">
            Trips
          </a>
          <span className="nav-spacer" />
          <a
            className="account-link"
            href="/#account"
            aria-label={
              session.readOnly
                ? 'Read-only · Quollity account'
                : `Signed in as ${session.person?.displayName ?? 'editor'} · Quollity account`
            }
          >
            <span>
              {session.readOnly
                ? 'Read-only'
                : `${session.person?.displayName ?? 'Editor'} · Editor`}
            </span>
            <span className="account-link-label">
              Account <span aria-hidden="true">↗</span>
            </span>
          </a>
        </nav>
        <nav className="product-nav" aria-label="Places navigation">
          <NavLink to="/" end>
            Places
          </NavLink>
          <NavLink to="/rankings">Rankings</NavLink>
          <NavLink to="/people">People</NavLink>
        </nav>
      </header>
      <main id="places-content" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Directory />} />
          <Route
            path="/new"
            element={
              session.readOnly ? (
                <div className="narrow editor-boundary">
                  <p className="eyebrow">Shared archive · Read-only</p>
                  <h1>Editor access required</h1>
                  <p>An editor account is required to create places.</p>
                  <a className="button" href="/#account">
                    Open Quollity account
                  </a>
                </div>
              ) : (
                <>
                  <Link className="back" to="/">
                    ← Places
                  </Link>
                  <header className="page-heading">
                    <div>
                      <p className="eyebrow">A place to remember</p>
                      <h1>Add a place</h1>
                    </div>
                  </header>
                  <PlaceForm />
                </>
              )
            }
          />
          <Route path="/place/:id" element={<PlacePage />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/boards/:id" element={<BoardPage />} />
          <Route path="/people" element={<People />} />
          <Route
            path="*"
            element={
              <>
                <h1>Page not found</h1>
                <Link to="/">Return to Places</Link>
              </>
            }
          />
        </Routes>
      </main>
      <footer>
        <span>Quollity Places</span>
        <span>
          {session.readOnly ? 'Viewer' : session.person?.displayName} · A
          personal record of the world
        </span>
      </footer>
    </>
  );
}
export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <DataProvider>
        <Shell />
      </DataProvider>
    </BrowserRouter>
  );
}
