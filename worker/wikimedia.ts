import { z } from 'zod';
import { candidateSchema, type Candidate } from '../shared/place-entry';
import { httpUrlSchema, referenceImageSchema } from '../shared/place-facts';
import { boundedBytes } from '../shared/agent-auth';
import { distanceMetres } from './overture';

export async function externalJson(url: URL, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, redirect: 'error', headers: {
    Accept: 'application/json',
    'User-Agent': 'QuollityPlaces/1.0 (https://quollity.uk; optional place enrichment)',
  } });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('External enrichment unavailable');
  }
  return JSON.parse(new TextDecoder().decode(await boundedBytes({body:response.body},1048576)));
}
const claimSchema=z.object({
  rank:z.enum(['preferred','normal','deprecated']).optional(),
  mainsnak:z.object({snaktype:z.string(),datavalue:z.object({value:z.unknown()}).optional()}),
});
const entitySchema=z.object({
  id:z.string(),
  descriptions:z.record(z.string(),z.object({value:z.string()})).default({}),
  labels:z.record(z.string(),z.object({value:z.string()})).default({}),
  aliases:z.record(z.string(),z.array(z.object({value:z.string()}))).default({}),
  sitelinks:z.record(z.string(),z.object({title:z.string()})).default({}),
  claims:z.record(z.string(),z.array(claimSchema)).default({}),
});
const plain=(value:string,max:number)=>value.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim().slice(0,max);
const http=(value:unknown)=>httpUrlSchema.safeParse(value).success ? value as string : null;
function claimValues(entity:z.infer<typeof entitySchema>,property:string) {
  const statements=(entity.claims[property]??[]).filter(c=>c.rank!=='deprecated' && c.mainsnak.snaktype==='value');
  const preferred=statements.filter(c=>c.rank==='preferred');
  return (preferred.length ? preferred : statements).map(c=>c.mainsnak.datavalue?.value);
}
async function commonsImage(title:string,signal:AbortSignal) {
  const url=new URL('https://commons.wikimedia.org/w/api.php');
  url.search=new URLSearchParams({action:'query',format:'json',prop:'imageinfo',titles:'File:'+title,iiprop:'url|extmetadata',iiurlwidth:'640',iiextmetadatafilter:'LicenseShortName|LicenseUrl|Artist|Credit'}).toString();
  const result=z.object({query:z.object({pages:z.record(z.string(),z.object({imageinfo:z.array(z.object({descriptionurl:z.string(),thumburl:z.string().optional(),extmetadata:z.record(z.string(),z.object({value:z.string()}))})).optional()}))})}).parse(await externalJson(url,signal));
  const info=Object.values(result.query.pages).flatMap(p=>p.imageinfo??[])[0];
  if(!info?.thumburl) return null;
  const meta=info.extmetadata;
  const image=referenceImageSchema.safeParse({title:plain(title,300),sourceUrl:info.descriptionurl,thumbnailUrl:info.thumburl,
    creator:plain(meta.Artist?.value??meta.Credit?.value??'',1000),license:plain(meta.LicenseShortName?.value??'',200),licenseUrl:meta.LicenseUrl?.value});
  if(!image.success || !image.data.creator || !image.data.license || new URL(image.data.sourceUrl).hostname!=='commons.wikimedia.org' || new URL(image.data.thumbnailUrl).hostname!=='upload.wikimedia.org') return null;
  return image.data;
}
export async function enrichWikidata(candidate:Candidate,signal:AbortSignal):Promise<Candidate> {
  const ref=candidate.externalIds.find(ref=>ref.provider==='wikidata');
  if(!ref) return candidate;
  const result=z.object({entities:z.record(z.string(),z.unknown())}).parse(await externalJson(new URL(`https://www.wikidata.org/wiki/Special:EntityData/${ref.id}.json`),signal));
  const entity=entitySchema.parse(result.entities[ref.id]);
  if(entity.id!==ref.id) throw new Error('Unexpected external identity');
  const coordinates=claimValues(entity,'P625').map(v=>z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),globe:z.string()}).safeParse(v)).filter(v=>v.success && v.data.globe==='http://www.wikidata.org/entity/Q2');
  if(candidate.latitude!==null && candidate.longitude!==null && coordinates.length && !coordinates.some(v=>v.success && distanceMetres({latitude:candidate.latitude!,longitude:candidate.longitude!},v.data)<1500)) {
    // An explicit upstream tag can still be wrong. Do not bind a distant entity.
    return {...candidate,externalIds:candidate.externalIds.filter(r=>r.provider!=='wikidata')};
  }
  const title=entity.sitelinks.enwiki?.title;
  const wiki=title && title.length<=280 ? {provider:'wikipedia' as const,id:'en:'+title,url:'https://en.wikipedia.org/wiki/'+encodeURIComponent(title.replace(/ /g,'_')),confidence:1} : null;
  const imageTitle=claimValues(entity,'P18').find((v):v is string=>typeof v==='string' && v.length<=300);
  let image=null;
  if(imageTitle) {
    try { image=await commonsImage(imageTitle,signal); } catch { /* Optional imagery has independent licensing and availability. */ }
  }
  return candidateSchema.parse({ ...candidate,
    description:entity.descriptions.en?.value.slice(0,10000) ?? candidate.description,
    websiteUrl:candidate.websiteUrl ?? claimValues(entity,'P856').map(http).find(Boolean) ?? null,
    facts:{...candidate.facts,alternateNames:[...new Set([...candidate.facts.alternateNames,...(entity.aliases.en??[]).map(v=>v.value.trim().slice(0,200)).filter(Boolean)])].slice(0,30),referenceImage:image ?? candidate.facts.referenceImage},
    externalIds:[...candidate.externalIds.filter(ref=>ref.provider!=='wikipedia'),...(wiki?[wiki]:[])],
    source:{...candidate.source,attribution:[...candidate.source.attribution,{label:'Wikidata · CC0',url:'https://www.wikidata.org/wiki/'+ref.id},...(wiki?[{label:'Wikipedia reference',url:wiki.url}]:[]),...(image?[{label:`${image.creator} · ${image.license}`,url:image.sourceUrl}]:[])]},
  });
}
