// Disposable browser fixture: real Hono routes + migrated in-memory SQLite,
// actual React UI, and deterministic external providers. Never uses production.
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const port=Number(process.env.PLACE_PREVIEW_PORT??49321);
const vite=await createServer({configFile:false,base:'/',plugins:[react()],server:{middlewareMode:true,hmr:false},appType:'custom'});
const {app}=await vite.ssrLoadModule('/worker/index.ts');
const {database}=await vite.ssrLoadModule('/tests/sqlite.ts');
const {providerFixture}=await vite.ssrLoadModule('/tests/fixtures/place-providers.ts');
const db=database();
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(['api.geoapify.com','www.wikidata.org','commons.wikimedia.org'].includes(url.hostname)) return providerFixture(url);
  return originalFetch(input,options);
};
const environment={DB:db,AUTH_MODE:'local',LOCAL_IDENTITY:'michael',GEOAPIFY_API_KEY:'browser-fixture-only'};
const server=createHttpServer(async(req,res)=>{
  try {
    if(req.url.startsWith('/api/')) {
      const parts=[];for await (const part of req) parts.push(part);
      const body=Buffer.concat(parts);
      const request=new Request(`http://localhost:${port}${req.url}`,{method:req.method,headers:req.headers,...(body.length?{body}: {})});
      const response=await app.fetch(request,environment);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    vite.middlewares(req,res,async()=>{
      const page=await vite.transformIndexHtml(req.url,await readFile('index.html','utf8'));
      res.writeHead(200,{'Content-Type':'text/html'});res.end(page);
    });
  } catch(error) {console.error(error);res.writeHead(500);res.end('Fixture preview error');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Fixture preview: http://localhost:${port}/new`));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{server.close();await vite.close();db.sqlite.close();process.exit(0);});
