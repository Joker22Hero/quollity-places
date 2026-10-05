import { z } from 'zod';
import {
  manualCreateSchema,
  lookupInputSchema,
  lookupResponseSchema,
  importInputSchema,
  importedPlaceSchema,
  selectionSchema,
  previewResponseSchema,
  applyLocationSchema,
  locationDetailSchema,
} from '../shared/place-entry';
import {
  visitInputSchema,
  placeSchema,
  visitSchema,
  sessionSchema,
  personSchema,
  typeSchema,
  tripSchema,
  placeDetailSchema,
} from '../shared/contracts';
function operation(
  summary: string,
  scope: string,
  input?: z.ZodType,
  output?: z.ZodType,
  create = false,
) {
  return {
    summary,
    description: `Requires ${scope}. Creates require Idempotency-Key. Lookup context.countryCode is a hard filter; proximity only biases ranking.`,
    security: [{ bearerAuth: [] }],
    parameters: create
      ? [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', maxLength: 100 },
          },
        ]
      : [],
    ...(input
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: z.toJSONSchema(input, { io: 'input' }),
              },
            },
          },
        }
      : {}),
    responses: {
      '200': {
        description: 'Success or exact reuse',
        ...(output
          ? {
              content: {
                'application/json': {
                  schema: z.toJSONSchema(output, { io: 'input' }),
                },
              },
            }
          : {}),
      },
      ...(create
        ? {
            '201': {
              description: 'Created',
              ...(output
                ? {
                    content: {
                      'application/json': {
                        schema: z.toJSONSchema(output, { io: 'input' }),
                      },
                    },
                  }
                : {}),
            },
          }
        : {}),
      '400': {
        description:
          'Invalid input; invalid_candidate, not_a_place, coordinate_pair, idempotency_required, invalid_idempotency_key',
      },
      '401': { description: 'Authentication required or invalid_delegation' },
      '403': { description: 'insufficient_scope or inactive_owner' },
      '409': {
        description:
          'lookup_expired, possible_duplicate (details contain matches and duplicateReviewToken), place_exists, place_archived, idempotency_conflict, stale_revision, incompatible_board',
      },
      '413': { description: 'Request exceeds 128 KiB' },
      '429': { description: 'rate_limited; retry after Retry-After seconds' },
      '503': { description: 'Integration unavailable' },
    },
  };
}
const savedPlace = z.object({ place: placeSchema }),
  savedVisit = z.object({ visit: visitSchema });
const uuidParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Quollity Places agent API',
    version: '1.0.0',
    description:
      'Lookup does not choose a destination or write a place. Select a candidate explicitly. Preserve one Idempotency-Key per save intent; reuse only for an identical retry. Bearer tokens are accepted by the public gateway.',
  },
  servers: [{ url: 'https://quollity.uk/places' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
  },
  paths: {
    '/api/session': {
      get: operation(
        'Current delegating editor',
        'places:read',
        undefined,
        sessionSchema,
      ),
    },
    '/api/types': {
      get: operation(
        'Place taxonomy',
        'places:read',
        undefined,
        z.object({ types: z.array(typeSchema) }),
      ),
    },
    '/api/people': {
      get: operation(
        'Attendees',
        'places:read',
        undefined,
        z.object({ people: z.array(personSchema) }),
      ),
    },
    '/api/trips': {
      get: operation(
        'Validated trip catalogue',
        'places:read',
        undefined,
        z.object({ trips: z.array(tripSchema) }),
      ),
    },
    '/api/place-lookups': {
      post: operation(
        'Search saved places and external candidates',
        'places:lookup',
        lookupInputSchema,
        lookupResponseSchema,
      ),
    },
    '/api/places/import': {
      post: operation(
        'Import a selected candidate',
        'places:create',
        importInputSchema,
        importedPlaceSchema,
        true,
      ),
    },
    '/api/places': {
      post: operation(
        'Create without lookup',
        'places:create',
        manualCreateSchema,
        savedPlace,
        true,
      ),
      get: {
        ...operation('Search saved directory', 'places:read'),
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'country', in: 'query', schema: { type: 'string' } },
          {
            name: 'archived',
            in: 'query',
            schema: { type: 'string', enum: ['true', 'false'] },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 500 },
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', minimum: 0 },
          },
        ],
      },
    },
    '/api/places/{id}': {
      parameters: [uuidParameter],
      get: operation(
        'Place detail',
        'places:read',
        undefined,
        placeDetailSchema.extend({ location: locationDetailSchema }),
      ),
    },
    '/api/places/{id}/visits': {
      parameters: [uuidParameter],
      post: operation(
        'Add a visit',
        'visits:create',
        visitInputSchema,
        savedVisit,
        true,
      ),
    },
    '/api/places/{id}/location-preview': {
      parameters: [uuidParameter],
      post: operation(
        'Preview selected location against current fields',
        'places:location:update',
        selectionSchema,
        previewResponseSchema,
      ),
    },
    '/api/places/{id}/location': {
      parameters: [uuidParameter],
      patch: operation(
        'Apply explicitly accepted fields with revision precondition',
        'places:location:update',
        applyLocationSchema,
        savedPlace,
      ),
    },
  },
};
