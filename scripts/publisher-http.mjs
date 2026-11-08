import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {safeURL} from '../src/api.js';

// Local-only HTTP transport. Redirects are still followed and validated by getPage.
// No browser credentials, JavaScript execution, CAPTCHA solving or challenge bypass.
export async function publisherHTTP(raw, options={}) {
  const url=new URL(raw);
  if(url.hostname==='idp.springer.com'){
    if(url.protocol!=='https:'||url.port||url.username||url.password||!['/authorize','/transit'].includes(url.pathname))throw Error('Invalid publisher session URL.');
  }else safeURL(raw);
  const directory=await mkdtemp(join(tmpdir(),'journal-lens-http-'));
  const headersPath=join(directory,'headers'),bodyPath=join(directory,'body');
  try{
    if(options.signal?.aborted)throw Error('Publisher request timed out.');
    const quote=s=>'"'+String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r|\n/g,'')+'"';
    const config=['url = '+quote(raw),'output = '+quote(bodyPath),'dump-header = '+quote(headersPath),...Object.entries(options.headers||{}).map(([k,v])=>'header = '+quote(k+': '+v))].join('\n')+'\n';
    await new Promise((resolve,reject)=>{
      const child=spawn('curl',['--disable','--config','-','--silent','--show-error','--compressed','--proto','=https','--max-time','20','--connect-timeout','10','--max-filesize','4000000'],{stdio:['pipe','ignore','pipe']});
      let error='';child.stderr.on('data',c=>{if(error.length<1000)error+=c.toString()});
      const abort=()=>child.kill();options.signal?.addEventListener('abort',abort,{once:true});
      child.once('error',reject);child.once('close',code=>{options.signal?.removeEventListener('abort',abort);if(options.signal?.aborted)reject(Error('Publisher request timed out.'));else if(code)reject(Error(code===63?'Publisher page exceeds the 4 MB limit.':'Local publisher connection failed. Please retry.'));else resolve();});
      child.stdin.on('error',()=>{});child.stdin.end(config);
    });
    const rawHeaders=await readFile(headersPath,'utf8');
    const block=rawHeaders.trim().split(/\r?\n\r?\n/).filter(b=>/^HTTP\//.test(b)).at(-1);
    if(!block)throw Error('Publisher returned invalid HTTP headers.');
    const [statusLine,...lines]=block.split(/\r?\n/);const status=+statusLine.split(' ')[1];const headers=new Headers();
    for(const line of lines){const at=line.indexOf(':');if(at>0)headers.append(line.slice(0,at),line.slice(at+1).trim());}
    const body=await readFile(bodyPath);if(body.length>4e6)throw Error('Publisher page exceeds the 4 MB limit.');
    headers.delete('content-encoding');headers.delete('content-length');
    return new Response([204,205,304].includes(status)?null:body,{status,headers});
  }finally{await rm(directory,{recursive:true,force:true});}
}
