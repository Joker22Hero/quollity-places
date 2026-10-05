import { z } from 'zod';
import { countryCodeSchema, placeInputSchema, placeSchema } from './contracts';
import { externalIdSchema, httpUrlSchema, placeFactsSchema } from './place-facts';
export const locationFields = [
  'city',
  'region',
  'countryCode',
  'latitude',
  'longitude',
  'websiteUrl',
  'name',
  'description',
  'facts',
] as const;
export type LocationField = (typeof locationFields)[number];
export const attributionSchema = z.object({ label: z.string().max(1000), url: httpUrlSchema });
export const candidateSchema = z.object({
  candidateId: z.string(),
  name: z.string().trim().min(1).max(200),
  city: z.string().max(200).nullable(),
  region: z.string().max(200).nullable(),
  countryCode: countryCodeSchema.nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  websiteUrl: httpUrlSchema.nullable(),
  description: z.string().max(10000).nullable().default(null),
  facts: placeFactsSchema.default(() => placeFactsSchema.parse({})),
  externalIds: z.array(externalIdSchema).max(8).default([]),
  enrichment: z.object({
    status: z.enum(['not_requested', 'enriched', 'no_match', 'unavailable']),
    checkedAt: z.iso.datetime().nullable(),
  }).default({ status: 'not_requested', checkedAt: null }),
  suggestedTypeId: z.string(),
  precision: z.enum(['place', 'address', 'approximate']),
  kind: z.enum(['place', 'address', 'locality']),
  hierarchy: z.array(
    z.object({
      level: z.string(),
      name: z.string(),
      code: z.string().optional(),
    }),
  ),
  source: z.object({
    provider: z.literal('geoapify'),
    providerId: z.string(),
    osmType: z.string().nullable(),
    osmId: z.string().nullable(),
    fetchedAt: z.string(),
    attribution: z.array(attributionSchema),
  }),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const lookupInputSchema = z.strictObject({
  query: z.string().trim().min(3).max(200),
  limit: z.number().int().min(1).max(8).default(8),
  context: z
    .strictObject({
      countryCode: countryCodeSchema.optional(),
      city: z.string().trim().max(200).optional(),
      proximity: z
        .strictObject({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
        })
        .optional(),
    })
    .optional(),
});
export const duplicateSchema = z.object({
  place: placeSchema,
  reason: z.enum(['source_identity', 'name_location']),
});
export const lookupResponseSchema = z.object({
  lookupId: z.uuid(),
  expiresAt: z.string(),
  savedMatches: z.array(placeSchema),
  candidates: z.array(
    candidateSchema.extend({ duplicates: z.array(duplicateSchema) }),
  ),
  resolution: z.enum(['candidates', 'no_match', 'provider_unavailable']),
  warnings: z.array(z.string()),
});
export type Lookup = z.infer<typeof lookupResponseSchema>;
export const selectionSchema = z.strictObject({
  lookupId: z.uuid(),
  candidateId: z.string().min(1).max(200),
});
const overridesSchema = z
  .strictObject({
    name: placeInputSchema.shape.name,
    city: placeInputSchema.shape.city,
    region: placeInputSchema.shape.region,
    countryCode: placeInputSchema.shape.countryCode,
    latitude: placeInputSchema.shape.latitude,
    longitude: placeInputSchema.shape.longitude,
    websiteUrl: placeInputSchema.shape.websiteUrl,
    description: placeInputSchema.shape.description,
    facts: placeInputSchema.shape.facts,
  })
  .partial()
  .refine(
    (v) => (v.latitude === undefined) === (v.longitude === undefined),
    'Supply both coordinate overrides',
  );
export const importInputSchema = z.strictObject({
  lookupId: z.uuid(),
  candidateId: z.string().min(1).max(200),
  placeTypeId: z.string().min(1).max(100).optional(),
  placeKind: z.enum(['physical_place', 'experience']).default('physical_place'),
  wishlist: z.boolean().default(false),
  notes: z.string().trim().max(20000).nullable().default(null),
  shortName: z.string().trim().max(100).nullable().default(null),
  description: z.string().trim().max(10000).nullable().optional(),
  operator: z.string().trim().max(200).nullable().default(null),
  meetingPoint: z.string().trim().max(500).nullable().default(null),
  durationMinutes: z.number().int().min(1).max(10080).nullable().default(null),
  duplicateAction: z.enum(['reject', 'reuse_exact']).default('reject'),
  duplicateReviewToken: z.uuid().optional(),
  overrides: overridesSchema.default({}),
});
export const manualCreateSchema = placeInputSchema
  .safeExtend({ duplicateReviewToken: z.uuid().optional() })
  .strict();
export const importedPlaceSchema = z.object({
  outcome: z.enum(['created', 'existing']),
  place: placeSchema,
  warnings: z.array(z.string()),
});
export const sourceDetailSchema = z.object({
  id: z.uuid(),
  purpose: z.enum(['identity', 'location']),
  candidate: candidateSchema,
});
export const provenanceSchema = z.object({
  field: z.enum(locationFields),
  overridden: z.boolean(),
});
export const locationDetailSchema = z.object({
  sources: z.array(sourceDetailSchema),
  provenance: z.array(provenanceSchema),
});
export const previewResponseSchema = z.object({
  revision: z.number().int(),
  candidate: candidateSchema,
  changes: z.array(
    z.object({
      field: z.enum(locationFields),
      current: z.union([z.string(), z.number(), z.null(), placeFactsSchema]),
      proposed: z.union([z.string(), z.number(), z.null(), placeFactsSchema]),
      protected: z.boolean(),
    }),
  ),
});
export const applyLocationSchema = z.strictObject({
  lookupId: z.uuid(),
  candidateId: z.string().min(1).max(200),
  revision: z.number().int().positive(),
  fields: z
    .array(z.enum(locationFields))
    .min(1)
    .max(locationFields.length)
    .refine((v) => new Set(v).size === v.length, 'Duplicate fields'),
});
