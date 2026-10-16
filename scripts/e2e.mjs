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
import { benchmark, HouseholdEnvironment } from "../dist/index.js";

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
} finally { await client.close(); }

const artifact = { task_count: report.rows.length, scores: report.rows.map((row) => row.score), route_status_codes: routes, tool_names: toolNames };
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/e2e-report.json", `${JSON.stringify(artifact, null, 2)}\n`);
assert.match(await readFile("data/PROVENANCE.md", "utf8"), /Seeded household conversation generator/);
console.log(`e2e: ${artifact.task_count} tasks, ${Object.keys(routes).length} routes, ${toolNames.length} tools -> all surfaces passed, ok`);
