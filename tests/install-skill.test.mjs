import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const scratch=await mkdtemp(join(tmpdir(),'journal-lens-install-'));
try{
  const target=join(scratch,'skill with spaces');
  const invoke=extra=>spawnSync(process.execPath,[join(root,'scripts/install-skill.mjs'),'--dest',target,...extra],{encoding:'utf8'});
  assert.equal(invoke([]).status,0);
  const installed=await readFile(join(target,'SKILL.md'),'utf8');
  assert.ok(installed.includes(root));assert.ok(!installed.includes('__JOURNAL_LENS_ROOT__'));assert.match(installed,/name: journal-lens/);
  await writeFile(join(target,'SKILL.md'),'existing instructions');
  assert.notEqual(invoke([]).status,0);assert.equal(await readFile(join(target,'SKILL.md'),'utf8'),'existing instructions');
  assert.equal(invoke(['--force']).status,0);assert.match(await readFile(join(target,'SKILL.md'),'utf8'),/name: journal-lens/);
  assert.match(await readFile(join(target,'agents/openai.yaml'),'utf8'),/display_name: "Journal Lens"/);
}finally{await rm(scratch,{recursive:true,force:true});}
console.log('Portable skill installation, overwrite protection and forced update passed.');
