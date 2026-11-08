import {isIssueURL} from './issue-url.mjs';
const normalize=s=>s.toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
export async function fullCheck(input,{call,onProgress=()=>{},onCheckpoint=()=>{},previousReport=null}){
  if(typeof input!=='string'||input.trim().length<2)throw Error('Enter a journal name or publisher URL.');
  input=input.trim();const stages=[],sources=[];
  const stage=(name,status,detail)=>{const item={name,status,detail};stages.push(item);onProgress(item);};
  let url,match;
  if(/^https?:\/\//i.test(input))url=input;
  else{
    stage('Identify journal','running','Searching journal names and ISSNs.');
    const results=(await call('search',input)).journals;
    const exact=results.filter(j=>normalize(j.title)===normalize(input));
    const unique=[...new Map(exact.map(j=>[j.issn.join(','),j])).values()];
    if(unique.length!==1)return {needsSelection:true,candidates:results,stages,reason:'The name does not identify one exact journal. Choose a matching title or provide its publisher link.'};
    match=unique[0];url=(await call('resolve',match.electronicISSN||match.issn[0])).url;
  }
  const parsed=new URL(url),homeRoute=parsed.pathname.match(/^\/journal\/[^/]+/);
  const home=homeRoute?parsed.origin+homeRoute[0]:url;
  stage('Publisher source','running','Reading journal identifiers, indexing statements and metrics.');
  let journal;
  for(let attempt=0;attempt<2;attempt++){
    try{journal=await call('journal',home);break;}catch(e){if(attempt||!/timed out|timeout|connection failed/i.test(e.message)){
      if(previousReport){journal=previousReport;stage('Publisher source','retrying',e.message+' Keeping previously collected evidence.');break;}
      if(!/HTTP 403|HTTP 429|browser verification|interactive session/i.test(e.message))throw e;
      if(!match){
        const hint=homeRoute?.[0].split('/').at(-1)?.replace(/-/g,' ');
        if(hint){const found=(await call('search',hint)).journals;const exact=found.filter(j=>normalize(j.title)===normalize(hint));if(exact.length===1){
          const resolved=await call('resolve',exact[0].electronicISSN||exact[0].issn[0]);
          const resolvedURL=new URL(resolved.url);if(resolvedURL.origin===parsed.origin&&resolvedURL.pathname.replace(/\/$/,'')===homeRoute[0])match={...exact[0],issn:resolved.issn||exact[0].issn};
        }}
      }
      if(!match)throw Error('Publisher access is blocked and the journal could not be matched safely. Retrying other identity sources is required.');
      journal={...match,url:home,index:'UNKNOWN',articles:[],issues:[],publisherAccessError:e.message,identitySource:'Crossref / OpenAlex metadata'};
      stage('Publisher source','unavailable','Publisher denied automated access. Journal identity matched through metadata; continuing with web and editorial-history metadata sources.');break;
    }stage('Publisher source','running','Temporary connection failure; retrying this source once.');}
  }
  if(match&&journal.issn.length&&!journal.issn.some(i=>match.issn.includes(i)))throw Error('Resolved publisher journal ISSNs do not match the selected journal.');
  const report={...previousReport,version:1,...journal,title:match?.title||journal.title.replace(/^Home \| /,'').replace(/ \| Springer Nature Link$/,''),issn:[...new Set([...journal.issn,...(match?.issn||[])])],articles:previousReport?.articles||[],sources:[...(previousReport?.sources||[]),...sources],stages,checked:new Date().toISOString(),automated:true};
  report.citeScore=journal.citeScore||previousReport?.citeScore;report.impactFactor=journal.impactFactor||previousReport?.impactFactor;
  report.sources.push({url:journal.url,checked:report.checked,method:journal.publisherAccessError?'Metadata identity fallback; publisher inaccessible':'Automatic publisher check',error:journal.publisherAccessError});
  stage('Journal identity','complete','Journal matched with '+report.issn.length+' ISSNs.');
  onCheckpoint(report);
  const typed=[journal.electronicISSN,journal.printISSN,...report.issn].filter(Boolean);
  const ids=[...new Set(typed)];
  if(['SCIE','ESCI'].includes(journal.index)&&journal.indexEvidence&&journal.issn?.some(i=>ids.includes(i))){
    report.webIndexCheck={index:journal.index,evidence:journal.indexEvidence,source:journal.url,authority:'Publisher',matchedISSN:journal.issn.find(i=>ids.includes(i)),checked:journal.checked||report.checked};
  }
  stage('Clarivate MJL','running','Checking the journal by Electronic / Print ISSN.');
  report.clarivateAttempts=[];
  for(const issn of ids){
    if(report.clarivateCheck)break;
    const source='https://mjl.clarivate.com/search-results?issn='+encodeURIComponent(issn)+'&hide_exact_match_fl=true';
    try{
      const record=await call('clarivate',{issn,title:report.title,source});
      report.clarivateAttempts.push({issn,source,status:record.index?'verified':'unavailable',detail:record.error});
      if(record.index){report.clarivateCheck={...record,checkedISSN:issn,source,identityMatched:true,checked:new Date().toISOString(),method:'Automatic matching of public Clarivate record'};break;}
    }catch(e){report.clarivateAttempts.push({issn,source,status:'unavailable',detail:e.message});}
  }
  stage('Clarivate MJL',report.clarivateCheck?'complete':'unavailable',report.clarivateCheck?'Matched coverage: '+report.clarivateCheck.index:'Public MJL coverage could not be verified automatically. Publisher statements do not pass the SCIE check.');
  stage('Citation metrics','running','Checking CiteScore and Impact Factor sources.');
  if(!report.citeScore){
    for(const issn of ids){try{const d=await call('serialMetrics',issn);if(d.citeScore){report.citeScore=d.citeScore;break;}}catch(e){report.metricAccessError=e.message;}}
  }
  if(!report.clarivateCheck||!report.citeScore||!report.impactFactor){
    stage('Web research','running','Searching Core Collection coverage and citation metrics by journal name and ISSNs.');
    try{const found=await call('webResearch',{title:report.title,issn:ids,url:home,urls:report.webResearch?.attempts?.filter(a=>a.status==='identity matched').map(a=>a.url)||[]});report.webResearch=found;
      if(found.indexEvidence)report.webIndexCheck=found.indexEvidence;
      if(!report.clarivateCheck&&found.clarivateCheck)report.clarivateCheck=found.clarivateCheck;
      if(!report.citeScore&&found.citeScore)report.citeScore=found.citeScore;
      if(!report.impactFactor&&found.impactFactor)report.impactFactor=found.impactFactor;
      stage('Web research',report.webIndexCheck?'complete':'retrying',report.webIndexCheck?'Matched '+report.webIndexCheck.index+' evidence from '+report.webIndexCheck.authority+'.':'No source verified yet; retaining search results for the next attempt.');
    }catch(e){stage('Web research','retrying',e.message);}
  }
  stage('Citation metrics',report.citeScore&&report.impactFactor?'complete':'incomplete','Impact Factor '+(report.impactFactor?.value??'unavailable')+'; CiteScore '+(report.citeScore?.value??'unavailable')+'.');
  onCheckpoint(report);
  stage('Recent issues','running','Discovering recent issues automatically.');
  let issues=journal.issues||[];
  try{issues=[...issues,...(await call('issues',home)).issues];}catch(e){report.issueAccessError=e.message;}
  let metadataIssues=[];
  if(!issues.some(i=>isIssueURL(i.url,home))&&ids.length){try{
    const works=await call('works',ids[0]);const groups=new Map();
    for(const article of works.articles||[]){if(!article.volume)continue;const key=String(article.volume)+' / '+String(article.issue||'continuous volume');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(article);}
    metadataIssues=[...groups].map(([label,articles])=>({url:home+'#metadata-issue-'+encodeURIComponent(label),title:report.title,issn:ids,articles,identitySource:'Crossref journal ISSN, volume and issue metadata'}));
    report.metadataIssueSources=metadataIssues.map(i=>({url:i.url,label:i.url.split('#')[1],count:i.articles.length}));
  }catch(e){report.metadataAccessError=e.message;}}
  const issueURLs=[...new Set(issues.map(i=>i.url).filter(u=>isIssueURL(u,home)))].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})).slice(0,48);
  if(isIssueURL(url,home)&&!issueURLs.includes(url))issueURLs.unshift(url);
  report.issues=issues;stage('Recent issues',issueURLs.length||metadataIssues.length?'complete':'unavailable',issueURLs.length+' publisher issues and '+metadataIssues.length+' ISSN-matched metadata issue groups discovered.');
  stage('Article histories','running','Inspecting recent issues until 15 verified acceptance intervals are found.');
  if(report.auditComplete&&report.articles.length>=15){stage('Article histories','complete','Keeping '+report.articles.length+' previously verified article histories.');}
  else if(issueURLs.length||metadataIssues.length){
    try{const audit=await call('audit',{urls:issueURLs.slice(0,48),journalURL:home,metadataIssues,previousArticles:report.articles||[],onProgress:checkpoint=>{report.articles=checkpoint.articles;report.auditFailures=checkpoint.failures;onCheckpoint(report);stage('Article histories','running',checkpoint.articles.length+' / 15 verified acceptance intervals; '+(checkpoint.issueURL?'issue '+checkpoint.issueURL+' · '+checkpoint.issueStatus:'continuing through recent issues.'));}});report.articles=audit.articles;report.auditFailures=[...(report.auditFailures||[]),...audit.failures].slice(-500);report.issueAuditResults=audit.issueResults;report.statistics=audit.statistics;report.revisionCoverage=audit.revisionCoverage;report.historyPolicy='received-accepted';report.auditComplete=audit.complete;stage('Article histories',audit.complete?'complete':'incomplete',audit.articles.length+' / 15 verified acceptance intervals; '+audit.attempted+' candidates inspected.');}
    catch(e){stage('Article histories','unavailable',e.message);report.auditComplete=false;}
  }else{report.auditComplete=false;stage('Article histories','unavailable','No recent issue could be accessed.');}
  const index=report.clarivateCheck?.index||report.webIndexCheck?.index;
  report.eligibility=index==='ESCI'||report.index==='ESCI'||report.webIndexCheck?.index==='ESCI'?'excluded':index==='SCIE'?'SCIE verified':'unverified';
  report.complete=report.eligibility!=='excluded'&&!!report.auditComplete&&!!report.citeScore&&!!report.impactFactor&&index==='SCIE';
  report.pendingChecks=[...(!index?['Web of Science Core Collection']:[]),...(!report.citeScore?['CiteScore']:[]),...(!report.impactFactor?['Impact Factor']:[]),...(!report.auditComplete?['15 verified acceptance intervals']:[])];
  report.runStatus=report.eligibility==='excluded'?'Rejected: ESCI does not meet the required SCIE coverage.':report.complete?'All required checks verified. '+report.articles.length+' verified acceptance intervals.':'Research continuing: '+report.articles.length+' / 15 verified acceptance intervals. Still checking: '+report.pendingChecks.join(', ')+'. Evidence is saved; the next pass will resume automatically.';
  stage(report.complete?'Verified':report.eligibility==='excluded'?'Rejected':'Continuing research',report.complete?'complete':report.eligibility==='excluded'?'rejected':'retrying',report.runStatus);
  return report;
}
