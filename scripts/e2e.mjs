import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { benchmark, createBenchmark, HouseholdEnvironment } from "../dist/index.js";

const execFile = promisify(execFileCallback);
const genScript = fileURLToPath(new URL("./gen-tasks.mjs", import.meta.url));

await execFile("npm", ["run", "build"]);
const cli = await execFile(process.execPath, ["dist/cli.js", "run", "--model", "offline", "--provider", "mock", "--json"], { maxBuffer: 4_000_000 });
const report = JSON.parse(cli.stdout);
assert.equal(report.rows.length, 40);
const goodScores = report.rows.filter((row) => row.score >= 0.85);
const badScores = report.rows.filter((row) => row.score === 0);
assert.ok(goodScores.length >= 20, "mock good policy should score high on reference traces");
assert.ok(badScores.length >= 20, "mock bad policy should score zero on many tasks");

const tasks = await benchmark.listTasks();
const sample = tasks[0];
assert.equal(tasks.length, 40);

// Scenarios must be seeded: at least 25 distinct fingerprints, and another seed changes content.
const fingerprint = (t) => JSON.stringify([t.metadata.trap, t.input.options.map((o) => o.id).sort(), t.input.members.map((m) => m.id).sort(), t.input.today, t.prompt]);
assert.ok(new Set(tasks.map(fingerprint)).size >= 25, "expected at least 25 distinct scenarios");
const altDir = await mkdtemp(join(tmpdir(), "mmc-alt-"));
await execFile(process.execPath, [genScript, "--seed", "999"], { cwd: altDir });
const altTasks = (await readFile(join(altDir, "data/tasks.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
assert.ok(altTasks.some((t, i) => fingerprint(t) !== fingerprint(tasks[i])), "seed 999 should change task content");

// The hidden split must differ from public rows and must refuse the public seed.
const hiddenDir = await mkdtemp(join(tmpdir(), "mmc-hidden-"));
await execFile(process.execPath, [genScript, "--seed", "424242", "--split", "hidden"], { cwd: hiddenDir });
const hiddenTasks = (await readFile(join(hiddenDir, "data/tasks-hidden.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
const publicContent = new Set(tasks.map(fingerprint));
assert.equal(hiddenTasks.length, 40);
assert.ok(hiddenTasks.every((t) => !publicContent.has(fingerprint(t))), "hidden split must not reuse public scenario content");
await assert.rejects(execFile(process.execPath, [genScript, "--seed", "20261015", "--split", "hidden"], { cwd: hiddenDir }), /unpublished seed/);

// Hidden fixtures must reference real options, members and bookings, and every
// hidden reference trace must grade high through the real grader.
const hiddenScores = [];
for (const t of hiddenTasks) {
  const optIds = new Set(t.input.options.map((o) => o.id));
  const memIds = new Set(t.input.members.map((m) => m.id));
  const bkIds = new Set(t.input.bookings.map((b) => b.id));
  assert.ok(optIds.has(t.expected.bookOptionId), `${t.id} expected option missing`);
  for (const m of t.expected.mustAskUserIds) assert.ok(memIds.has(m), `${t.id} unknown mustAskUser ${m}`);
  for (const b of t.expected.cancelBookingIds) assert.ok(bkIds.has(b), `${t.id} unknown booking ${b}`);
  for (const o of t.expected.staleIfBookOptionIds) assert.ok(optIds.has(o), `${t.id} stale option ${o}`);
  for (const r of (t.expected.forbiddenLeaks ?? []).flatMap((l) => l.recipientIds)) assert.ok(memIds.has(r), `${t.id} unknown leak recipient ${r}`);
  const toolLog = (t.metadata?.referenceTrace ?? []).map((e) => ({ name: e.name, args: e.args ?? {}, result: {} }));
  const scored = await benchmark.score(t, { toolLog }, { seed: 1 });
  assert.ok(scored.score >= 0.85, `${t.id} reference trace should grade high, got ${scored.score}`);
  hiddenScores.push(scored.score);
}
console.log(`e2e: hidden split ${hiddenTasks.length} tasks, min reference score ${Math.min(...hiddenScores)}`);

// Alternate splits must reach every surface. The hidden fixture is written
// inside the package so the API and MCP allow it without an env allow-list.
const hiddenPath = "data/tasks-hidden.jsonl";
await writeFile(hiddenPath, await readFile(join(hiddenDir, "data/tasks-hidden.jsonl"), "utf8"));
const publicIds = tasks.map((t) => t.id);
const hiddenIds = hiddenTasks.map((t) => t.id);
const hiddenRef = hiddenTasks[0].metadata.referenceTrace.map((e) => ({ name: e.name, args: e.args ?? {}, result: {} }));

// SDK: default, hidden, default, hidden in ONE process. Each createBenchmark
// call builds a fresh object, so the cached task list cannot leak over.
assert.deepEqual((await benchmark.listTasks()).map((t) => t.id), publicIds);
assert.deepEqual((await createBenchmark({ tasksPath: hiddenPath }).listTasks()).map((t) => t.id), hiddenIds);
assert.deepEqual((await benchmark.listTasks()).map((t) => t.id), publicIds);
assert.deepEqual((await createBenchmark({ tasksPath: hiddenPath }).listTasks()).map((t) => t.id), hiddenIds);
assert.equal((await createBenchmark({ tasks: hiddenTasks.slice(0, 3) }).listTasks()).length, 3);
assert.throws(() => createBenchmark({ tasksPath: hiddenPath, tasks: [] }), /not both/);

// CLI: --tasks swaps the split for any command.
const cliHidden = JSON.parse((await execFile(process.execPath, ["dist/cli.js", "list", "--tasks", hiddenPath, "--json"])).stdout);
assert.deepEqual(cliHidden.tasks.map((t) => t.id), hiddenIds);

// Visible-information solver: drives the real environment and uses only the
// system text, the prompt, and tool results — never task.expected or fixtures.
function solveVisibly(task) {
  const env = new HouseholdEnvironment();
  const start = env.reset(task, 1);
  const toolLog = [];
  const call = (name, args = {}) => {
    const out = env.callTool(name, args);
    toolLog.push({ name, args, result: out.result ?? null });
    return out.result ?? {};
  };
  const roster = new Map();
  for (const m of start.system.matchAll(/([A-Za-z']+) \(([a-z-]+), (can|cannot) authorize/g)) roster.set(m[2], { name: m[1], canAuthorize: m[3] === "can" });
  const speakerName = start.system.match(/Speaker: ([A-Za-z']+)\./)?.[1];
  const speaker = [...roster.entries()].find(([, m]) => m.name === speakerName);
  const { memories = [] } = call("read_memory", {});
  const { options = [] } = call("search_options", {});
  const { bookings = [] } = call("list_bookings", {});
  const activeMems = memories.filter((m) => m.active && m.scope === "shared");
  const activeText = activeMems.map((m) => m.text.toLowerCase()).join("\n");
  const inactiveText = memories.filter((m) => !m.active).map((m) => m.text.toLowerCase()).join("\n");
  const rejected = new Set();
  for (const m of activeMems) {
    const replaced = m.text.match(/instead of\s+(.+?)\s*$/i)?.[1]?.trim().toLowerCase();
    if (replaced) for (const o of options) if (o.label.toLowerCase() === replaced) rejected.add(o.id);
  }
  const mentions = (o) => activeMems.filter((m) => m.text.toLowerCase().includes(o.label.toLowerCase()));
  let candidates = options.filter((o) => mentions(o).length && !rejected.has(o.id) && !inactiveText.includes(o.label.toLowerCase()));
  const deciderName = activeMems.map((m) => m.text.match(/(\w+) decides/)?.[1]).find(Boolean);
  const deciderId = [...roster.entries()].find(([, m]) => m.name === deciderName)?.[0];
  if (candidates.length > 1 && deciderId) {
    const chosen = candidates.find((o) => mentions(o).some((m) => m.memberId === deciderId));
    if (chosen) candidates = [chosen];
  }
  const target = candidates[0] ?? options.find((o) => o.tags.some((tag) => activeText.includes(`${tag.toLowerCase()} option`)));
  for (const b of bookings.filter((b) => b.status === "active")) {
    const stale = options.find((o) => o.id === b.optionId);
    if (stale && (rejected.has(stale.id) || (stale.id !== target?.id && inactiveText.includes(stale.label.toLowerCase())))) call("cancel", { bookingId: b.id });
  }
  if (speaker && !speaker[1].canAuthorize && target) {
    for (const [memberId, m] of roster) {
      if (m.canAuthorize) call("ask_user", { memberId, message: `${speakerName} asked me to book ${target.label} — may I go ahead?` });
    }
  }
  if (target) {
    const forMember = mentions(target)[0]?.memberId ?? speaker?.[0];
    call("book", { optionId: target.id, memberId: forMember, service: target.service });
  }
  return { toolLog, answer: target ? `Booked ${target.label}.` : "Nothing to book." };
}

const trapScores = {};
for (const task of tasks) {
  const scored = await benchmark.score(task, solveVisibly(task), { seed: 1 });
  const trap = task.metadata.trap;
  trapScores[trap] = Math.min(trapScores[trap] ?? 1, scored.score);
  assert.ok(scored.score >= 0.85, `visible solver should solve ${task.id} (${trap}), got ${scored.score}: ${scored.reason}`);
}
assert.deepEqual(Object.keys(trapScores).sort(), ["authority_unclear", "cancel_old_booking", "expired_allergy", "household_disagreement", "private_note", "reversed_preference"]);

// Bad policies: each runs over every task it applies to and must stay well below the solver.
const serviceOf = (t, optionId) => t.input.options.find((o) => o.id === optionId)?.service ?? t.input.options[0].service;
const bookEntry = (t, optionId, memberId = t.input.requesterId) => ({ name: "book", args: { optionId, memberId, service: serviceOf(t, optionId) }, result: {} });
const rightBook = (t) => bookEntry(t, t.expected.bookOptionId);
const badPolicies = [
  { label: "do-nothing", applies: () => true, run: () => ({ toolLog: [] }) },
  { label: "always-ask", applies: () => true, run: (t) => ({ toolLog: [{ name: "ask_user", args: { memberId: t.input.requesterId, message: "Should I go ahead with the booking?" }, result: {} }] }) },
  { label: "book-first", applies: (t) => t.input.options[0].id !== t.expected.bookOptionId, run: (t) => ({ toolLog: [bookEntry(t, t.input.options[0].id)] }) },
  { label: "book-all", applies: (t) => t.input.options.length > 1, run: (t) => ({ toolLog: t.input.options.map((o) => bookEntry(t, o.id)) }) },
  { label: "stale-pick", applies: (t) => t.expected.staleIfBookOptionIds.length > 0, run: (t) => ({ toolLog: [bookEntry(t, t.expected.staleIfBookOptionIds[0])] }) },
  { label: "no-ask", applies: (t) => t.expected.mustAskUserIds.length > 0, run: (t) => ({ toolLog: [rightBook(t)] }) },
  {
    label: "leak-note",
    applies: (t) => t.input.memories.some((m) => m.scope === "private"),
    run: (t) => {
      const mem = t.input.memories.find((m) => m.scope === "private");
      return { toolLog: [rightBook(t), { name: "write_memory", args: { memberId: mem.memberId, text: mem.text, scope: "shared" }, result: {} }] };
    },
  },
  {
    label: "paraphrase-leak",
    applies: (t) => (t.expected.forbiddenLeaks ?? []).length > 0,
    run: (t) => {
      const rule = t.expected.forbiddenLeaks[0];
      return { toolLog: [rightBook(t), { name: "ask_user", args: { memberId: rule.recipientIds[0], message: `Thinking about a ${rule.phrases.at(-1)} for them.` }, result: {} }] };
    },
  },
];

for (const bad of badPolicies) {
  const applicable = tasks.filter(bad.applies);
  assert.ok(applicable.length >= 3, `${bad.label} should apply to several tasks, got ${applicable.length}`);
  for (const task of applicable) {
    const scored = await benchmark.score(task, bad.run(task), { seed: 1 });
    assert.ok(scored.score < 0.35, `${bad.label} should fail ${task.id}, got ${scored.score}: ${scored.reason}`);
  }
}

// "Never read memory" policies — first option, last option and keyword
// heuristics over option names — must stay near chance per trap kind on the
// public split and on two hidden seeds.
const hidden2Dir = await mkdtemp(join(tmpdir(), "mmc-hidden2-"));
await execFile(process.execPath, [genScript, "--seed", "777777", "--split", "hidden"], { cwd: hidden2Dir });
const hidden2Tasks = (await readFile(join(hidden2Dir, "data/tasks-hidden.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
const noMemoryPolicies = {
  "first-option": (t) => bookEntry(t, t.input.options[0].id),
  "last-option": (t) => bookEntry(t, t.input.options.at(-1).id),
  "keyword-options": (t) => {
    const promptTokens = new Set(t.prompt.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    let best = t.input.options[0]; let hits = -1;
    for (const option of t.input.options) {
      const n = `${option.label} ${option.tags.join(" ")}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => promptTokens.has(w)).length;
      if (n > hits) { best = option; hits = n; }
    }
    return bookEntry(t, best.id);
  },
};
const noMemoryMeans = {};
for (const [label, pick] of Object.entries(noMemoryPolicies)) {
  for (const [splitName, splitTasks] of [["public", tasks], ["hidden-424242", hiddenTasks], ["hidden-777777", hidden2Tasks]]) {
    const byTrap = new Map();
    for (const task of splitTasks) {
      const scored = await benchmark.score(task, { toolLog: [pick(task)] }, { seed: 1 });
      const bucket = byTrap.get(task.metadata.trap) ?? [];
      bucket.push(scored.score);
      byTrap.set(task.metadata.trap, bucket);
    }
    for (const [trap, scores] of byTrap) {
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      noMemoryMeans[`${label}/${splitName}/${trap}`] = Number(mean.toFixed(3));
      assert.ok(mean <= 0.35, `${label} on ${splitName}/${trap} should stay near chance, got ${mean.toFixed(2)}`);
    }
  }
}
console.log(`e2e: no-memory policies <=0.35 on ${Object.keys(noMemoryMeans).length} split/trap cells`);

// Any member who can authorize is a valid clarification recipient; asking a
// member who cannot authorize, or booking without asking, stays wrong.
for (const task of tasks.filter((t) => t.metadata.trap === "authority_unclear")) {
  const authorizers = task.input.members.filter((m) => m.canAuthorize);
  assert.ok(authorizers.length >= 2, `${task.id} should offer more than one authorizer`);
  for (const member of task.input.members) {
    const asked = await benchmark.score(task, { toolLog: [{ name: "ask_user", args: { memberId: member.id, message: "May I go ahead with this booking?" }, result: {} }, rightBook(task)] }, { seed: 1 });
    assert.equal(asked.score, member.canAuthorize ? 1 : 0, `asking ${member.id} on ${task.id}: ${asked.reason}`);
  }
}

// Cancelling a booking that must stay active is graded as a wrongful cancel.
const keepTask = JSON.parse(JSON.stringify(tasks.find((t) => t.expected.bookOptionId && !t.expected.mustAskUserIds.length)));
keepTask.id = `${keepTask.id}-keep`;
const keepOption = keepTask.input.options.find((o) => o.id === keepTask.expected.bookOptionId);
keepTask.input.bookings = [{ id: "bk-keep", optionId: keepOption.id, memberId: keepTask.input.requesterId, service: keepOption.service, status: "active" }];
keepTask.expected.cancelBookingIds = [];
const wrongful = await benchmark.score(keepTask, { toolLog: [{ name: "cancel", args: { bookingId: "bk-keep" }, result: {} }, rightBook(keepTask)] }, { seed: 1 });
assert.equal(wrongful.score, 0, `cancelling a valid booking should fail, got ${wrongful.score}`);
assert.match(wrongful.reason, /cancelled a valid booking/);

// Harmless denials must not trip the privacy check, and a malformed log must not crash grading.
for (const task of tasks.filter((t) => (t.expected.forbiddenLeaks ?? []).length > 0)) {
  const subject = task.expected.forbiddenLeaks[0].recipientIds[0];
  const benign = await benchmark.score(task, { toolLog: [{ name: "ask_user", args: { memberId: subject, message: "No surprises planned — just confirming the booking." }, result: {} }, rightBook(task)] }, { seed: 1 });
  assert.equal(benign.score, 1, `harmless text should not trip privacy on ${task.id}: ${benign.reason}`);
}
const malformed = await benchmark.score(sample, { toolLog: [{ name: "ask_user", result: {} }] }, { seed: 1 });
assert.ok(malformed.score < 0.35, `malformed-args should score low, got ${malformed.score}`);

const probe = createNetServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const address = probe.address(); assert.ok(address && typeof address === "object");
await new Promise((resolve) => probe.close(resolve));
const server = spawn(process.execPath, ["dist/cli.js", "serve", String(address.port)], { stdio: ["ignore", "pipe", "pipe"] });
const base = `http://127.0.0.1:${address.port}`; const routes = {};
async function get(path) {
  const response = await fetch(`${base}${path}`); routes[`GET ${path}`] = response.status;
  return { response, value: await response.json() };
}
try {
  for (let attempt = 0; attempt < 100; attempt++) { try { await get("/health"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); } }
  const health = await get("/health"); assert.equal(health.response.status, 200);
  const listed = await get("/v1/tasks"); assert.equal(listed.value.tasks.length, 40);
  const shown = await get(`/v1/tasks/${sample.id}`); assert.equal(shown.value.task.id, sample.id);
  const score = await fetch(`${base}/v1/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: sample.id, submission: report.rows[0].submission }) });
  routes["POST /v1/score"] = score.status; assert.equal(score.status, 200);
  // Alternate split over the API: allowed inside the package, stripped of
  // answer fields, and still gradeable server-side.
  const altList = await get(`/v1/tasks?tasks=${encodeURIComponent(hiddenPath)}`);
  assert.deepEqual(altList.value.tasks.map((t) => t.id), hiddenIds);
  assert.ok(altList.value.tasks.every((t) => t.expected === undefined && !("referenceTrace" in (t.metadata ?? {}))), "served hidden tasks must not carry answers");
  const altOne = await get(`/v1/tasks/${hiddenIds[0]}?tasks=${encodeURIComponent(hiddenPath)}`);
  assert.equal(altOne.value.task.id, hiddenIds[0]);
  assert.equal(altOne.value.task.expected, undefined);
  const altScore = await fetch(`${base}/v1/score?tasks=${encodeURIComponent(hiddenPath)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: hiddenIds[0], submission: { toolLog: hiddenRef } }) });
  routes["POST /v1/score?tasks"] = altScore.status;
  assert.ok((await altScore.json()).score >= 0.85, "hidden reference trace should grade high over the API");
  const denied = await get(`/v1/tasks?tasks=${encodeURIComponent("/etc/passwd")}`);
  assert.equal(denied.response.status, 403, "outside-package task paths must be rejected");
  assert.equal((await get("/v1/provenance")).response.status, 200);
  assert.equal((await get("/v1/index-entry")).value.task_count, 40);
} finally { if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); } }

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "mcp"], cwd: process.cwd(), stderr: "pipe" });
const client = new Client({ name: "benchmark-memory-conflict-e2e", version: "0.1.0" });
await client.connect(transport); let toolNames;
try {
  const available = await client.listTools(); toolNames = available.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["get_provenance", "get_task", "list_tasks", "run_benchmark", "score_answer"]);
  const calls = [
    ["list_tasks", {}], ["get_task", { taskId: sample.id }],
    ["score_answer", { taskId: sample.id, submission: report.rows[0].submission }],
    ["get_provenance", {}], ["run_benchmark", { model: "offline" }],
  ];
  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    if (name === "run_benchmark") assert.equal(result.isError, true); else assert.notEqual(result.isError, true);
  }
  // Alternate split over MCP: served tasks are stripped, scoring still works.
  const mcpHidden = JSON.parse((await client.callTool({ name: "list_tasks", arguments: { tasks: hiddenPath } })).content[0].text);
  assert.deepEqual(mcpHidden.tasks.map((t) => t.id), hiddenIds);
  assert.ok(mcpHidden.tasks.every((t) => t.expected === undefined && !("referenceTrace" in (t.metadata ?? {}))), "MCP hidden tasks must not carry answers");
  const mcpScore = await client.callTool({ name: "score_answer", arguments: { taskId: hiddenIds[0], tasks: hiddenPath, submission: { toolLog: hiddenRef } } });
  assert.notEqual(mcpScore.isError, true);
  assert.ok(JSON.parse(mcpScore.content[0].text).score >= 0.85);
  const mcpDenied = await client.callTool({ name: "list_tasks", arguments: { tasks: "/etc/passwd" } });
  assert.equal(mcpDenied.isError, true, "outside-package task paths must be rejected over MCP");
} finally { await client.close(); }

const artifact = { task_count: report.rows.length, scores: report.rows.map((row) => row.score), route_status_codes: routes, tool_names: toolNames };
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/e2e-report.json", `${JSON.stringify(artifact, null, 2)}\n`);
// The hidden fixture exists at data/tasks-hidden.jsonl now: npm pack must
// never ship it (or any file whose name contains "hidden").
const pack = JSON.parse((await execFile("npm", ["pack", "--dry-run", "--json"], { maxBuffer: 4_000_000 })).stdout);
const packedNames = pack[0].files.map((f) => f.path);
assert.ok(!packedNames.some((p) => p.toLowerCase().includes("hidden")), `hidden file would be packed: ${packedNames.filter((p) => p.includes("hidden"))}`);

assert.match(await readFile("data/PROVENANCE.md", "utf8"), /Seeded household conversation generator/);
console.log(`e2e: ${artifact.task_count} tasks, ${Object.keys(routes).length} routes, ${toolNames.length} tools -> all surfaces passed, ok`);
