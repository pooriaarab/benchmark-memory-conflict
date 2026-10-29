import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { benchmark, run } from '../../dist/index.js';
import { mockAdapter } from 'benchmark-core';
import { wilson, bootstrap, mean } from '../template/stats.mjs';
const hash = x => createHash('sha256').update(x).digest('hex');
const tasks = await benchmark.listTasks(), config = JSON.parse(await readFile('paper/config.json'));
const options = {seed:1, concurrency:1, retries:0, maxTurns:12, maxToolCalls:12, budgetUsd:0};
import { traceFor } from './traces.mjs';
function adapter(policy) {
  if (policy.startsWith('packaged-')) { const f = benchmark.definition.mockPolicies[policy.slice(9)]; return mockAdapter({seed:1,policies:{good:f,bad:f}}); }
  return {id:`script:${policy}`, complete:async()=>{throw Error('Episode required');}, async chat({messages,tools}, {task}) {
    const n = messages.filter(m => m.role === 'tool').length, text = {empty:'',constant:'OK',echo:task.prompt,refuse:'I cannot help with that request.'};
    if (policy in text) return {content:text[policy],toolCalls:[]};
    const entry = policy === 'first-tool' ? (n ? null : {name:tools[0].name,args:{}}) : traceFor(task,policy).toolLog[n];
    return entry ? {content:'',toolCalls:[{id:`call-${n}`,name:entry.name,args:entry.args}]} : {content:'Done.',toolCalls:[]};
  }};
}
const save = (name,x) => writeFile(`paper/data/${name}.generated.json`,JSON.stringify(x)+'\n');
await mkdir('paper/data',{recursive:true});
const sources = ['data/tasks.jsonl','package-lock.json','src/benchmark.ts','src/household-environment.ts','src/index.ts'];
for (const p of sources) assert.equal(hash(await readFile(p)),hash(execFileSync('git',['show',`${config.source_commit}:${p}`])),`Source changed: ${p}`);
const policies = ['empty','constant','echo','refuse','first-tool','packaged-good','packaged-bad','no-ask','no-cancel','stale-choice','leak','late-ask'];
const reports = [], repeats = [], semantic = r => r.rows.map(({taskId,submission,episode,score,reason})=>({taskId,submission,episode,score,reason}));
for (const policy of policies) {
  const report = await run(adapter(policy),options), repeat = await run(adapter(policy),options);
  for (const r of [report,repeat]) { assert.deepEqual(r.rows.map(x=>x.taskId),tasks.map(t=>t.id)); assert.ok(r.rows.every(x=>!x.error)); assert.equal(r.totals.costUsd,0); }
  const sha256 = hash(JSON.stringify(semantic(report))), repeatSha256 = hash(JSON.stringify(semantic(repeat)));
  assert.equal(sha256,repeatSha256); reports.push({policy,report}); repeats.push({policy,sha256,repeatSha256,repeat});
}
await save('runs',reports); await save('repeat',repeats);
const traps = [...new Set(tasks.map(t=>t.metadata.trap))].sort(), stats = [];
for (const {policy,report} of reports) {
  const rows = await Promise.all(report.rows.map(async(r,i)=>({taskId:r.taskId,trap:tasks[i].metadata.trap,...await benchmark.score(tasks[i],r.submission,{seed:1})})));
  rows.forEach((r,i)=>assert.equal(r.score,report.rows[i].score));
  const rate = (rs,f) => wilson(rs.filter(f).length,rs.length), askRows = rows.filter((_,i)=>tasks[i].expected.mustAskUserIds.length);
  stats.push({policy,pass:rate(rows,r=>r.score===1),stale:rate(rows,r=>r.details.staleMemoryUsed),leak:rate(rows,r=>r.details.privacyLeak),ask:rate(askRows,r=>r.details.askedWhenNeeded),strata:traps.map(trap=>({trap,...rate(rows.filter(r=>r.trap===trap),r=>r.score===1)}))});
}
const controls = ['none','authority','privacy','cancellation','all'], probabilities = [0,.25,.5,.75,1], simulations = [];
const mutation = {authority_unclear:'no-ask',cancel_old_booking:'no-cancel',private_note:'leak'};
const layer = {authority_unclear:'authority',cancel_old_booking:'cancellation',private_note:'privacy'};
for (let seed=1;seed<=30;seed++) {
  let state=seed; const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
  const draws = tasks.map(()=>random());
  for (const q of probabilities) for (const control of controls) for (const [i,t] of tasks.entries()) {
    const injected=draws[i]<q, repaired=control==='all'||control===layer[t.metadata.trap];
    const policy=injected&&!repaired ? mutation[t.metadata.trap]??'stale-choice' : 'reference';
    const result=await benchmark.score(t,traceFor(t,policy),{seed:1});
    simulations.push({seed,q,control,taskId:t.id,policy,score:result.score,details:result.details});
  }
}
await save('simulation',simulations);
const simulation = [], contrasts = [];
for (const q of probabilities) {
  const means = control => Array.from({length:30},(_,i)=>mean(simulations.filter(r=>r.q===q&&r.control===control&&r.seed===i+1).map(r=>r.score)));
  for (const control of controls) simulation.push({q,control,...bootstrap([means(control)],gs=>mean(gs[0]))});
  const full=means('all'),none=means('none'); contrasts.push({q,...bootstrap([full.map((x,i)=>x-none[i])],gs=>mean(gs[0]))});
}
const coverage=traps.map(trap=>({trap,count:tasks.filter(t=>t.metadata.trap===trap).length}));
await save('summary',{tasks:tasks.length,conditions:policies.length,episodes:tasks.length*policies.length*2,simulatedTraces:simulations.length,seeds:30,coverage,stats,simulation,contrasts,options,costUsd:0,repeatIdentical:true,freeModels:{status:'not-run',reason:'Free hosted inference was not configured; provider availability was not tested.'}});
const files=[...sources,'paper/PREREG.md','paper/scripts/run.mjs','paper/scripts/traces.mjs','paper/template/stats.mjs'];
await save('provenance',{source_commit:config.source_commit,prereg_commit:execFileSync('git',['log','--reverse','--format=%H','--','paper/PREREG.md'],{encoding:'utf8'}).trim().split('\n')[0],node:process.version,files:Object.fromEntries(await Promise.all(files.map(async p=>[p,hash(await readFile(p))]))),semanticHashes:repeats.map(({policy,sha256})=>({policy,sha256}))});
console.log(`Completed ${reports.length*2*tasks.length} runner episodes and ${simulations.length} simulated traces; repeats agree; API cost USD 0.`);
