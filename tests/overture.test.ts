import { describe, expect, it } from 'vitest';
import { candidateSchema } from '../shared/place-entry';
import {
  overtureCatalogSchema,
  overtureRecordSchema,
  resolveOverture,
} from '../worker/overture';
import {
  normaliseOvertureGeoJSON as prepareOverture,
} from '../scripts/prepare-overture.mjs';

import { suggestedType } from '../worker/place-taxonomy';
const normaliseOvertureGeoJSON=(input:unknown,release:string)=>prepareOverture(input,release,suggestedType);
const mapOvertureCategory=(categories:string[])=>suggestedType(categories,{});

const candidate = candidateSchema.parse({
  candidateId: 'geo-kew',
  name: 'Kew Gardens',
  city: 'London',
  region: 'England',
  countryCode: 'GB',
  latitude: 51.478,
  longitude: -0.295,
  websiteUrl: null,
  suggestedTypeId: 'botanic-garden',
  precision: 'place',
  kind: 'place',
  hierarchy: [],
  source: {
    provider: 'geoapify',
    providerId: 'geo-kew',
    osmType: 'way',
    osmId: '123',
    fetchedAt: '2026-10-05T12:00:00.000Z',
    attribution: [{ label: 'Geoapify', url: 'https://www.geoapify.com/' }],
  },
});
function record(overrides = {}) {
  return overtureRecordSchema.parse({
    id: '99003ee6-e75b-4dd6-8a8a-53a5a716c50d',
    name: 'Royal Botanic Gardens, Kew',
    aliases: ['Kew Gardens'],
    latitude: 51.4781,
    longitude: -0.2951,
    city: 'London',
    region: 'England',
    countryCode: 'GB',
    typeId: 'botanic-garden',
    websiteUrl: 'https://www.kew.org/',
    release: '2026-09-23.1',
    existenceConfidence: 0.8,
    facts: { streetAddress: 'Kew, Richmond', postcode: 'TW9 3AE' },
    sources: [
      {
        label: 'Meta',
        license: 'CDLA-Permissive-2.0',
        url: 'https://docs.overturemaps.org/attribution/',
      },
    ],
    attribution: [
      { label: 'Overture Maps Foundation', url: 'https://overturemaps.org/' },
    ],
    ...overrides,
  });
}
function feature(overrides = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-0.295, 51.478] },
    properties: {
      id: record().id,
      type: 'place',
      theme: 'places',
      names: { primary: 'Kew Gardens' },
      basic_category: 'botanical_garden',
      addresses: [
        { locality: 'London', country: 'GB', freeform: 'Kew, Richmond' },
      ],
      sources: [{ dataset: 'meta' }],
      confidence: 0.8,
      brand: { wikidata: 'Q1' },
      ...overrides,
    },
  };
}
describe('bounded optional Overture resolution', () => {
  it('confident nearby alias match adds canonical facts and GERS without replacing Geoapify identity', () => {
    const result = resolveOverture(candidate, [record()]);
    expect(result.name).toBe('Royal Botanic Gardens, Kew');
    expect(result.facts.streetAddress).toBe('Kew, Richmond');
    expect(result.source.providerId).toBe('geo-kew');
    expect(result.source.osmId).toBe('123');
    expect(result.source.attribution).toHaveLength(2);
    expect(result.externalIds[0]).toMatchObject({
      provider: 'overture',
      id: record().id,
      confidence: 1,
      existenceConfidence: 0.8,
      sourceVersion: '2026-09-23.1',
      license: 'CDLA-Permissive-2.0',
    });
  });
  it('rejects distant same name, ambiguous matches, country, type and locality conflicts', () => {
    for (const records of [
      [record({ latitude: 52 })],
      [record(), record({ id: '11003ee6-e75b-4dd6-8a8a-53a5a716c50d' })],
      [record({ countryCode: 'FR' })],
      [record({ typeId: 'museum' })],
      [record({ city: 'Richmond' })],
    ])
      expect(resolveOverture(candidate, records)).toBe(candidate);
  });
  it('leaves unmatched, invalid, empty catalog and locality candidates untouched', () => {
    expect(resolveOverture(candidate)).toBe(candidate);
    expect(
      resolveOverture(candidate, [
        record({ name: 'Different Garden', aliases: [] }),
      ]),
    ).toBe(candidate);
    expect(resolveOverture(candidate, [{}])).toBe(candidate);
    const locality = {
      ...candidate,
      kind: 'locality' as const,
      latitude: null,
      longitude: null,
    };
    expect(resolveOverture(locality, [record()])).toBe(locality);
  });
  it('rejects address conflicts, unsafe URLs, duplicate IDs and unbounded catalogs', () => {
    const address = {
      ...candidate,
      facts: { ...candidate.facts, streetAddress: '123 Other Road' },
    };
    expect(resolveOverture(address, [record()])).toBe(address);
    expect(
      overtureRecordSchema.safeParse({
        ...record(),
        websiteUrl: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
    expect(overtureCatalogSchema.safeParse([record(), record()]).success).toBe(
      false,
    );
    expect(
      overtureCatalogSchema.safeParse(Array(1001).fill(record())).success,
    ).toBe(false);
  });
});
describe('selected-area Overture preparation', () => {
  it('supports current and legacy taxonomy and never uses brand Wikidata as place identity', () => {
    const current = normaliseOvertureGeoJSON(
      { type: 'FeatureCollection', features: [feature()] },
      '2026-09-23.1',
    );
    expect(overtureCatalogSchema.parse(current)[0].typeId).toBe(
      'botanic-garden',
    );
    expect(JSON.stringify(current)).not.toContain('Q1');
    const localized = normaliseOvertureGeoJSON(
      {
        type: 'FeatureCollection',
        features: [
          feature({
            names: {
              primary: 'Royal Botanic Gardens',
              common: { en: 'Kew Gardens' },
            },
          }),
        ],
      },
      '2026-09-23.1',
    );
    expect(localized[0].aliases).toContain('Kew Gardens');
    const legacy = normaliseOvertureGeoJSON(
      {
        type: 'FeatureCollection',
        features: [
          feature({
            basic_category: undefined,
            categories: { primary: 'art_museum' },
          }),
        ],
      },
      '2025-12-01.0',
    );
    expect(legacy[0].typeId).toBe('museum');
  });
  it('maps exact category tokens with deterministic generic/conflict fallback', () => {
    expect(mapOvertureCategory(['botanical_garden', 'garden'])).toBe(
      'botanic-garden',
    );
    expect(mapOvertureCategory(['cathedral'])).toBe('church');
    expect(mapOvertureCategory(['guided_tour_provider'])).toBe('tour');
    expect(mapOvertureCategory(['parking'])).toBe('other');
    expect(mapOvertureCategory(['religious_organization'])).toBe('other');
    expect(mapOvertureCategory(['museum', 'aquarium'])).toBe('other');
  });
  it('refuses global-sized extracts, non-place data and unlicensed sources', () => {
    expect(() =>
      normaliseOvertureGeoJSON(
        { type: 'FeatureCollection', features: Array(1001).fill(feature()) },
        'release',
      ),
    ).toThrow('at most 1000');
    expect(() =>
      normaliseOvertureGeoJSON(
        {
          type: 'FeatureCollection',
          features: [feature({ type: 'building' })],
        },
        'release',
      ),
    ).toThrow('Only Overture Places');
    expect(() =>
      normaliseOvertureGeoJSON(
        {
          type: 'FeatureCollection',
          features: [feature({ sources: [{ dataset: 'unverified' }] })],
        },
        'release',
      ),
    ).toThrow('known license');
  });
});
