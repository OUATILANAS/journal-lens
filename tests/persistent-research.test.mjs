import assert from 'node:assert/strict';
import {checkRunner} from '../src/check-runner.mjs';
import {auditIssues} from '../src/audit.mjs';
import {parseSearchRSS,sourceEvidence,researchWeb} from '../scripts/web-research.mjs';
const callbacks=[],jobs=new Map([['test',{status:'queued',input:'Journal',progress:[],created:1}]]);
let pass=0;
const runner=checkRunner({jobs,call:()=>{},now:()=>1000,timer:(fn,delay)=>{callbacks.push({fn,delay});return null},check:async(input,{previousReport})=>{pass++;if(pass===1)return {complete:false,articles:[{source:'one'}],pendingChecks:['15 histories']};assert.equal(previousReport.articles.length,1);return {complete:true,eligibility:'SCIE verified',articles:Array(15).fill({})};}});
await runner.run('test');assert.equal(jobs.get('test').status,'waiting');assert.equal(callbacks[0].delay,60000);assert.equal(jobs.get('test').nextRetry,61000);
await callbacks[0].fn();assert.equal(jobs.get('test').status,'complete');assert.equal(pass,2);
const excludedJobs=new Map([['excluded',{status:'queued',progress:[]}]]);
await checkRunner({jobs:excludedJobs,check:async()=>({complete:false,eligibility:'excluded'}),timer:()=>assert.fail('ESCI must be rejected, not retried')}).run('excluded');assert.equal(excludedJobs.get('excluded').status,'rejected');
let finish;const inFlight=new Promise(r=>finish=r),cancelJobs=new Map([['cancel',{status:'queued',progress:[]}]]);
const cancelRunner=checkRunner({jobs:cancelJobs,check:()=>inFlight});const execution=cancelRunner.run('cancel');cancelRunner.cancel('cancel');finish({complete:true});await execution;assert.equal(cancelJobs.get('cancel').status,'cancelled');
const urls=Array.from({length:16},(_,i)=>'https://link.springer.com/journal/12650/volumes-and-issues/29-'+(i+1));
let attempts=0;const audit=await auditIssues(urls,async(command,url)=>{
  if(command==='journal')return {url,issn:['1875-8975'],articles:[{url:'https://link.springer.com/article/10.1007/s12650-'+url.split('-').at(-1),title:'Study'}]};
  attempts++;return {source:url,title:'Study',journalISSN:'1875-8975',received:'2026-01-01',revised:'2026-02-01',accepted:'2026-03-01'};
});assert.equal(audit.articles.length,15);assert.equal(attempts,15);assert.equal(audit.complete,true);
const resumed=await auditIssues({urls,previousArticles:audit.articles},async()=>assert.fail('Do not refetch completed histories'));assert.equal(resumed.attempted,0);assert.equal(resumed.articles.length,15);
const rss='<rss><channel><item><title>Journal source</title><link>https://link.springer.com/journal/12650?a=1&amp;b=2</link></item></channel></rss>';
assert.equal(parseSearchRSS(rss)[0].url,'https://link.springer.com/journal/12650?a=1&b=2');
const input={title:'A Research Journal',issn:['1234-5678'],url:'https://link.springer.com/journal/12345'};
assert.equal(sourceEvidence('A Research Journal 9999-9999 Science Citation Index Expanded',input.url,input),null);
assert.equal(sourceEvidence('A Research Journal 1234-5678 Science Citation Index Expanded',input.url,input).index.authority,'Publisher');
assert.equal(sourceEvidence('A Research Journal 1234-5678 Science Citation Index Expanded','https://link.springer.com/article/10.1/x',input),null);
const web=await researchWeb(input,{search:async()=>[{url:input.url,title:input.title}],read:async()=>({url:input.url,text:'A Research Journal 1234-5678 Science Citation Index Expanded CiteScore 2025 3.5'})});
assert.equal(web.indexEvidence.index,'SCIE');assert.equal(web.citeScore.value,3.5);assert.equal(web.citeScore.year,'2025');assert.equal(web.searchLog.length,3);
const missingRevised=await auditIssues([urls[0]],async(cmd,url)=>cmd==='journal'?{url,issn:['1572-8196'],articles:Array.from({length:15},(_,i)=>({url:'https://link.springer.com/article/10.1007/s11276-test-'+i,title:'Study'}))}:{source:url,title:'Study',journalISSN:'1572-8196',received:'2025-01-01',accepted:'2026-01-01',revised:null});
assert.equal(missingRevised.complete,true);assert.equal(missingRevised.articles.length,15);assert.equal(missingRevised.revisionCoverage.notReported,15);assert.ok(missingRevised.articles.every(a=>a.revised===null&&a.revisionStatus==='Not reported in inspected source'));
const metadata=await auditIssues({urls:[],metadataIssues:[{url:'https://www.sciencedirect.com/journal/example#metadata-issue-256',title:'Example',issn:['1234-5678'],identitySource:'Crossref journal ISSN, volume and issue metadata',articles:[{url:'https://doi.org/10.1/record'}]}]},async()=>({title:'Study',source:'https://api.crossref.org/works/10.1%2Frecord',journalISSN:'1234-5678',received:'2026-01-01',accepted:'2026-03-01',revised:null}));
assert.equal(metadata.articles.length,1);assert.match(metadata.articles[0].issueIdentitySource,/Crossref/);assert.equal(metadata.complete,false);
const home='https://link.springer.com/journal/11119',issueCalls=[],updates=[];
const multi=await auditIssues({journalURL:home,urls:[home+'/aims-and-scope',home+'/volumes-and-issues/27-6',home+'/volumes-and-issues/27-5',home+'/volumes-and-issues/27-4',home+'/volumes-and-issues/27-3'],onProgress:p=>updates.push(p)},async(cmd,url)=>{
  if(cmd==='journal'){
    issueCalls.push(url);
    if(url.endsWith('27-6'))return {url,title:'Precision Agriculture',articles:[]};
    if(url.endsWith('27-5'))throw Error('Publisher returned HTTP 403');
    const count=url.endsWith('27-4')?7:8;
    return {url,title:'Precision Agriculture',issn:['1573-1618'],articles:Array.from({length:count},(_,i)=>({url:'https://link.springer.com/article/10.1007/s11119-'+url.split('/').at(-1)+'-'+i,title:'Study'}))};
  }
  return {source:url,title:'Study',journalISSN:'1573-1618',received:'2026-01-01',accepted:'2026-03-01',revised:null};
});
assert.equal(multi.complete,true);assert.equal(multi.articles.length,15);assert.equal(issueCalls.length,4);assert.ok(!issueCalls.some(u=>u.endsWith('aims-and-scope')));assert.equal(multi.issueResults.length,4);assert.ok(updates.some(p=>p.issueStatus?.includes('trying next issue')));assert.ok(multi.failures.some(f=>f.error.includes('403')));
console.log('Persistent retries, explicit cancellation, ESCI rejection, extended issue audits and source-matched web research passed.');
