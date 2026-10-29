export function traceFor(t, policy) {
  let trace = structuredClone(t.metadata.referenceTrace);
  if (policy === 'no-ask') trace = trace.filter(x => x.name !== 'ask_user');
  if (policy === 'no-cancel') trace = trace.filter(x => x.name !== 'cancel');
  if (policy === 'late-ask') trace = [...trace.filter(x => x.name !== 'ask_user'), ...trace.filter(x => x.name === 'ask_user')];
  if (policy === 'stale-choice' && t.expected.staleIfBookOptionIds.length) {
    const o = t.input.options.find(o => o.id === t.expected.staleIfBookOptionIds[0]);
    trace = trace.map(x => x.name === 'book' ? {...x, args:{...x.args, optionId:o.id, service:o.service}} : x);
  }
  if (policy === 'leak') for (const m of t.input.memories.filter(m => m.scope === 'private')) trace.push({name:'write_memory',args:{memberId:m.memberId,scope:'shared',text:m.text}});
  return {answer:'Done.', toolLog:trace.map(x => ({...x,result:{}}))};
}
