export const rawPlace = {
  place_id:'fixture-garden',name:'Example Garden',city:'London',state:'England',country_code:'gb',lat:51.478,lon:-0.295,result_type:'amenity',categories:['leisure.park.garden.botanical'],
  address_line2:'1 Garden Road',postcode:'TW9 3AB',
  datasource:{raw:{osm_type:'way',osm_id:987,website:'https://example.org/garden',wikidata:'Q123',phone:'+44 20 0000 0000','name:local':'Example Botanical Garden',alt_name:'The Example Garden'}},
};
export const wikiEntity = {
  id:'Q123',labels:{en:{value:'Example Garden'}},descriptions:{en:{value:'Botanical garden in London'}},aliases:{en:[{value:'Example Botanic Garden'}]},sitelinks:{enwiki:{title:'Example Garden'}},
  claims:{P625:[{rank:'normal',mainsnak:{snaktype:'value',datavalue:{value:{latitude:51.478,longitude:-0.295,globe:'http://www.wikidata.org/entity/Q2'}}}}]},
};
export function providerFixture(input:RequestInfo|URL):Response {
  const url=new URL(String(input));
  if(url.hostname==='api.geoapify.com') return url.pathname.includes('place-details') ? Response.json({features:[{properties:rawPlace}]}) : Response.json({results:[rawPlace]});
  if(url.hostname==='www.wikidata.org') return Response.json({entities:{Q123:wikiEntity}});
  throw new Error('Unexpected fixture provider');
}
