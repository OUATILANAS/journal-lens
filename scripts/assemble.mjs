import {readFile,writeFile,mkdir} from 'node:fs/promises';
const api=await readFile('src/api.js','utf8');
const page=await readFile('src/ui.html','utf8');
await mkdir('worker',{recursive:true});
await writeFile('worker/index.js',api+'\nconst page='+JSON.stringify(page)+';\nexport default {async fetch(request){const url=new URL(request.url);if(url.pathname.startsWith("/api/")){try{return Response.json(await api(request),{headers:{"Cache-Control":"no-store"}})}catch(e){return Response.json({error:e.message},{status:400})}}if(url.pathname!=="/")return new Response("Not found",{status:404});return new Response(page,{headers:{"content-type":"text/html; charset=utf-8","X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin"}})}};\n');
