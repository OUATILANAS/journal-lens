import http from 'node:http';
import worker from '../worker/index.js';
import {api} from '../src/api.js';
import {publisherHTTP} from './publisher-http.mjs';
import {runCommand} from './journal-lens.mjs';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {fullCheck} from '../src/workflow.mjs';
import {checkRunner} from '../src/check-runner.mjs';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {join} from 'node:path';
const port=Number(process.env.PORT||4173);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be an integer from 1 to 65535.');
const allowedOrigins=new Set(['http://127.0.0.1:'+port,'http://localhost:'+port]);
const projectRoot=fileURLToPath(new URL('..',import.meta.url));
const skillPath=join(process.env.CODEX_HOME||join(homedir(),'.codex'),'skills','journal-lens','SKILL.md');
const stateFile=new URL('../.local/check-jobs.json',import.meta.url);
await mkdir(new URL('../.local/',import.meta.url),{recursive:true});
let snapshot=[];try{snapshot=JSON.parse(await readFile(stateFile,'utf8'));}catch{}
const jobs=new Map(snapshot);let saving=Promise.resolve();
function persist(){const content=JSON.stringify([...jobs]);saving=saving.then(async()=>{const tmp=new URL('../.local/check-jobs.tmp',import.meta.url);await writeFile(tmp,content);await rename(tmp,stateFile);}).catch(()=>console.error('Could not save automatic journal checks.'));}
const runner=checkRunner({jobs,check:fullCheck,call:runCommand,save:persist});
for(const [id,job]of jobs)if(['running','waiting','queued'].includes(job.status)){job.status='queued';runner.run(id);}

http.createServer(async(req,res)=>{
  try{
    if(!allowedOrigins.has('http://'+req.headers.host))throw Error('Invalid local host.');
    if(req.headers.origin&&!allowedOrigins.has(req.headers.origin))throw Error('Open this app directly in a local browser tab.');
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4e6)throw Error('Request exceeds 4 MB.');chunks.push(chunk);}
    const request=new Request('http://localhost:'+port+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    let response;
    const url=new URL(request.url);
    if(url.pathname==='/api/check/start'&&request.method==='POST'){
      const {input}=JSON.parse(await request.text());if(typeof input!=='string'||input.length>500)throw Error('Enter a journal name or URL.');
      const existing=[...jobs].find(([,job])=>job.input.trim().toLowerCase()===input.trim().toLowerCase()&&['running','waiting','queued'].includes(job.status));
      if(existing){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({id:existing[0]}));return;}
      const active=[...jobs.values()].filter(j=>['running','waiting','queued'].includes(j.status));if(active.length>=2)throw Error('Two checks are already running. Stop an existing check or resume it.');
      const id=crypto.randomUUID(),job={status:'queued',input,progress:[],created:Date.now()};jobs.set(id,job);
      runner.run(id);
      response=Response.json({id},{headers:{'Cache-Control':'no-store'}});
    }else if(['/api/check/stop','/api/check/resume'].includes(url.pathname)&&request.method==='POST'){
      const {id}=JSON.parse(await request.text());const ok=url.pathname.endsWith('/stop')?runner.cancel(id):runner.resume(id);response=Response.json({ok});
    }else if(url.pathname==='/api/check/status'){
      const job=jobs.get(url.searchParams.get('id'));response=job?Response.json(job,{headers:{'Cache-Control':'no-store'}}):Response.json({error:'Check expired. Start a new check.'},{status:404});
    }else if(url.pathname.startsWith('/api/')){
      try{response=Response.json(await api(request,{publisherFetch:publisherHTTP}),{headers:{'Cache-Control':'no-store'}});}catch(e){response=Response.json({error:e.message},{status:400});}
    }else{
      response=await worker.fetch(request);
      if(response.headers.get('content-type')?.includes('text/html')){
        const literal=value=>JSON.stringify(value).slice(1,-1).replace(/'/g,'\\u0027').replace(/</g,'\\u003c');
        const page=(await response.text()).replaceAll('__JOURNAL_LENS_ROOT__',literal(projectRoot)).replaceAll('__JOURNAL_LENS_SKILL_PATH__',literal(skillPath));
        response=new Response(page,{status:response.status,headers:response.headers});
      }
    }
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:e.message}));}
}).listen(port,'127.0.0.1',()=>console.log('Journal Lens: http://127.0.0.1:'+port+' · local publisher HTTP enabled'));
