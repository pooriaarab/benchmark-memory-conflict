import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { benchmark } from '../../dist/index.js';
import { traceFor } from './traces.mjs';
import { wilson,bootstrap,mean } from '../template/stats.mjs';
const read=async n=>JSON.parse(await readFile(`paper/data/${n}.generated.json`)), hash=x=>createHash('sha256').update(x).digest('hex');
const [runs,repeats,sims,s,p]=await Promise.all(['runs','repeat','simulation','summary','provenance'].map(read)),tasks=await benchmark.listTasks(),byId=new Map(tasks.map(t=>[t.id,t]));
const semantic=r=>r.rows.map(({taskId,submission,episode,score,reason})=>({taskId,submission,episode,score,reason}));
for(const [file,digest] of Object.entries(p.files)) assert.equal(hash(await readFile(file)),digest,file);
assert.equal(execFileSync('git',['show',`${p.prereg_commit}:paper/PREREG.md`],{encoding:'utf8'}),await readFile('paper/PREREG.md','utf8'));
for(const [i,{policy,report}] of runs.entries()) {
  assert.equal(hash(JSON.stringify(semantic(report))),repeats[i].sha256); assert.equal(hash(JSON.stringify(semantic(repeats[i].repeat))),repeats[i].repeatSha256); assert.equal(repeats[i].sha256,repeats[i].repeatSha256);
  assert.equal(new Set(report.rows.map(r=>r.taskId)).size,tasks.length);
  for(const r of report.rows) assert.equal((await benchmark.score(byId.get(r.taskId),r.submission,{seed:1})).score,r.score);
  assert.deepEqual(wilson(report.rows.filter(r=>r.score===1).length,tasks.length),s.stats.find(x=>x.policy===policy).pass);
}
assert.equal(sims.length,s.simulatedTraces); assert.equal(new Set(sims.map(r=>[r.seed,r.q,r.control,r.taskId].join(':'))).size,sims.length);
for(const r of sims) { const score=await benchmark.score(byId.get(r.taskId),traceFor(byId.get(r.taskId),r.policy),{seed:1}); assert.equal(score.score,r.score);assert.deepEqual(score.details,r.details); }
for(const cell of s.simulation) { const means=Array.from({length:s.seeds},(_,i)=>mean(sims.filter(r=>r.q===cell.q&&r.control===cell.control&&r.seed===i+1).map(r=>r.score))); const expected=bootstrap([means],gs=>mean(gs[0])); for(const k of ['value','low','high'])assert.equal(cell[k],expected[k]); }
const m=JSON.parse(await readFile('paper/meta.json')),c=JSON.parse(await readFile('paper/config.json')),body=await readFile('paper/paper.tex','utf8');
assert.equal(m.title,c.title);assert.deepEqual(m.authors,c.authors);assert.equal(m.license,'CC-BY-4.0');assert.ok(m.abstract.length<=1920&&/^[\x00-\x7f]*$/.test(m.abstract));assert.ok(!body.includes('\u2014'));assert.ok((await readFile('CITATION.cff','utf8')).includes(m.title));
const info=execFileSync('pdfinfo',[`paper/${m.artifact_name}`],{encoding:'utf8'}),pages=Number(info.match(/Pages:\s+(\d+)/)[1]),text=execFileSync('pdftotext',[`paper/${m.artifact_name}`,'-'],{encoding:'utf8'}),log=await readFile('paper/paper.log','utf8');
assert.ok(pages>=8);assert.ok(!/undefined (references|citations)|Overfull/.test(log));assert.ok(text.includes('simulated'));assert.ok(!text.includes('\u2014'));assert.equal((body.match(/\\input\{figures\//g)||[]).length,3);
await writeFile('paper/data/verification.generated.json',JSON.stringify({pages,scriptedEpisodes:s.episodes,simulatedTraces:sims.length,allScoresReplayed:true,repeatsIdentical:true,sourceHashesMatch:true,metadataValid:true,figures:3,undefinedReferences:false})+'\n');
console.log(`Verified ${pages} pages, ${s.episodes} scripted episodes, ${sims.length} simulated traces, three figures, and source hashes.`);
