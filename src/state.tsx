import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { z } from 'zod';
import type { Person, PlaceType, Session, Trip } from '../shared/contracts';
import { request, schemas } from './api';

type ReferenceData = {
  session: Session;
  types: PlaceType[];
  people: Person[];
  trips: Trip[];
  tripsError: string | null;
  revision: number;
  refresh: () => void;
};
const DataContext = createContext<ReferenceData | null>(null);
export function DataProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Omit<
    ReferenceData,
    'revision' | 'refresh'
  > | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    Promise.all([
      request('/session', schemas.session, options),
      request('/types', schemas.types, options),
      request('/people', schemas.people, options),
      request('/trips', schemas.trips, options)
        .then((result) => ({
          trips: result.trips,
          error: null as string | null,
        }))
        .catch((error) => ({
          trips: [] as Trip[],
          error: String(error instanceof Error ? error.message : error),
        })),
    ])
      .then(([session, types, people, trips]) => {
        if (!controller.signal.aborted) {
          setData({
            session,
            types: types.types,
            people: people.people,
            trips: trips.trips,
            tripsError: trips.error,
          });
          setError('');
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [revision]);
  if (error)
    return (
      <main className="narrow">
        <p className="eyebrow">Quollity Places</p>
        <h1>Unable to open Places</h1>
        <p role="alert">{error}</p>
        <button onClick={() => setRevision((value) => value + 1)}>
          Try again
        </button>
      </main>
    );
  if (!data)
    return (
      <main aria-busy="true">
        <p>Opening Places…</p>
      </main>
    );
  return (
    <DataContext.Provider
      value={{
        ...data,
        revision,
        refresh: () => setRevision((value) => value + 1),
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
export function useReferenceData() {
  const data = useContext(DataContext);
  if (!data) throw new Error('Missing data provider');
  return data;
}
export function useResource<T>(path: string, schema: z.ZodType<T>) {
  const { revision } = useReferenceData();
  const [state, setState] = useState<{
    data: T | null;
    error: string;
    loading: boolean;
  }>({ data: null, error: '', loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, error: '', loading: true });
    request(path, schema, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ data, error: '', loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ data: null, error: error.message, loading: false });
      });
    return () => controller.abort();
  }, [path, schema, revision]);
  return state;
}
