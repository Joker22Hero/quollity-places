import { z } from 'zod';

export const personSchema = z.object({
  id: z.uuid(),
  displayName: z.string().min(1),
  active: z.boolean(),
});
export const personInputSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  active: z.boolean().default(true),
});
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().default(null);
const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, 'Use a valid calendar date');
export const countryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/)
  .transform((value) => value.toUpperCase());
const placeFields = {
  name: z.string().trim().min(1).max(200),
  shortName: optionalText(100),
  placeTypeId: z.string().trim().min(1).max(100),
  placeKind: z.enum(['physical_place', 'experience']).default('physical_place'),
  wishlist: z.boolean().default(false),
  city: optionalText(200),
  region: optionalText(200),
  countryCode: countryCodeSchema.nullable().default(null),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  websiteUrl: z
    .url()
    .max(2000)
    .refine(
      (value) => ['https:', 'http:'].includes(new URL(value).protocol),
      'Use an HTTP or HTTPS website',
    )
    .nullable()
    .default(null),
  description: optionalText(10000),
  notes: optionalText(20000),
  operator: optionalText(200),
  meetingPoint: optionalText(500),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(10080)
    .nullable()
    .default(null),
};
export const placeInputSchema = z
  .object(placeFields)
  .superRefine((value, ctx) => {
    if ((value.latitude === null) !== (value.longitude === null))
      ctx.addIssue({
        code: 'custom',
        path: ['latitude'],
        message: 'Supply both coordinates or neither',
      });
    if (
      value.placeKind === 'physical_place' &&
      (value.operator || value.meetingPoint || value.durationMinutes)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['placeKind'],
        message: 'Experience metadata requires an experience',
      });
  });
export const placeSchema = z.object({
  ...placeFields,
  id: z.uuid(),
  revision: z.number().int().positive().default(1),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  typeLabel: z.string(),
  visitCount: z.number().int(),
  ratedVisitCount: z.number().int(),
  averageRating: z.number().nullable(),
  latestVisitDate: z.string().nullable(),
});
export const ratingSchema = z
  .number()
  .min(1)
  .max(5)
  .refine(
    (value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-8,
    'Use 0.1 rating steps',
  );
export const visitInputSchema = z
  .object({
    date: localDate,
    endDate: localDate.nullable().default(null),
    attendeeIds: z
      .array(z.uuid())
      .max(100)
      .refine(
        (values) => new Set(values).size === values.length,
        'Duplicate attendees',
      )
      .default([]),
    overallRating: ratingSchema.nullable().default(null),
    notes: optionalText(20000),
    wouldRevisit: z
      .enum(['definitely', 'maybe', 'probably_not'])
      .nullable()
      .default(null),
    tripId: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .refine((value) => !value.endDate || value.endDate >= value.date, {
    path: ['endDate'],
    message: 'End date must not precede the visit date',
  });
export const tripSchema = z.object({
  tripId: z.string().min(1),
  name: z.string(),
  country: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  canonicalUrl: z.string(),
  suggested: z.boolean(),
});
export const tripCatalogueSchema = z.object({
  trips: z.array(tripSchema).max(1000),
  canEdit: z.boolean(),
});
export const visitSchema = z.object({
  id: z.uuid(),
  placeId: z.uuid(),
  date: z.string(),
  endDate: z.string().nullable(),
  overallRating: z.number().nullable(),
  notes: z.string().nullable(),
  wouldRevisit: z.enum(['definitely', 'maybe', 'probably_not']).nullable(),
  tripId: z.string().nullable(),
  trip: tripSchema.nullable(),
  attendees: z.array(personSchema),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const typeSchema = z.object({
  id: z.string(),
  slug: z.string(),
  label: z.string(),
  parentTypeId: z.string().nullable(),
  sortOrder: z.number(),
});
export const boardInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  placeTypeFilter: z.string().min(1).max(100).nullable().default(null),
  countryFilter: countryCodeSchema.nullable().default(null),
  regionFilter: optionalText(200),
});
export const boardSchema = boardInputSchema.extend({
  id: z.uuid(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});
export const boardEntriesInputSchema = z
  .object({
    entries: z
      .array(z.object({ placeId: z.uuid(), note: optionalText(2000) }))
      .max(500),
  })
  .refine(
    (value) =>
      new Set(value.entries.map((entry) => entry.placeId)).size ===
      value.entries.length,
    'A place can appear only once',
  );
export const snapLinkInputSchema = z.object({
  snapId: z.string().trim().min(1).max(200),
  visitId: z.uuid().nullable().default(null),
  caption: optionalText(1000),
  isCover: z.boolean().default(false),
  sortOrder: z.number().int().nonnegative().default(0),
});
export const snapLinkSchema = snapLinkInputSchema.extend({
  id: z.uuid(),
  placeId: z.uuid(),
  canonicalUrl: z.string(),
});
export const sessionSchema = z.object({
  role: z.enum(['viewer', 'editor']),
  person: personSchema.nullable(),
  readOnly: z.boolean(),
});
export const archiveInputSchema = z.object({ archived: z.boolean() });
export type Place = z.infer<typeof placeSchema>;
export type PlaceInput = z.infer<typeof placeInputSchema>;
export type Visit = z.infer<typeof visitSchema>;
export type VisitInput = z.infer<typeof visitInputSchema>;
export type Person = z.infer<typeof personSchema>;
export type PlaceType = z.infer<typeof typeSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Trip = z.infer<typeof tripSchema>;
export type SnapLink = z.infer<typeof snapLinkSchema>;
export type Session = z.infer<typeof sessionSchema>;
export const placeDetailSchema = z.object({
  place: placeSchema,
  visits: z.array(visitSchema),
  snaps: z.array(snapLinkSchema),
  boards: z.array(
    boardSchema.extend({ rank: z.number(), note: z.string().nullable() }),
  ),
});
export type PlaceDetail = z.infer<typeof placeDetailSchema>;
export const boardDetailSchema = z.object({
  board: boardSchema,
  entries: z.array(
    z.object({
      place: placeSchema,
      rank: z.number(),
      note: z.string().nullable(),
    }),
  ),
});
export type BoardDetail = z.infer<typeof boardDetailSchema>;
