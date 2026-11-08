import {cp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2);let destination,force=false;
for(let i=0;i<args.length;i++){
  if(args[i]==='--force')force=true;
  else if(args[i]==='--dest'&&args[i+1])destination=resolve(args[++i]);
  else throw Error('Usage: node scripts/install-skill.mjs [--dest SKILL_DIRECTORY] [--force]');
}
const target=destination||join(process.env.CODEX_HOME||join(homedir(),'.codex'),'skills','journal-lens');
let exists=false;try{await access(join(target,'SKILL.md'));exists=true;}catch{}
if(exists&&!force)throw Error('A journal-lens skill already exists at '+target+'. Use --force to update it, or --dest for another directory.');
await mkdir(target,{recursive:true});
const template=await readFile(join(root,'skills','journal-lens','SKILL.md'),'utf8');
await writeFile(join(target,'SKILL.md'),template.replaceAll('__JOURNAL_LENS_ROOT__',root));
await cp(join(root,'skills','journal-lens','agents'),join(target,'agents'),{recursive:true});
console.log('Installed Journal Lens skill: '+target);
console.log('Project: '+root);
console.log('In a new Codex chat: Use $journal-lens to check a journal name or URL.');
