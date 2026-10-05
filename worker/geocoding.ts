import { z } from 'zod';
import { suggestedType } from './place-taxonomy';
import { httpUrlSchema, placeFactsSchema } from '../shared/place-facts';
import {
  candidateSchema,
  lookupInputSchema,
  type Candidate,
} from '../shared/place-entry';
import { boundedBytes } from '../shared/agent-auth';
export const sourceAttribution = [
  { label: 'Geoapify', url: 'https://www.geoapify.com/' },
  {
    label: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
  },
];
const propertiesSchema = z
  .object({
    place_id: z.string().min(1).max(200),
    name: z.string().optional(),
    address_line1: z.string().optional(),
    formatted: z.string().optional(),
    city: z.string().optional(),
    town: z.string().optional(),
    village: z.string().optional(),
    state: z.string().optional(),
    region: z.string().optional(),
    county: z.string().optional(),
    country: z.string().optional(),
    country_code: z.string().optional(),
    state_code: z.string().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    result_type: z.string().optional(),
    categories: z.array(z.string()).optional(),
    website: z.string().optional(),
    datasource: z
      .object({ raw: z.record(z.string(), z.unknown()).optional() })
      .optional(),
  })
  .passthrough();
export { suggestedType } from './place-taxonomy';
export function normaliseCandidate(value: unknown): Candidate | null {
  const parsed = propertiesSchema.safeParse(value);
  if (!parsed.success) return null;
  const p = parsed.data,
    raw = p.datasource?.raw ?? {};
  const type = p.result_type;
  const kind =
    type &&
    [
      'city',
      'county',
      'state',
      'country',
      'suburb',
      'district',
      'postcode',
      'street',
    ].includes(type)
      ? 'locality'
      : type === 'building' && !p.name
        ? 'address'
        : 'place';
  const hasCoords = p.lat !== undefined && p.lon !== undefined;
  const website =
    p.website ?? (typeof raw.website === 'string' ? raw.website : null);
  const validWebsite =
    website &&
    /^https?:\/\//.test(website) &&
    z.url().safeParse(website).success &&
    website.length <= 2000
      ? website
      : null;
  const rawOsmType = String(raw.osm_type ?? '');
  const osmType =
    ({ n: 'node', w: 'way', r: 'relation' } as Record<string, string>)[
      rawOsmType
    ] ?? rawOsmType;
  const osmId =
    (typeof raw.osm_id === 'string' || typeof raw.osm_id === 'number') &&
    /^\d+$/.test(String(raw.osm_id))
      ? String(raw.osm_id)
      : null;
  const result = candidateSchema.safeParse({
    candidateId: p.place_id,
    name: (p.name ?? p.address_line1 ?? p.formatted ?? '').slice(0, 200),
    city: p.city ?? p.town ?? p.village ?? null,
    region: p.state ?? p.region ?? null,
    countryCode:
      p.country_code && /^[a-z]{2}$/i.test(p.country_code)
        ? p.country_code.toUpperCase()
        : null,
    latitude: kind === 'locality' ? null : hasCoords ? p.lat : null,
    longitude: kind === 'locality' ? null : hasCoords ? p.lon : null,
    websiteUrl: validWebsite,
    facts: placeFactsSchema.parse({
      localName: typeof raw['name:local'] === 'string' ? raw['name:local'].slice(0,200) : null,
      alternateNames: typeof raw.alt_name === 'string' ? raw.alt_name.split(';').map(s=>s.trim().slice(0,200)).filter(Boolean).slice(0,30) : [],
      streetAddress: typeof p.address_line2 === 'string' ? p.address_line2.slice(0,500) : typeof raw['addr:street'] === 'string' ? [raw['addr:housenumber'], raw['addr:street']].filter(Boolean).join(' ').slice(0,500) : null,
      postcode: typeof p.postcode === 'string' ? p.postcode.slice(0,40) : null,
      phone: typeof raw.phone === 'string' ? raw.phone.slice(0,100) : null,
      socialLinks: ['facebook','instagram','twitter'].flatMap(k => typeof raw[k] === 'string' && httpUrlSchema.safeParse(raw[k]).success ? [raw[k]] : []),
    }),
    externalIds: typeof raw.wikidata === 'string' && /^Q[1-9]\d*$/.test(raw.wikidata)
      ? [{provider:'wikidata', id:raw.wikidata, url:`https://www.wikidata.org/wiki/${raw.wikidata}`, confidence:1}] : [],
    suggestedTypeId: suggestedType(p.categories ?? [], raw),
    precision:
      kind === 'locality'
        ? 'approximate'
        : kind === 'address'
          ? 'address'
          : 'place',
    kind,
    hierarchy: [
      ...(['country', 'state', 'region', 'county', 'city'] as const)
        .filter((k) => p[k])
        .map((k) => ({
          level: k,
          name: p[k],
          ...(k === 'state' && p.state_code ? { code: p.state_code } : {}),
        })),
    ],
    source: {
      provider: 'geoapify',
      providerId: p.place_id,
      osmType: ['node', 'way', 'relation'].includes(osmType) ? osmType : null,
      osmId,
      fetchedAt: new Date().toISOString(),
      attribution: sourceAttribution,
    },
  });
  return result.success && result.data.name ? result.data : null;
}
async function providerJson(
  url: URL,
  key: string,
  signal: AbortSignal,
): Promise<unknown> {
  // GET geocoding/details require apiKey in the documented provider contract.
  // This URL is server-only and never included in responses or error logs.
  const target = new URL(url);
  target.searchParams.set('apiKey', key);
  const response = await fetch(target, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Lookup unavailable');
  }
  const bytes = await boundedBytes({ body: response.body }, 1048576);
  return JSON.parse(new TextDecoder().decode(bytes));
}
function propertiesFromResponse(value: unknown) {
  const parsed = z
    .object({
      results: z.array(z.unknown()).optional(),
      features: z.array(z.object({ properties: z.unknown() })).optional(),
    })
    .parse(value);
  return parsed.results ?? parsed.features?.map((f) => f.properties) ?? [];
}
export async function lookupProvider(
  input: z.output<typeof lookupInputSchema>,
  key: string,
): Promise<Candidate[]> {
  const signal = AbortSignal.timeout(5000);
  const url = new URL('https://api.geoapify.com/v1/geocode/search');
  url.searchParams.set(
    'text',
    [input.query, input.context?.city].filter(Boolean).join(', '),
  );
  url.searchParams.set('format', 'json');
  url.searchParams.set('lang', 'en');
  url.searchParams.set('limit', String(input.limit));
  if (input.context?.countryCode)
    url.searchParams.set(
      'filter',
      `countrycode:${input.context.countryCode.toLowerCase()}`,
    );
  const proximity = input.context?.proximity;
  if (proximity)
    url.searchParams.set(
      'bias',
      `proximity:${proximity.longitude},${proximity.latitude}`,
    );
  const raw = propertiesFromResponse(await providerJson(url, key, signal));
  const candidates = raw
    .map(normaliseCandidate)
    .filter((v): v is Candidate => v !== null);
  // Geocoding a named attraction can yield only a locality. When context supplies
  // a centre, supplement with named POIs; never import that locality's centroid.
  const local = raw
    .map((v) => propertiesSchema.safeParse(v))
    .find(
      (v) => v.success && v.data.lat !== undefined && v.data.lon !== undefined,
    );
  const centre =
    proximity ??
    (local?.success
      ? { latitude: local.data.lat!, longitude: local.data.lon! }
      : null);
  if (centre && !candidates.some((c) => c.kind === 'place')) {
    const places = new URL('https://api.geoapify.com/v2/places');
    places.searchParams.set('categories', 'tourism,leisure,entertainment');
    places.searchParams.set(
      'filter',
      `circle:${centre.longitude},${centre.latitude},50000`,
    );
    places.searchParams.set('name', input.query.split(',')[0].trim());
    places.searchParams.set('limit', String(input.limit));
    try {
      candidates.unshift(
        ...propertiesFromResponse(await providerJson(places, key, signal))
          .map(normaliseCandidate)
          .filter((v): v is Candidate => v !== null),
      );
    } catch {
      /* forward results remain useful */
    }
  }
  const unique = [
    ...new Map(candidates.map((c) => [c.candidateId, c])).values(),
  ]
    .filter(
      (candidate) =>
        !input.context?.countryCode ||
        candidate.countryCode === input.context.countryCode,
    )
    .slice(0, input.limit);
  return unique;
}
export async function enrichGeoapify(candidate: Candidate, key: string, signal: AbortSignal): Promise<Candidate> {
  if(candidate.kind !== 'place') return candidate;
  const details = new URL('https://api.geoapify.com/v2/place-details');
  details.searchParams.set('id',candidate.source.providerId);
  details.searchParams.set('features','details');
  const result = propertiesFromResponse(await providerJson(details,key,signal));
  const detail = result.find(v=>v && typeof v==='object') as Record<string,unknown> | undefined;
  if(!detail) return candidate;
  const enriched = normaliseCandidate({ ...candidateToProperties(candidate), ...detail, place_id:candidate.source.providerId });
  if(!enriched) return candidate;
  return { ...enriched,
    facts: { ...candidate.facts, ...Object.fromEntries(Object.entries(enriched.facts).filter(([,v])=> v !== null && (!Array.isArray(v) || v.length))) },
    externalIds: [...new Map([...candidate.externalIds,...enriched.externalIds].map(ref=>[ref.provider+':'+ref.id,ref])).values()],
    suggestedTypeId: enriched.suggestedTypeId==='other' ? candidate.suggestedTypeId : enriched.suggestedTypeId,
    source:{ ...enriched.source, osmType:enriched.source.osmType ?? candidate.source.osmType, osmId:enriched.source.osmId ?? candidate.source.osmId },
  };
}
function candidateToProperties(c:Candidate) {
 return {name:c.name,city:c.city ?? undefined,state:c.region ?? undefined,country_code:c.countryCode ?? undefined,lat:c.latitude ?? undefined,lon:c.longitude ?? undefined,website:c.websiteUrl ?? undefined,
 datasource:{raw:{osm_type:c.source.osmType,osm_id:c.source.osmId,wikidata:c.externalIds.find(ref=>ref.provider==='wikidata')?.id}}};
}
