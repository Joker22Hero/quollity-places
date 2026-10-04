import { z } from 'zod';
import {
  boardDetailSchema,
  boardSchema,
  personSchema,
  placeDetailSchema,
  placeSchema,
  sessionSchema,
  tripSchema,
  typeSchema,
  visitSchema,
} from '../shared/contracts';
const base = import.meta.env.BASE_URL;
export const apiPath = (path: string) => `${base}api${path}`;
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(apiPath(path), {
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
  const raw: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      z.object({ error: z.string() }).safeParse(raw).data?.error ??
        'The request failed.',
    );
  return schema.parse(raw);
}
export const schemas = {
  session: sessionSchema,
  types: z.object({ types: z.array(typeSchema) }),
  people: z.object({ people: z.array(personSchema) }),
  trips: z.object({ trips: z.array(tripSchema) }),
  directory: z.object({
    places: z.array(placeSchema),
    stats: z.object({
      total: z.number(),
      visited: z.number(),
      countries: z.number(),
      types: z.number(),
    }),
    limit: z.number(),
    offset: z.number(),
  }),
  place: placeDetailSchema,
  boards: z.object({ boards: z.array(boardSchema) }),
  board: boardDetailSchema,
  rankings: z.object({
    rankings: z.array(z.object({ rank: z.number(), place: placeSchema })),
  }),
  savedPlace: z.object({ place: placeSchema }),
  savedVisit: z.object({ visit: visitSchema }),
  savedBoard: z.object({ board: boardSchema }),
  savedPerson: z.object({ person: personSchema }),
  saved: z.object({ saved: z.boolean() }),
};
export const put = <T>(path: string, body: unknown, schema: z.ZodType<T>) =>
  request(path, schema, { method: 'PUT', body: JSON.stringify(body) });
export const post = <T>(path: string, body: unknown, schema: z.ZodType<T>) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });
