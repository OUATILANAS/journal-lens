import assert from 'node:assert/strict';
import {fullCheck} from '../src/workflow.mjs';
const home='https://link.springer.com/journal/12650';
const issue=home+'/volumes-and-issues/29-5';
const calls=[];
const call=async(command,input)=>{
  calls.push([command,input]);
  if(command==='search')return {journals:[{title:'Journal of Visualization',issn:['1875-8975']}]};
  if(command==='resolve')return {url:home};
  if(command==='journal')return {title:'Home | Journal of Visualization | Springer Nature Link',url:home,issn:['1875-8975'],electronicISSN:'1875-8975',index:'SCIE',impactFactor:{value:2.3,year:'2025',source:home},issues:[{url:issue}],articles:[]};
  if(command==='clarivate')return {index:'SCIE',evidence:'Science Citation Index Expanded'};
  if(command==='serialMetrics')return {citeScore:{value:3.5,year:'2025',source:'https://api.elsevier.com/'}};
  if(command==='webResearch')return {indexEvidence:null,searchLog:[],attempts:[]};
  if(command==='issues')return {issues:[{url:issue}]};
  if(command==='audit'){assert.deepEqual(input.urls,[issue]);return {complete:true,articles:Array.from({length:15},(_,i)=>({title:'Article '+i})),failures:[],attempted:15,statistics:{n:15,median:181}};}
  throw Error('Unexpected command '+command);
};
const byName=await fullCheck('Journal of Visualization',{call});
assert.equal(byName.complete,true);assert.equal(byName.eligibility,'SCIE verified');assert.equal(byName.articles.length,15);assert.equal(byName.clarivateCheck.checkedISSN,'1875-8975');
assert.ok(calls.some(([cmd])=>cmd==='serialMetrics'));assert.ok(calls.some(([cmd])=>cmd==='audit'));
calls.length=0;const byURL=await fullCheck(home,{call});assert.equal(byURL.title,'Journal of Visualization');assert.ok(!calls.some(([cmd])=>cmd==='search'));
const unavailable=async(cmd,arg)=>{if(['clarivate','serialMetrics'].includes(cmd))throw Error('Access requires registration');return call(cmd,arg)};
const partial=await fullCheck(home,{call:unavailable});assert.equal(partial.complete,false);assert.equal(partial.eligibility,'unverified');assert.equal(partial.auditComplete,true);assert.equal(partial.clarivateCheck,undefined);
const ambiguous=await fullCheck('Visualization',{call});assert.equal(ambiguous.needsSelection,true);
const excluded=await fullCheck(home,{call:async(cmd,arg)=>cmd==='clarivate'?{index:'ESCI',evidence:'Emerging Sources Citation Index'}:call(cmd,arg)});assert.equal(excluded.eligibility,'excluded');
let continuedWeb=false,continuedAudit=false;
const blocked=await fullCheck('https://www.sciencedirect.com/journal/computers-and-electronics-in-agriculture',{call:async(cmd,arg)=>{
  if(cmd==='journal'||cmd==='issues')throw Error('Publisher returned HTTP 403.');
  if(cmd==='search')return {journals:[{title:'Computers and Electronics in Agriculture',issn:['0168-1699']}]};
  if(cmd==='resolve')return {url:'https://www.sciencedirect.com/journal/computers-and-electronics-in-agriculture',issn:['0168-1699']};
  if(cmd==='clarivate')return {index:'SCIE',evidence:'Science Citation Index Expanded'};
  if(cmd==='serialMetrics')return {citeScore:null};
  if(cmd==='webResearch'){continuedWeb=true;return {attempts:[],indexEvidence:null};}
  if(cmd==='works')return {articles:[{title:'Study',volume:'256',issue:'C',url:'https://doi.org/10.1/example'}]};
  if(cmd==='audit'){continuedAudit=true;assert.equal(arg.metadataIssues[0].issn[0],'0168-1699');return {articles:[],failures:[],statistics:{n:0},complete:false,attempted:1};}
  throw Error('Unexpected '+cmd);
}});
assert.equal(continuedWeb,true);assert.equal(continuedAudit,true);assert.equal(blocked.complete,false);assert.match(blocked.publisherAccessError,/403/);assert.equal(blocked.issn[0],'0168-1699');
console.log('One-input name/URL workflows, automatic audit, access gaps and ambiguous-title handling passed.');
