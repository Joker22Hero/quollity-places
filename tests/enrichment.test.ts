import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { database } from './sqlite';
import { app } from '../worker/index';
import { normaliseCandidate } from '../worker/geocoding';
import { candidateSchema, lookupResponseSchema } from '../shared/place-entry';
import { placeFactsSchema } from '../shared/place-facts';
import { enrichWikidata } from '../worker/wikimedia';
import { rawPlace, wikiEntity, providerFixture } from './fixtures/place-providers';
import { requiredAgentScope } from '../shared/agent-auth';
const person='0f780640-84b1-4aef-9374-823f600a4101';
let db:ReturnType<typeof database>;
const environment=()=>({DB:db,AUTH_MODE:'local',LOCAL_IDENTITY:'michael',GEOAPIFY_API_KEY:'fixture-only',ASSETS:{fetch:()=>new Response('asset')}});
beforeEach(()=>{db=database();vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>providerFixture(input));});
afterEach(()=>{db.sqlite.close();vi.restoreAllMocks();});
async function call(path:string,body?:unknown,method=body===undefined?'GET':'POST') {
  const response=await app.request(new Request('http://localhost/api'+path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:body===undefined?undefined:JSON.stringify(body)}),undefined,environment());
  return {status:response.status,data:await response.json()};
}
async function pick(raw:unknown=rawPlace) {
  const candidate=normaliseCandidate(raw)!,lookupId=crypto.randomUUID();
  db.sqlite.prepare('INSERT INTO place_lookups VALUES(?,?,?,?)').run(lookupId,'person:'+person,JSON.stringify([candidate]),Date.now()+1800000);
  return {lookupId,candidateId:candidate.candidateId};
}
describe('Selected-place enrichment',()=>{
  it('keeps autocomplete light, resolves only the selection, caches enrichment and returns an immutable snapshot',async()=>{
    const search=await call('/place-lookups',{query:'Example Garden'});
    expect(search.status).toBe(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const selection={lookupId:search.data.lookupId,candidateId:search.data.candidates[0].candidateId};
    const result=await call('/places/resolve',selection);
    expect(result.status).toBe(200);
    const resolved=lookupResponseSchema.parse(result.data);
    expect(resolved.lookupId).not.toBe(selection.lookupId);
    expect(resolved.candidates[0]).toMatchObject({description:'Botanical garden in London',facts:{streetAddress:'1 Garden Road',postcode:'TW9 3AB',phone:'+44 20 0000 0000'},enrichment:{status:'enriched'}});
    expect(resolved.candidates[0].externalIds.map(ref=>ref.provider)).toEqual(['wikidata','wikipedia']);
    const original=JSON.parse(db.sqlite.prepare('SELECT candidates FROM place_lookups WHERE id=?').get(selection.lookupId)!.candidates as string)[0];
    expect(original.description).toBeNull();
    const count=vi.mocked(fetch).mock.calls.length;
    await call('/places/resolve',selection);
    expect(fetch).toHaveBeenCalledTimes(count);
    const saved=await call('/places/import',{lookupId:resolved.lookupId,candidateId:resolved.candidates[0].candidateId});
    expect(saved.status).toBe(201);
    expect(saved.data.place.description).toBe('Botanical garden in London');
    const identities=db.sqlite.prepare("SELECT provider,provider_id FROM place_sources WHERE place_id=? ORDER BY provider").all(saved.data.place.id);
    expect(identities.map(ref=>ref.provider)).toEqual(['geoapify','wikidata','wikipedia']);
    const calls=vi.mocked(fetch).mock.calls.length;
    await call('/places/'+saved.data.place.id);
    expect(fetch).toHaveBeenCalledTimes(calls);
  });
  it('retains selection on timeouts or provider throttling and caches optional failure briefly',async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response('rate limited',{status:429}));
    const selected=await pick();
    const result=await call('/places/resolve',selected);
    expect(result.status).toBe(200);
    expect(result.data.candidates[0].enrichment.status).toBe('unavailable');
    expect(result.data.warnings).toHaveLength(1);
    const count=vi.mocked(fetch).mock.calls.length;
    await call('/places/resolve',selected);expect(fetch).toHaveBeenCalledTimes(count);
    const remaining=Number(db.sqlite.prepare('SELECT expires_at FROM place_enrichment_cache').get()!.expires_at)-Date.now();
    expect(remaining).toBeLessThanOrEqual(300000);
    expect((await call('/places/import',{lookupId:result.data.lookupId,candidateId:selected.candidateId})).status).toBe(201);
    expect((await call('/places',{name:'Manual offline',placeTypeId:'other'})).status).toBe(201);
  });
  it('enforces ownership, expiry and lookup limits for resolve',async()=>{
    const selected=await pick();
    db.sqlite.prepare('UPDATE place_lookups SET principal=?').run('another');
    expect((await call('/places/resolve',selected)).status).toBe(409);
    db.sqlite.prepare('UPDATE place_lookups SET principal=?,expires_at=0').run('person:'+person);
    expect((await call('/places/resolve',selected)).status).toBe(409);
    const valid=await pick();
    db.sqlite.prepare('INSERT INTO place_lookup_limits VALUES(?,?,30)').run('person:'+person,Math.floor(Date.now()/60000));
    expect((await call('/places/resolve',valid)).status).toBe(429);
    expect(requiredAgentScope('POST','/api/places/resolve')).toBe('places:lookup');
  });
  it('accepts historical snapshots with enrichment fields absent',()=>{
    const old=normaliseCandidate(rawPlace)!;
    const {facts,description,externalIds,enrichment,...snapshot}=old;
    expect(candidateSchema.parse(snapshot)).toMatchObject({description:null,facts:placeFactsSchema.parse({}),externalIds:[],enrichment:{status:'not_requested'}});
  });
});
describe('Stable identity and manual preservation',()=>{
  it('uses Wikidata identity despite changed Geoapify and OSM IDs and never silently applies review edits',async()=>{
    const first=await call('/places/import',await pick());
    const selected=await pick({...rawPlace,place_id:'new-id',datasource:{raw:{wikidata:'Q123',osm_type:'node',osm_id:765}}});
    const second=await call('/places/import',{...selected,notes:'New review edits'});
    expect(second.status).toBe(409);expect(second.data.code).toBe('place_exists');
    const existing=await call('/places/'+first.data.place.id);expect(existing.data.place.notes).toBeNull();
  });
  it('rejects conflicting stable IDs already belonging to separate records',async()=>{
    await call('/places/import',await pick());
    const second=await call('/places/import',await pick({...rawPlace,name:'Different Garden',place_id:'different',lat:52,datasource:{raw:{wikidata:'Q456',osm_type:'node',osm_id:456}}}));
    expect(second.status).toBe(201);
    const selected=await pick({...rawPlace,datasource:{raw:{wikidata:'Q456',osm_type:'way',osm_id:987}}});
    const result=await call('/places/import',selected);expect(result.status).toBe(409);expect(result.data.code).toBe('conflicting_sources');
  });
  it('does not warn about geographically distant same-name places in the same city',async()=>{
    await call('/places',{name:'Example Garden',placeTypeId:'botanic-garden',city:'London',countryCode:'GB',latitude:51.3,longitude:-0.1});
    const result=await call('/places/import',await pick());expect(result.status).toBe(201);
  });
  it('protects corrected description, name and factual metadata while updating untouched geography',async()=>{
    const resolved=await call('/places/resolve',await pick());
    const first=await call('/places/import',{lookupId:resolved.data.lookupId,candidateId:rawPlace.place_id,notes:'Personal notes'});
    const place=first.data.place;
    await call('/places/'+place.id+'/visits',{date:'2026-10-05',overallRating:4.2,notes:'Visit memory',attendeeIds:[person]});
    const edited=await call('/places/'+place.id,{...place,name:'My corrected name',description:null,facts:{...place.facts,phone:null}},'PUT');
    expect(edited.status).toBe(200);
    vi.mocked(fetch).mockImplementation(async input=>new URL(String(input)).hostname==='api.geoapify.com' ? Response.json({features:[{properties:{...rawPlace,state:'Greater London'}}]}) : providerFixture(input));
    const next=await pick({...rawPlace,state:'Greater London'});
    const enriched=await call('/places/resolve',next);
    const selection={lookupId:enriched.data.lookupId,candidateId:rawPlace.place_id};
    const preview=await call('/places/'+place.id+'/location-preview',selection);
    for(const field of ['name','description','facts']) expect(preview.data.changes.find((v:{field:string})=>v.field===field).protected).toBe(true);
    const saved=await call('/places/'+place.id+'/location',{...selection,revision:preview.data.revision,fields:['region']},'PATCH');
    expect(saved.status).toBe(200);expect(saved.data.place.region).toBe('Greater London');
    const details=await call('/places/'+place.id);
    expect(details.data.place).toMatchObject({name:'My corrected name',description:null,notes:'Personal notes',facts:{phone:null}});
    expect(details.data.visits[0]).toMatchObject({overallRating:4.2,notes:'Visit memory'});
    const accepted=await call('/places/'+place.id+'/location',{...selection,revision:saved.data.place.revision,fields:['description','facts']},'PATCH');
    expect(accepted.status).toBe(200);expect(accepted.data.place.description).toBe('Botanical garden in London');expect(accepted.data.place.facts.phone).toBe('+44 20 0000 0000');
  });
});
describe('Wikidata safety and reference imagery',()=>{
  it('rejects a distant explicit Wikidata entity',async()=>{
    vi.mocked(fetch).mockResolvedValue(Response.json({entities:{Q123:{...wikiEntity,claims:{P625:[{mainsnak:{snaktype:'value',datavalue:{value:{latitude:-33,longitude:18,globe:'http://www.wikidata.org/entity/Q2'}}}}]}}}}));
    const result=await enrichWikidata(normaliseCandidate(rawPlace)!,AbortSignal.timeout(1000));
    expect(result.externalIds).toHaveLength(0);expect(result.description).toBeNull();
  });
  it('only uses explicit place IDs and ignores brand/operator IDs',()=>{
    const candidate=normaliseCandidate({...rawPlace,datasource:{raw:{'brand:wikidata':'Q123','operator:wikidata':'Q456',wikidata:'invalid'}}})!;
    expect(candidate.externalIds).toHaveLength(0);
  });
  it('stores only safe licensed Commons reference metadata and omits unsafe websites',async()=>{
    vi.mocked(fetch).mockImplementation(async input=>new URL(String(input)).hostname==='www.wikidata.org'
      ? Response.json({entities:{Q123:{...wikiEntity,claims:{...wikiEntity.claims,P18:[{mainsnak:{snaktype:'value',datavalue:{value:'Garden.jpg'}}}],P856:[{rank:'deprecated',mainsnak:{snaktype:'value',datavalue:{value:'https://deprecated.example'}}},{mainsnak:{snaktype:'value',datavalue:{value:'javascript:alert(1)'}}}]}}}})
      : Response.json({query:{pages:{'1':{imageinfo:[{descriptionurl:'https://commons.wikimedia.org/wiki/File:Garden.jpg',thumburl:'https://upload.wikimedia.org/example.jpg',extmetadata:{Artist:{value:'<b>Test photographer</b>'},LicenseShortName:{value:'CC BY-SA 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'}}}]}}}}));
    const candidate=normaliseCandidate({...rawPlace,datasource:{raw:{wikidata:'Q123'}}})!;
    const result=await enrichWikidata(candidate,AbortSignal.timeout(1000));
    expect(result.websiteUrl).toBeNull();expect(result.facts.referenceImage).toMatchObject({creator:'Test photographer',license:'CC BY-SA 4.0'});
    expect(result.source.attribution.some(v=>v.label.includes('Test photographer'))).toBe(true);
  });
  it('does not include an image without creator and licence metadata',async()=>{
    vi.mocked(fetch).mockImplementation(async input=>new URL(String(input)).hostname==='www.wikidata.org'
      ? Response.json({entities:{Q123:{...wikiEntity,claims:{P18:[{mainsnak:{snaktype:'value',datavalue:{value:'Garden.jpg'}}}]}}}})
      : Response.json({query:{pages:{'1':{imageinfo:[{descriptionurl:'https://commons.wikimedia.org/wiki/File:Garden.jpg',thumburl:'https://upload.wikimedia.org/example.jpg',extmetadata:{}}]}}}}));
    const result=await enrichWikidata(normaliseCandidate(rawPlace)!,AbortSignal.timeout(1000));expect(result.facts.referenceImage).toBeNull();
  });
});
