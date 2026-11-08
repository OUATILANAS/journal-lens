import {getPage,plain,metrics,safeURL} from '../src/api.js';
import {publisherHTTP} from './publisher-http.mjs';
import {readFile} from 'node:fs/promises';
const decode=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
export function parseSearchRSS(xml){return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m=>({title:plain(decode(m[1].match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'')),url:decode(m[1].match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]||'').trim()})).filter(x=>/^https:\/\//.test(x.url));}
export async function searchPublicWeb(query){
  const url='https://www.bing.com/search?'+new URLSearchParams({q:query,format:'rss',mkt:'en-US'});
  const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/rss+xml, application/xml'}});if(!r.ok)throw Error('Web search returned HTTP '+r.status);
  const body=await r.text();if(!/<rss\b/i.test(body))throw Error('Web search did not return a public results feed.');return parseSearchRSS(body);
}
export function sourceEvidence(text,url,{title,issn}){
  const compact=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
  if(!compact(text).includes(compact(title))||!issn.some(i=>text.includes(i)))return null;
  // A single-journal publisher/institutional record must identify the journal.
  // Do not read index names from search snippets, index lists or navigation filters.
  const host=new URL(url).hostname;
  if(!/\/journal\/|\/record\/|\/journals\/|\/WebQuery\//i.test(new URL(url).pathname))return null;
  const sourceType=/clarivate\.com$/.test(host)?'Clarivate':/fz-juelich\.de$|tu-dresden\.de$|wur\.nl$/.test(host)?'Institutional journal record':'Publisher';
  const data=metrics(text,url);
  const index=data.index==='UNKNOWN'?null:{index:data.index,evidence:data.indexEvidence,source:url,authority:sourceType,matchedISSN:issn.find(i=>text.includes(i)),checked:new Date().toISOString()};
  for(const key of ['citeScore','impactFactor'])if(data[key]){data[key].authority=sourceType;const year=text.match(/Scopus rating\s*\((20\d{2})\)\s*:?\s*CiteScore/i)?.[1];if(key==='citeScore'&&year)data[key].year=year;}
  return {index,citeScore:data.citeScore,impactFactor:data.impactFactor};
}
export async function researchWeb(input,{search=searchPublicWeb,read=url=>getPage(url,publisherHTTP)}={}){
  const queries=[`"${input.title}" "${input.issn[0]}" "Science Citation Index Expanded"`,`"${input.title}" "Web of Science Core Collection"`,`"${input.title}" "CiteScore"`];
  const candidates=[input.url,...(input.urls||[])].filter(Boolean),attempts=[],searchLog=[];
  try{const registry=JSON.parse(await readFile(new URL('../data/research-sources.json',import.meta.url),'utf8'));for(const row of registry)if(row.issn?.some(i=>input.issn.includes(i)))candidates.push(...row.urls);}catch{}
  for(const query of queries){try{const found=await search(query);searchLog.push({query,count:found.length});candidates.push(...found.slice(0,8).map(r=>r.url));}catch(e){searchLog.push({query,error:e.message});}}
  const result={attempts,searchLog,indexEvidence:null,citeScore:null,impactFactor:null};
  try{
    const rows=JSON.parse(await readFile(new URL('../data/verified-evidence.json',import.meta.url),'utf8'));
    for(const row of rows){if(!row.issn.some(i=>input.issn.includes(i))||Date.now()-Date.parse(row.checked)<0||Date.now()-Date.parse(row.checked)>86400000)continue;
      result.cachedEvidence={checked:row.checked,provenance:row.provenance};
      const c=row.clarivateCheck;
      if(c&&row.issn.includes(c.checkedISSN)&&new URL(c.source).hostname==='mjl.clarivate.com')result.clarivateCheck={...c,cached:true};
      if(row.citeScore){const host=new URL(row.citeScore.source).hostname;
        const official=host==='www.scopus.com';
        const institutional=row.citeScore.authority==='Institutional journal record'&&['fis.tu-dresden.de','juser.fz-juelich.de','library.wur.nl'].includes(host)&&typeof row.citeScore.evidence==='string'&&input.issn.some(i=>row.citeScore.evidence.includes(i));
        if(official||institutional)result.citeScore={...row.citeScore,cached:true};
      }
    }
  }catch{}
  for(const url of [...new Set(candidates)]){
    try{safeURL(url);}catch{attempts.push({url,status:'candidate',reason:'Source requires agent review; automatic publisher parser does not support this host.'});continue;}
    // MJL pages include all index names in filters; use the dedicated parser there.
    if(new URL(url).hostname==='mjl.clarivate.com')continue;
    try{const page=await read(url),e=sourceEvidence(page.text,page.url,input);attempts.push({url,status:e?'identity matched':'identity not matched'});if(!e)continue;
      if(e.index){if(!result.indexEvidence||e.index.index==='ESCI')result.indexEvidence=e.index;}
      for(const key of ['citeScore','impactFactor'])if(!result[key]&&e[key])result[key]=e[key];
    }catch(e){attempts.push({url,status:'unavailable',reason:e.message});}
  }
  return result;
}
