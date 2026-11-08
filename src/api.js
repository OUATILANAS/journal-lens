const HOSTS = ['sciencedirect.com','link.springer.com','link.springernature.com','nature.com','mdpi.com','frontiersin.org','onlinelibrary.wiley.com','academic.oup.com','journals.plos.org','bmcbiol.biomedcentral.com','biomedcentral.com','tandfonline.com','journals.sagepub.com','mjl.clarivate.com','juser.fz-juelich.de','fis.tu-dresden.de','library.wur.nl','www.scopus.com'];
export function safeURL(raw) {
  const u = new URL(raw);
  if(u.protocol !== 'https:' || u.port || u.username || u.password || !HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.'+h))) throw Error('Use an HTTPS journal URL from a supported publisher (see Method).');
  return u.href;
}
export function redirectURL(raw, current) {
  const next=new URL(raw,current), from=new URL(current);
  // Springer establishes an anonymous public-reading session through its IdP.
  // This exception applies to redirects only; the IdP cannot be used as a source.
  if(next.hostname==='idp.springer.com' && next.protocol==='https:' && !next.port && !next.username && !next.password &&
     ['link.springer.com','idp.springer.com'].includes(from.hostname) && ['/authorize','/transit'].includes(next.pathname)) {
    const back=next.searchParams.get('redirect_uri');
    if(back){const target=new URL(safeURL(back));if(target.hostname!=='link.springer.com')throw Error('Unexpected publisher session destination.');}
    return next.href;
  }
  try{return safeURL(next.href);}catch{throw Error('Publisher redirected to '+next.hostname+', which is not a supported journal destination.');}
}
export function storeCookies(jar, headers, raw) {
  const origin=new URL(raw);
  const values=headers.getSetCookie?headers.getSetCookie():(headers.get('set-cookie')||'').split(/,(?=\s*[^;,=\s]+=)/).filter(Boolean);
  for(const value of values){
    const [pair,...attrs]=value.split(';');const equals=pair.indexOf('=');if(equals<1)continue;
    const name=pair.slice(0,equals).trim();const domainAttr=attrs.find(a=>/^\s*domain=/i.test(a));
    const domain=domainAttr?domainAttr.split('=').slice(1).join('=').trim().replace(/^\./,'').toLowerCase():origin.hostname;
    if(domain!==origin.hostname&&!origin.hostname.endsWith('.'+domain))continue;
    // Only cookies scoped to known publisher families are accepted.
    if(!['springer.com','springernature.com','sciencedirect.com','nature.com','mdpi.com','frontiersin.org','wiley.com','oup.com','plos.org','biomedcentral.com','tandfonline.com','sagepub.com','clarivate.com'].some(d=>domain===d||domain.endsWith('.'+d)))continue;
    const path=attrs.find(a=>/^\s*path=/i.test(a))?.split('=').slice(1).join('=').trim()||origin.pathname.slice(0,origin.pathname.lastIndexOf('/')+1)||'/';
    const item={name,pair:pair.trim(),domain,path,hostOnly:!domainAttr};
    const old=jar.findIndex(c=>c.name===name&&c.domain===domain&&c.path===path);if(old>=0)jar.splice(old,1);
    const maxAge=attrs.find(a=>/^\s*max-age=/i.test(a));const expiry=attrs.find(a=>/^\s*expires=/i.test(a));
    if(maxAge&&+maxAge.split('=')[1]<=0)continue;
    if(!maxAge&&expiry&&Date.parse(expiry.slice(expiry.indexOf('=')+1))<=Date.now())continue;
    jar.push(item);
  }
}
export function cookieHeader(jar, raw){const u=new URL(raw);return jar.filter(c=>(c.hostOnly?u.hostname===c.domain:u.hostname===c.domain||u.hostname.endsWith('.'+c.domain))&&(u.pathname===c.path||u.pathname.startsWith(c.path.endsWith('/')?c.path:c.path+'/'))).map(c=>c.pair).join('; ');}
export const plain = s => s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
export function journalIdentifiers(html){
  const text=plain(html);
  const electronicISSN=text.match(/\b(?:Electronic ISSN|Online ISSN|eISSN|e-ISSN)\s*:?\s*(\d{4}-\d{3}[\dX])\b/i)?.[1]||null;
  const printISSN=text.match(/\b(?:Print ISSN|pISSN|p-ISSN)\s*:?\s*(\d{4}-\d{3}[\dX])\b/i)?.[1]||null;
  return {electronicISSN,printISSN,issn:[...new Set([electronicISSN,printISSN,...(text.match(/\b\d{4}-\d{3}[\dX]\b/g)||[])].filter(Boolean))]};
}
async function json(url) {
  const r=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
  if(!r.ok)throw Error('Metadata service returned HTTP '+r.status+'. Please retry.');
  const body=await r.text();let data;
  try{data=JSON.parse(body);}catch{throw Error('The metadata service returned a non-JSON response. Please retry later.');}
  if(!data||typeof data!=='object')throw Error('The metadata service returned an invalid response.');
  return data;
}
export async function getPage(raw, publisherFetch=fetch) {
  let url=safeURL(raw);const jar=[]; // Anonymous cookies live only for this fetch chain.
  const deadline=AbortSignal.timeout(25000);
  for(let i=0;i<10;i++) {
    const cookie=cookieHeader(jar,url);
    const r=await publisherFetch(url,{redirect:'manual',signal:deadline,headers:{'User-Agent':'JournalLens/1.0 (journal metadata research)','Accept':'text/html,application/xhtml+xml',...(cookie?{Cookie:cookie}:{})}});
    storeCookies(jar,r.headers,url);
    if(r.status>=300&&r.status<400){const location=r.headers.get('location');if(!location)throw Error('Publisher returned an incomplete redirect. Please retry.');url=redirectURL(location,url);continue;}
    if(!r.ok) throw Error('Publisher returned HTTP '+r.status+'. Alternate public sources and metadata will be checked.');
    if(!/html|xml|text/.test(r.headers.get('content-type')||''))throw Error('This source is not an HTML article page.');
    const reader=r.body.getReader();let chunks=[],size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4e6){await reader.cancel();throw Error('Publisher page exceeds the 4 MB limit.');}chunks.push(value);}
    let html=chunks.map(c=>new TextDecoder().decode(c)).join('');
    if(/<title[^>]*>[^<]*(?:Just a moment|Access Denied|Robot|Attention Required|Verify|Client Challenge)/i.test(html)||/captcha|cf-chl-/i.test(html))throw Error('Publisher requires browser verification; automatic collection is unavailable for this request.');
    if(new URL(url).hostname==='idp.springer.com')throw Error('Springer requires an interactive session. Open the publisher page, then use Read copied page to extract its evidence automatically.');
    return {url,html,text:plain(html)};
  } throw Error('Too many publisher redirects.');
}
export function dateISO(raw) {
  if(!raw)return null;
  const s=raw.trim(); let y,m,d;
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){[y,m,d]=s.split('-').map(Number);}
  else {const a=s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);const b=s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);if(!a&&!b)return null;const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];y=+(a?a[3]:b[3]);m=months.indexOf((a?a[2]:b[1]).slice(0,3).toLowerCase())+1;d=+(a?a[1]:b[2]);}
  const dt=new Date(Date.UTC(y,m-1,d));return m&&dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d?dt.toISOString().slice(0,10):null;
}
export function history(html) {
  const text=plain(html), result={received:null,revised:null,accepted:null,evidence:[]};
  const date='(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+[A-Za-z]{3,12}\\s+\\d{4}|[A-Za-z]{3,12}\\s+\\d{1,2},?\\s+\\d{4})';
  for(const [key,label] of [['received','Received'],['revised','(?:Revised|Revision received|Received in revised form)'],['accepted','Accepted']]){
    const re=new RegExp('\\b'+label+'\\s*:?\\s*'+date,'gi'); const matches=[...text.matchAll(re)];
    // Last revision is retained when multiple rounds are explicitly reported.
    const valid=matches.map(m=>({value:dateISO(m[1]),quote:m[0]})).filter(x=>x.value);
    if(valid.length){const entry=key==='revised'?valid[valid.length-1]:valid[0];result[key]=entry.value;result.evidence.push(entry.quote);}
  }
  for(const key of ['received','accepted'])if(!result[key]){
    const tags=html.match(/<meta\b[^>]*>/gi)||[];
    for(const tag of tags)if(new RegExp('(?:citation_date_'+key+'|dc\\.date\\.'+key+'|prism\\.'+(key==='received'?'receivedDate':'acceptedDate')+')','i').test(tag)){
      const raw=tag.match(/content=["']([^"']+)/i)?.[1];const v=dateISO(raw||'');if(v){result[key]=v;result.evidence.push(tag);break;}
    }
  }
  for(const m of html.matchAll(/<date\b[^>]*date-type=["'](received|rev-recd|revised|accepted)["'][^>]*>([\s\S]*?)<\/date>/gi)){
    const part=m[2],day=plain(part.match(/<day[^>]*>([\s\S]*?)<\/day>/i)?.[1]||''),month=plain(part.match(/<month[^>]*>([\s\S]*?)<\/month>/i)?.[1]||''),year=plain(part.match(/<year[^>]*>([\s\S]*?)<\/year>/i)?.[1]||'');
    const value=dateISO(year+'-'+month.padStart(2,'0')+'-'+day.padStart(2,'0'));
    if(value){const key=/rev/i.test(m[1])?'revised':m[1].toLowerCase();result[key]=value;result.evidence.push('JATS '+m[1]+': '+value);}
  }
  const title=plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'Article');
  const doi=html.match(/(?:citation_doi|dc.identifier)["'][^>]*content=["'](?:doi:)?([^"']+)/i)?.[1]||null;
  const meta=html.match(/<meta\b[^>]*>/gi)||[];
  const getMeta=name=>{for(const tag of meta){if(new RegExp('(?:name|property)=["\']'+name+'["\']','i').test(tag))return plain(tag.match(/content=["']([^"']+)/i)?.[1]||'');}return null;};
  return {title,doi,journalTitle:getMeta('citation_journal_title'),journalISSN:getMeta('citation_issn')||getMeta('prism.issn'),...result};
}
export function crossrefHistory(work){
  const result={received:null,revised:null,accepted:null,evidence:[]};
  for(const a of work.assertion||[]){const label=(a.name||a.label||'').toLowerCase().replace(/[_-]/g,' ').trim();
    const key=/^(received|date received|received date)$/.test(label)?'received':/^(accepted|date accepted|accepted date)$/.test(label)?'accepted':/^(revised|revision received|revised date|date revised)$/.test(label)?'revised':null;
    const value=key&&dateISO(a.value);if(value){result[key]=value;result.evidence.push((a.label||a.name)+': '+a.value);}
  }
  return {...result,title:work.title?.[0]||work.DOI,doi:work.DOI,journalTitle:work['container-title']?.[0]||null,journalISSN:work.ISSN?.[0]||null};
}
export function metrics(text,url) {
  const take = label => {
    const yearFirst=text.match(new RegExp(label+'\\s*(20\\d{2})\\s*[:]?\\s*(\\d+(?:\\.\\d+)?)','i'));
    if(yearFirst)return {value:+yearFirst[2],year:yearFirst[1],source:url,evidence:yearFirst[0],checked:new Date().toISOString()};
    let m=text.match(new RegExp(label+'\\s*[:®™]?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:\\((20\\d{2})\\))?','i'));
    if(!m)m=text.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*'+label,'i'));
    return m?{value:+m[1],year:m[2]||null,source:url,evidence:m[0],checked:new Date().toISOString()}:null;
  };
  const esci=/\bEmerging Sources Citation Index\b/i.test(text), scie=/\bScience Citation Index Expanded\b/i.test(text);
  return {index:esci?'ESCI':scie?'SCIE':'UNKNOWN',indexSource:url,indexEvidence:esci?'Emerging Sources Citation Index':scie?'Science Citation Index Expanded':null,indexAuthority:new URL(url).hostname==='mjl.clarivate.com'?'Clarivate':'Publisher',impactFactor:take('(?:Journal )?Impact Factor'),citeScore:take('CiteScore')};
}
export function links(html,base,kind) {
  const out=[];
  for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try{const url=safeURL(new URL(m[1].replace(/&amp;/g,'&'),base).href); const p=new URL(url);if(p.hostname!==new URL(base).hostname)continue;
      const isArticle=/\/science\/article\/pii\/|\/article\/10\.|\/articles\/|\/doi\/(?:full\/|abs\/)?10\.|\/\d{4}-\d{4}\/\d+\/\d+\/\d+/.test(p.pathname);
      const isIssue=/\/vol\/|\/volumes-and-issues\/\d|\/issues\/|\/issue\//.test(p.pathname);
      if((kind==='article'&&isArticle)||(kind==='issue'&&isIssue))out.push({url:url.split('#')[0].split('?')[0],title:plain(m[2])||'Article',cohort:base});
    }catch{}
  }return [...new Map(out.map(x=>[x.url,x])).values()];
}
export async function api(request, {publisherFetch=fetch}={}) {
  const u=new URL(request.url),p=u.pathname;
  if(p==='/api/extract' && request.method==='POST'){
    const raw=await request.text();if(raw.length>4e6)throw Error('Copied page exceeds 4 MB.');
    const {text,url,kind}=JSON.parse(raw);const source=safeURL(url);
    if(typeof text!=='string'||text.trim().length<30)throw Error('Paste the journal page or article history text first.');
    // Pasted content is parsed only; its HTML is never rendered or executed.
    const html=/<(?:html|head|body|meta|title|p|div)\b/i.test(text)?text:text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if(kind==='article')return {...history(html),source,manual:true,checked:new Date().toISOString()};
    return {url:source,...metrics(plain(html),source),...journalIdentifiers(html),checked:new Date().toISOString(),manual:true};
  }
  if(p==='/api/search'){
    const q=(u.searchParams.get('q')||'').trim().slice(0,200);if(q.length<2)throw Error('Enter at least two characters.');
    const d=await json('https://api.crossref.org/journals?query='+encodeURIComponent(q)+'&rows=12');
    return {journals:d.message.items.filter(j=>j.ISSN?.length).map(j=>({title:j.title,issn:j.ISSN,electronicISSN:j['issn-type']?.find(i=>i.type==='electronic')?.value||null,printISSN:j['issn-type']?.find(i=>i.type==='print')?.value||null,publisher:j.publisher||''})),source:'https://api.crossref.org/journals?query='+encodeURIComponent(q)};
  }
  if(p==='/api/clarivate'){
    const issn=u.searchParams.get('issn');if(!/^\d{4}-\d{3}[\dX]$/.test(issn||''))throw Error('Valid ISSN required.');
    const title=(u.searchParams.get('title')||'').trim();
    const source='https://mjl.clarivate.com/search-results?issn='+encodeURIComponent(issn)+'&hide_exact_match_fl=true';
    const page=await getPage(source,publisherFetch);
    // Read only a journal result card, never the page's index filter labels.
    const cards=page.html.match(/<(?:mat-card|article)\b[^>]*>[\s\S]*?<\/(?:mat-card|article)>/gi)||[];
    for(const html of cards){const text=plain(html);if(!text.includes(issn)||!title||!text.toLowerCase().includes(title.toLowerCase()))continue;
      const coverage=text.match(/Web of Science Core Collection\s*:?\s*([\s\S]*?)(?=Additional Web of Science|View profile|$)/i)?.[1];
      if(!coverage)continue;
      const index=/Emerging Sources Citation Index/i.test(coverage)?'ESCI':/Science Citation Index Expanded/i.test(coverage)?'SCIE':null;
      if(index)return {index,evidence:coverage.trim().slice(0,800),source,checkedISSN:issn,identityMatched:true};
    }
    return {index:null,error:'Clarivate did not expose a matching public journal record. JavaScript or registered access may be required.',source};
  }
  if(p==='/api/serialMetrics'){
    const issn=u.searchParams.get('issn');if(!/^\d{4}-\d{3}[\dX]$/.test(issn||''))throw Error('Valid ISSN required.');
    const source='https://api.elsevier.com/content/serial/title/issn/'+issn+'?view=CITESCORE';
    const data=await json(source);const entries=data['serial-metadata-response']?.entry||[];
    for(const entry of entries){
      const ids=[entry['prism:issn'],entry['prism:eIssn']].filter(Boolean).map(i=>i.replace(/-/g,''));if(!ids.includes(issn.replace(/-/g,'')))continue;
      const info=entry.citeScoreYearInfoList?.citeScoreCurrentMetric;
      const value=info?.['@score'],year=info?.['@year'];
      if(value!==undefined&&Number.isFinite(+value))return {citeScore:{value:+value,year:year||null,source,evidence:JSON.stringify(info),checked:new Date().toISOString()}};
    }
    return {citeScore:null};
  }
  if(p==='/api/journal'){
    const page=await getPage(u.searchParams.get('url'),publisherFetch);const issn=[...new Set(page.text.match(/\b\d{4}-\d{3}[\dX]\b/g)||[])];
    return {title:plain(page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'Journal'),url:page.url,...journalIdentifiers(page.html),...metrics(page.text,page.url),articles:links(page.html,page.url,'article').slice(0,60),issues:links(page.html,page.url,'issue').slice(0,12),checked:new Date().toISOString()};
  }
  if(p==='/api/resolve'){
    const issn=u.searchParams.get('issn');if(!/^\d{4}-\d{3}[\dX]$/.test(issn||''))throw Error('Valid ISSN required.');
    const data=await json('https://api.openalex.org/sources?filter=issn:'+issn+'&per-page=3');
    const source=data.results?.find(s=>s.issn?.includes(issn));
    let url=source?.homepage_url;
    if(!url)throw Error('No publisher homepage found. Paste its journal or issue URL.');
    const purl=new URL(url);
    if(['springer.com','www.springer.com'].includes(purl.hostname)&&/^\/journal\/\d+\/?$/.test(purl.pathname))url='https://link.springer.com'+purl.pathname;
    else if(/(?:journals\.)?elsevier\.com$/.test(purl.hostname))url='https://www.sciencedirect.com/journal/'+purl.pathname.split('/').filter(Boolean).at(-1);
    else if(url.startsWith('http:'))url='https:'+url.slice(5);
    return {url:safeURL(url),title:source.display_name,issn:source.issn,source:source.id};
  }
  if(p==='/api/works'){
    const issn=u.searchParams.get('issn');if(!/^\d{4}-\d{3}[\dX]$/.test(issn||''))throw Error('A valid ISSN is required.');
    const d=await json('https://api.crossref.org/journals/'+issn+'/works?filter=type:journal-article&sort=published&order=desc&rows=60');
    return {articles:d.message.items.map(w=>({title:w.title?.[0]||w.DOI,doi:w.DOI,url:w.resource?.primary?.URL||w.URL,volume:w.volume,issue:w.issue,published:(w.published?.['date-parts']?.[0]||[]).join('-'),cohort:'Crossref recent publications; issue membership requires verification'}))};
  }
  if(p==='/api/issues'){
    const original=new URL(safeURL(u.searchParams.get('url')));let target;
    if(/springer(?:nature)?\.com$/.test(original.hostname)){const m=original.pathname.match(/^\/journal\/\d+/);if(m)target=original.origin+m[0]+'/volumes-and-issues';}
    if(/sciencedirect\.com$/.test(original.hostname)){const m=original.pathname.match(/^\/journal\/[^/]+/);if(m)target=original.origin+m[0]+'/issues';}
    if(!target)return {issues:[]};
    const page=await getPage(target,publisherFetch);return {issues:links(page.html,page.url,'issue').sort((a,b)=>b.url.localeCompare(a.url,undefined,{numeric:true})).slice(0,60)};
  }
  if(p==='/api/article'){
    let url=u.searchParams.get('url'),work=null,doi=url?.match(/(?:doi\.org\/|\/article\/)(10\.[^?#]+)/i)?.[1];
    if(/^https:\/\/doi\.org\/10\./i.test(url||'')){
      const d=await json('https://api.crossref.org/works/'+encodeURIComponent(url.slice(16)));work=d.message;doi=work.DOI;url=d.message.resource?.primary?.URL;if(!url)throw Error('Publisher URL is unavailable; import this history manually.');
    }
    let parsed,pageError;
    try{const page=await getPage(url,publisherFetch);parsed={...history(page.html),source:page.url,checked:new Date().toISOString()};doi=parsed.doi||doi;if(parsed.received&&parsed.accepted)return parsed;}catch(e){pageError=e;}
    if(doi){try{work=work||(await json('https://api.crossref.org/works/'+encodeURIComponent(doi))).message;const extra=crossrefHistory(work);
      if(extra.received&&extra.accepted)return {...extra,source:'https://api.crossref.org/works/'+encodeURIComponent(doi),publisherSource:url,checked:new Date().toISOString(),retrievalMethod:'Explicit Crossref editorial-history assertions'};
    }catch{}}
    if(parsed)return parsed;
    throw pageError||Error('No explicit article history found in publisher or metadata sources.');
  }
  throw Error('Unknown endpoint.');
}
