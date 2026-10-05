import { describe, expect, it } from 'vitest';
import { suggestedType } from '../worker/place-taxonomy';

describe('Quollity external category mapping', () => {
  it.each([
    ['entertainment.museum', 'museum'],
    ['art_museum', 'museum'],
    ['history_museum', 'museum'],
    ['natural_history_museum', 'museum'],
    ['botanical_garden', 'botanic-garden'],
    ['leisure.park.garden.botanical', 'botanic-garden'],
    ['leisure.park', 'park-garden'],
    ['garden', 'park-garden'],
    ['art_gallery', 'art-gallery'],
    ['religion.place_of_worship.christianity.church', 'church'],
    ['cathedral', 'church'],
    ['shrine', 'temple'],
    ['temple', 'temple'],
    ['manor', 'historic-house'],
    ['historic_house', 'historic-house'],
    ['palace', 'castle'],
    ['national_monument', 'monument'],
    ['entertainment.aquarium', 'aquarium'],
    ['entertainment.theme_park', 'theme-park'],
    ['amusement_park', 'theme-park'],
    ['observation_deck', 'scenic-attraction'],
    ['archaeological_site', 'archaeological-site'],
    ['tour_provider', 'tour'],
    ['tour_operator', 'tour'],
    ['guided_tour', 'tour'],
    ['cruise', 'boat-trip'],
    ['cable_car', 'railway-cable-car'],
    ['restaurant', 'other'],
    ['religious_site', 'other'],
    ['parking', 'other'],
    ['museumshop', 'other'],
  ])('maps %s to %s', (category, expected) => {
    expect(suggestedType([category], {})).toBe(expected);
  });

  it('maps OSM tags and ignores untrusted non-string tag values', () => {
    expect(suggestedType([], { leisure: 'garden', garden: 'botanical' })).toBe(
      'botanic-garden',
    );
    expect(suggestedType([], { historic: 'manor' })).toBe('historic-house');
    expect(suggestedType([], { tourism: { toString: () => 'museum' } })).toBe(
      'other',
    );
    expect(suggestedType([], {})).toBe('other');
  });

  it('prefers a specific category over broad parent categories', () => {
    expect(suggestedType(['leisure.park', 'botanical_garden'], {})).toBe(
      'botanic-garden',
    );
    expect(suggestedType(['museum', 'art_gallery'], {})).toBe('other');
    expect(suggestedType(['museum', 'aquarium'], {})).toBe('other');
    expect(suggestedType(['religious_site', 'shrine'], {})).toBe('temple');
  });

  it('rejects conflicting specific categories regardless of order', () => {
    for (const categories of [
      ['botanical_garden', 'art_museum'],
      ['church', 'temple'],
      ['castle', 'aquarium'],
    ]) {
      expect(suggestedType(categories, {})).toBe('other');
      expect(suggestedType([...categories].reverse(), {})).toBe('other');
    }
    expect(suggestedType(['museum', 'garden'], {})).toBe('other');
  });

  it('accepts multiple categories mapping to the same Quollity type', () => {
    expect(suggestedType(['art_museum', 'history_museum'], {})).toBe('museum');
    expect(suggestedType(['church', 'cathedral'], {})).toBe('church');
  });
});
