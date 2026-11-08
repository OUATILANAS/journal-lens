#!/usr/bin/env node
import {pathToFileURL} from 'node:url';
import {api} from '../src/api.js';
import {publisherHTTP} from './publisher-http.mjs';
import {auditIssues} from '../src/audit.mjs';
import {fullCheck} from '../src/workflow.mjs';
import {researchWeb} from './web-research.mjs';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';

async function persistentCheck(input){
  if(typeof input!=='string'||input.trim().length<2)throw Error('Enter a journal name or publisher URL.');
  const folder=new URL('../.local/cli-checks/',import.meta.url);await mkdir(folder,{recursive:true});
  const name=createHash('sha256').update(input).digest('hex')+'.json';const file=new URL(name,folder),temp=new URL(name+'.tmp',folder);
  let previousReport;try{previousReport=JSON.parse(await readFile(file,'utf8'));}catch{}
  let pass=0,saving=Promise.resolve();
  const checkpoint=report=>{const text=JSON.stringify(report,null,2);saving=saving.then(async()=>{await writeFile(temp,text);await rename(temp,file);});};
  while(true){
    try{
      const report=await fullCheck(input,{call:runCommand,previousReport,onCheckpoint:checkpoint,onProgress:item=>process.stderr.write(item.name+': '+item.detail+'\n')});
      checkpoint(report);await saving;previousReport=report;
      if(report.complete||report.needsSelection||report.eligibility==='excluded')return report;
    }catch(e){process.stderr.write('Source access: '+e.message+'; retaining evidence and retrying.\n');}
    pass++;const delay=Math.min(600000,60000*2**Math.min(pass-1,4));process.stderr.write('Not complete. Retrying missing checks in '+Math.round(delay/1000)+' seconds. Ctrl+C stops; a later run resumes saved evidence.\n');
    await new Promise(resolve=>setTimeout(resolve,delay));
  }
}

export async function runCommand(command,input){
  const params={search:'q',resolve:'issn',journal:'url',issues:'url',article:'url',works:'issn',serialMetrics:'issn'};
  if(command==='help')return {name:'Journal Lens',commands:params,usage:'node scripts/journal-lens.mjs <command> <query, ISSN, or URL>',extract:'extract <source URL> <journal|article> with copied source text on stdin',check:'check <journal name or URL> keeps researching until verified, rejected or stopped; --once runs one resumable research pass',audit:'audit <issue URL> [additional issue URLs…]',notes:'Publisher indexing evidence does not establish a recorded Clarivate check. Audit statistics describe accepted articles only.'};
  if(params[command]){
    if(typeof input!=='string'||!input.trim())throw Error('A query, ISSN or source URL is required.');
    return api(new Request('http://local/api/'+command+'?'+new URLSearchParams({[params[command]]:input})),{publisherFetch:publisherHTTP});
  }
  if(command==='clarivate')return api(new Request('http://local/api/clarivate?'+new URLSearchParams(input)),{publisherFetch:publisherHTTP});
  if(command==='extract'){
    if(!input||!['journal','article'].includes(input.kind))throw Error('Use journal or article as the extraction kind.');
    return api(new Request('http://local/api/extract',{method:'POST',body:JSON.stringify(input)}));
  }
  if(command==='webResearch')return researchWeb(input);
  if(command==='audit')return auditIssues(input,runCommand);
  if(command==='check')return fullCheck(input,{call:runCommand});
  throw Error('Unknown command. Run help to see available commands.');
}


if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    let [command='help',...args]=process.argv.slice(2);if(command.startsWith('-'))throw Error('Unknown option. Run help to see available commands.');if(!['help','check','search','resolve','journal','issues','article','works','audit','extract'].includes(command)){args=[command,...args];command='check';}let input=args.join(' ');
    if(command==='extract')input={url:args[0],kind:args[1]||'journal',text:await (async()=>{let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>4e6)throw Error('Copied page exceeds 4 MB.');}return text;})()};
    if(command==='audit')input=args;
    const once=command==='check'&&args[0]==='--once';if(once)input=args.slice(1).join(' ');
    const data=command==='check'&&!once?await persistentCheck(input):await runCommand(command,input);
    process.stdout.write(JSON.stringify({ok:true,data},null,2)+'\n');
  }catch(e){process.stdout.write(JSON.stringify({ok:false,error:e.message})+'\n');process.exitCode=1;}
}
