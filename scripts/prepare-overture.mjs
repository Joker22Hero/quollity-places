import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function values(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === 'object')
    return Object.values(value).filter((item) => typeof item === 'string');
  if (value && typeof value==='object') return Object.values(value).flatMap(values);
  return [];
}
function url(value) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? value : null;
  } catch {
    return null;
  }
}
// Input must already be a tiny selected-area extract from the official client.
// This script never downloads the world, invokes a shell or queries a paid API.
export function normaliseOvertureGeoJSON(input, release, mapCategory) {
  if (
    !input ||
    input.type !== 'FeatureCollection' ||
    !Array.isArray(input.features) ||
    input.features.length > 1000
  )
    throw new Error(
      'Use a selected-area FeatureCollection with at most 1000 places',
    );
  return input.features.map((feature) => {
    const p = feature.properties;
    if (
      !p ||
      p.type !== 'place' ||
      p.theme !== 'places' ||
      feature.geometry?.type !== 'Point' ||
      feature.geometry.coordinates?.length !== 2
    )
      throw new Error('Only Overture Places point features are supported');
    const [longitude, latitude] = feature.geometry.coordinates;
    const addresses = p.addresses ?? [];
    const address = addresses[0] ?? {};
    const names = p.names ?? {};
    const aliases = [
      ...new Set([
        ...values(names.common),
        ...values(names.rules?.map?.((rule) => rule.value)),
      ]),
    ];
    const categories = [
      p.basic_category,
      p.taxonomy?.primary,
      ...values(p.taxonomy?.hierarchy),
      ...values(p.taxonomy?.alternates),
      p.categories?.primary,
      ...values(p.categories?.alternate),
    ];
    const sources = (p.sources ?? []).map((source) => ({
      label: source.dataset ?? source.provider,
      license:
        source.license ??
        {
          meta: 'CDLA-Permissive-2.0',
          microsoft: 'CDLA-Permissive-2.0',
          pinmeto: 'CDLA-Permissive-2.0',
          krick: 'CDLA-Permissive-2.0',
          renderseo: 'CDLA-Permissive-2.0',
          dac: 'CDLA-Permissive-2.0',
          brightquery: 'CDLA-Permissive-2.0',
          foursquare: 'Apache-2.0',
          alltheplaces: 'CC0-1.0',
        }[String(source.dataset).toLowerCase()],
      url: url(source.resource) ?? 'https://docs.overturemaps.org/attribution/',
    }));
    if (sources.some((source) => !source.license || !source.label))
      throw new Error(
        'Each source needs a known license and dataset; review licensing before importing',
      );
    const attribution = [
      { label: 'Overture Maps Foundation', url: 'https://overturemaps.org/' },
      ...sources.map((source) => ({
        label: `${source.label} (${source.license})`,
        url: source.url,
      })),
    ];
    if (sources.some((source) => /foursquare/i.test(source.label)))
      attribution.push({
        label: 'Copyright 2024 Foursquare Labs, Inc. All rights reserved.',
        url: 'https://docs.overturemaps.org/attribution/',
      });
    return {
      id: p.id ?? feature.id,
      name: names.primary,
      aliases,
      latitude,
      longitude,
      city: address.locality ?? null,
      region: address.region ?? null,
      countryCode: address.country ?? null,
      typeId: mapCategory(categories.filter(v=>typeof v==='string'), {}),
      websiteUrl: (p.websites ?? []).map(url).find(Boolean) ?? null,
      facts: {
        localName: names.primary ?? null,
        alternateNames: aliases,
        streetAddress: address.freeform ?? null,
        postcode: address.postcode ?? null,
        phone: p.phones?.[0] ?? null,
        socialLinks: (p.socials ?? []).map(url).filter(Boolean).slice(0, 10),
        operatingStatus: p.operating_status === 'closed' ? 'permanently_closed' : p.operating_status ?? null,
      },
      existenceConfidence: p.confidence ?? null,
      release,
      sources,
      attribution,
    };
  });
}
async function main() {
  const [
    inputPath,
    release,
    outputPath = 'data/overture-places.json',
    replace,
  ] = process.argv.slice(2);
  if (!inputPath || !release)
    throw new Error(
      'Usage: node scripts/prepare-overture.mjs selected-area.geojson RELEASE [output.json]\nFirst narrow the area: uvx overturemaps download --bbox=W,S,E,N -f geojson --type=place -o selected-area.geojson',
    );
  const size = (await stat(inputPath)).size;
  if (size > 5 * 1024 * 1024)
    throw new Error('Selected-area input must be at most 5 MiB');
  const content = await readFile(inputPath);
  if (content.byteLength > 5 * 1024 * 1024)
    throw new Error('Selected-area input must be at most 5 MiB');
  // Vite is already the project's build tool; use its TS loader to share runtime
  // validation instead of introducing another package or a duplicate schema.
  const { createServer } = await import('vite');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  });
  try {
    const { overtureCatalogSchema } = await server.ssrLoadModule(
      '/worker/overture.ts',
    );
    const {suggestedType}=await server.ssrLoadModule('/worker/place-taxonomy.ts');
    const records=normaliseOvertureGeoJSON(JSON.parse(content.toString('utf8')),release,suggestedType);
    const checked = overtureCatalogSchema.parse(records);
    if (replace && replace !== '--replace')
      throw new Error('The optional fourth argument must be --replace');
    await writeFile(outputPath, JSON.stringify(checked, null, 2) + '\n', {
      flag: replace ? 'w' : 'wx',
    });
    console.log(
      `Prepared ${checked.length} validated Overture places in ${outputPath}. Replace the existing catalog deliberately after review; no data was uploaded.`,
    );
  } finally {
    await server.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
