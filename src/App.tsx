import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { Directory } from './Directory';
import { PlacePage } from './PlacePage';
import { PlaceForm } from './PlaceForm';
import { Rankings } from './Rankings';
import { BoardPage } from './BoardPage';
import { People } from './People';
import { DataProvider, useReferenceData } from './state';
function Shell() {
  const { session } = useReferenceData();
  return (
    <>
      <nav className="main-nav" aria-label="Main navigation">
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
        <NavLink to="/" end>
          Places
        </NavLink>
        <NavLink to="/rankings">Rankings</NavLink>
        <NavLink to="/people">People</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Directory />} />
          <Route
            path="/new"
            element={
              session.readOnly ? (
                <p>An editor account is required to create places.</p>
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
