import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { benchmark } from "../dist/index.js";

const execFile = promisify(execFileCallback);

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
const badCases = [
  { label: "empty", submission: { toolLog: [] } },
  {
    label: "stale-booking",
    submission: {
      toolLog: [
        { name: "book", args: { optionId: sample.expected.staleIfBookOptionIds?.[0] ?? sample.input.options.find((o) => o.id !== sample.expected.bookOptionId)?.id, memberId: sample.input.requesterId, service: sample.input.options[0].service }, result: {} },
      ],
    },
  },
  {
    label: "privacy-leak",
    submission: {
      toolLog: [
        { name: "ask_user", args: { memberId: "ben", message: "Ben secretly hates surprise parties — still book?" }, result: {} },
      ],
    },
  },
  { label: "malformed-args", submission: { toolLog: [{ name: "ask_user", result: {} }] } },
  {
    label: "no-ask",
    submission: {
      toolLog: tasks
        .filter((t) => t.expected?.mustAskUserIds?.length)
        .slice(0, 1)
        .flatMap((t) => [
          { name: "book", args: { optionId: t.expected.bookOptionId, memberId: t.input.requesterId, service: t.input.options[0].service }, result: {} },
        ]),
    },
  },
];

for (const bad of badCases) {
  if (!bad.submission.toolLog?.length && bad.label !== "empty") continue;
  const task = bad.label === "no-ask" ? tasks.find((t) => t.expected?.mustAskUserIds?.length) : sample;
  const scored = await benchmark.score(task, bad.submission, { seed: 1 });
  assert.ok(scored.score < 0.35, `${bad.label} should score low, got ${scored.score}`);
}

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
