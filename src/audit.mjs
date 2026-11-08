import {isIssueURL,journalKey} from './issue-url.mjs';
export async function auditIssues(input,runCommand){
  const urls=Array.isArray(input)?input:input.urls;const previous=Array.isArray(input)?[]:(input.previousArticles||[]);const progress=Array.isArray(input)?()=>{}:(input.onProgress||(()=>{}));

  const metadata=Array.isArray(input)?[]:(input.metadataIssues||[]);
  if(!Array.isArray(urls)||(!urls.length&&!metadata.length)||urls.length+metadata.length>48)throw Error('Supply one to 48 recent issue URLs.');
  const articles=[...previous],failures=[],issueResults=[],seen=new Set(previous.flatMap(a=>[a.source,a.publisherSource].filter(Boolean)));let journalRoute=Array.isArray(input)?null:journalKey(input.journalURL),attempted=0;
  for(const item of [...urls,...metadata]){
    const supplied=typeof item==='object'?item:null;const url=supplied?supplied.url:item;
    if(articles.length>=15)break;
    const key=journalKey(url);
    if(!key||!supplied&&!isIssueURL(url)||journalRoute&&journalRoute!==key){failures.push({source:url,error:'Skipped non-issue URL or different journal.'});continue;}
    journalRoute=journalRoute||key;
    const u=new URL(url),route=u.pathname.match(/^\/journal\/[^/]+(?=\/|$)/)[0];
    const before=articles.length;
    progress({articles:[...articles],failures:[...failures],attempted,issueURL:url,issueStatus:'inspecting',issuesInspected:issueResults.length});
    let issue;try{issue=supplied||await runCommand('journal',url);}catch(e){failures.push({source:url,error:e.message});issueResults.push({url,status:'unavailable',added:0});continue;}
    if(journalKey(issue.url)!==key){failures.push({source:url,error:'Issue redirected outside the selected journal.'});issueResults.push({url,status:'identity mismatch',added:0});continue;}
    for(const candidate of issue.articles||[]){
      if(articles.length>=15||attempted>=240)break;if(seen.has(candidate.url))continue;seen.add(candidate.url);attempted++;
      try{
        const a=await runCommand('article',candidate.url);
        const metadataMatch=issue.issn?.includes(a.journalISSN)||(a.journalTitle&&issue.title?.toLowerCase().includes(a.journalTitle.toLowerCase()));
        const articleJournal=new URL(a.publisherSource||a.source).pathname.match(/^\/article\/10\.1007\/s(\d+)-/);
        const routeMatch=articleJournal&&route==='/journal/'+articleJournal[1]&&new URL(a.publisherSource||a.source).hostname===u.hostname;
        if(!metadataMatch&&!routeMatch)throw Error('Article journal identity could not be matched.');
        if(/\b(editorial|correction|erratum|corrigendum|retraction)\b/i.test(a.title))throw Error('Non-research item excluded.');
        const dates=[a.received,a.accepted];const today=new Date().toISOString().slice(0,10);
        if(dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d||'')||!Number.isFinite(Date.parse(d))))throw Error('History requires valid Received and Accepted dates.');
        if(!(a.received<=a.accepted&&a.accepted<=today)||a.revised&&!(a.received<=a.revised&&a.revised<=a.accepted))throw Error('Invalid or future history dates.');
        articles.push({...a,revisionStatus:a.revised?'Reported':'Not reported in inspected source',issueIdentitySource:issue.identitySource||'Publisher issue page',cohort:issue.url,days:Math.round((Date.parse(a.accepted)-Date.parse(a.received))/86400000)});
        progress({articles:[...articles],failures:[...failures],attempted});
      }catch(e){failures.push({source:candidate.url,title:candidate.title,error:e.message});}
    }
    issueResults.push({url,status:articles.length>before?'histories found':'no usable histories',candidates:issue.articles?.length||0,added:articles.length-before});
    progress({articles:[...articles],failures:[...failures],attempted,issueURL:url,issueStatus:articles.length>before?'histories found':'no usable histories; trying next issue',issuesInspected:issueResults.length});
    if(articles.length>=15||attempted>=240)break;
  }
  const values=articles.map(a=>a.days).sort((a,b)=>a-b),n=values.length;
  const quant=p=>{if(!n)return null;const i=(n-1)*p;return values[Math.floor(i)]+(values[Math.ceil(i)]-values[Math.floor(i)])*(i%1)};
  return {checked:new Date().toISOString(),complete:n>=15,target:15,historyPolicy:'received-accepted',revisionCoverage:{reported:articles.filter(a=>a.revised).length,notReported:articles.filter(a=>!a.revised).length},attempted,articles,failures,issueResults,statistics:{n,median:quant(.5),mean:n?values.reduce((a,b)=>a+b,0)/n:null,min:values[0]??null,max:values.at(-1)??null,q1:quant(.25),q3:quant(.75)},limitations:'Issue recency and article eligibility should be reviewed at source. These are sampled accepted articles, not a turnaround prediction. Clarivate coverage must be checked separately by ISSN.'};
}

