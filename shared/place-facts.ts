import { z } from 'zod';

export const httpUrlSchema = z.url().max(2000).refine(
  (value) => { const url=new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; },
  'Use an HTTP or HTTPS URL',
);
const text = (max: number) => z.string().trim().max(max).nullable().default(null);
export const referenceImageSchema = z.object({
  title: z.string().max(300),
  sourceUrl: httpUrlSchema,
  thumbnailUrl: httpUrlSchema,
  creator: z.string().max(1000),
  license: z.string().max(200),
  licenseUrl: httpUrlSchema,
});
// Factual reference data stays separate from personal notes, ratings and Snaps.
export const placeFactsSchema = z.strictObject({
  localName: text(200),
  alternateNames: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  streetAddress: text(500),
  postcode: text(40),
  phone: text(100),
  socialLinks: z.array(httpUrlSchema).max(10).default([]),
  operatingStatus: z.enum(['open', 'temporarily_closed', 'permanently_closed']).nullable().default(null),
  referenceImage: referenceImageSchema.nullable().default(null),
});
export type PlaceFacts = z.infer<typeof placeFactsSchema>;

export const externalIdSchema = z.object({
  provider: z.enum(['overture', 'wikidata', 'wikipedia']),
  id: z.string().min(1).max(300),
  url: httpUrlSchema,
  confidence: z.number().min(0).max(1),
  sourceVersion: z.string().max(100).nullable().default(null),
  license: z.string().max(1000).nullable().default(null),
  existenceConfidence: z.number().min(0).max(1).nullable().default(null),
}).superRefine((value, ctx) => {
  const valid = value.provider === 'wikidata'
    ? /^Q[1-9]\d*$/.test(value.id) && value.url === `https://www.wikidata.org/wiki/${value.id}`
    : value.provider === 'overture'
      ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)
      : /^[a-z-]{2,15}:\S.{0,280}$/.test(value.id) && new URL(value.url).hostname.endsWith('.wikipedia.org');
  if (!valid) ctx.addIssue({code: 'custom', message: 'Invalid external identity'});
});
export type ExternalId = z.infer<typeof externalIdSchema>;
