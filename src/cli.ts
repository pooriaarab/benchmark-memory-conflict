#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { bootstrapCI, createCli, mockAdapter, openaiCompatAdapter, openrouterAdapter, renderMarkdown, run, serve, type Benchmark, type ModelAdapter, type RunReport, type Task } from "benchmark-core";
import { createBenchmark } from "./benchmark.js";
import { createApiHandler } from "./api.js";
import { startMcp } from "./mcp.js";
import { attachMetrics, metricsLine, type MetricTotals } from "./report-metrics.js";

// `--tasks <path>` selects another task split for any command. serve, mcp,
// run and score are handled here so the split and the metric totals reach
// the API, MCP and report surfaces too.
const argv = process.argv.slice(2);
const cleaned: string[] = [];
let tasksPath: string | undefined;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (arg === "--tasks") { tasksPath = argv[++i]; }
  else if (arg.startsWith("--tasks=")) { tasksPath = arg.slice("--tasks=".length); }
  else cleaned.push(arg);
}

function adapter(provider: string | undefined, model: string | undefined, bench: Benchmark<Task>, seed: number): ModelAdapter {
  if (!model || !provider) throw new Error("run needs --model and --provider.");
  if (provider === "mock") return mockAdapter({ seed, ...(bench.definition.mockPolicies ? { policies: bench.definition.mockPolicies } : {}) });
  if (provider === "openrouter") return openrouterAdapter({ model });
  if (provider === "openai") return openaiCompatAdapter({ model });
  throw new Error("--provider must be openrouter, openai, or mock.");
}

const show = (report: RunReport, jsonOutput: boolean) =>
  console.log(jsonOutput ? JSON.stringify(report) : `${renderMarkdown(report)}\nMetrics: ${metricsLine(report.totals as Partial<MetricTotals>)}`);

async function main() {
  if (argv.includes("--tasks") && tasksPath === undefined) {
    console.error("--tasks needs a path.");
    return 1;
  }
  const split = tasksPath !== undefined;
  const bench = split ? createBenchmark({ tasksPath: tasksPath! }) : createBenchmark();
  const command = cleaned[0];
  const jsonOutput = cleaned.includes("--json");
  const args = cleaned.slice(1).filter((a) => a !== "--json");
  if (command === "serve") {
    const hostIndex = cleaned.indexOf("--host");
    const port = Number(args[0] && /^\d+$/.test(args[0]) ? args[0] : process.env.PORT ?? 3000);
    const hostname = (hostIndex >= 0 ? cleaned[hostIndex + 1] : undefined) ?? "127.0.0.1";
    await serve(createApiHandler(bench, { strip: split }), { port, hostname });
    console.log(`Listening on http://${hostname}:${port}`);
    return 0;
  }
  if (command === "mcp") {
    await startMcp(bench, { strip: split });
    return 0;
  }
  if (command === "run") {
    const parsed = parseArgs({ args, options: { model: { type: "string" }, provider: { type: "string" }, concurrency: { type: "string" }, timeout: { type: "string" }, retries: { type: "string" }, seed: { type: "string" }, "max-turns": { type: "string" }, "max-tool-calls": { type: "string" }, budget: { type: "string" } }, strict: true });
    const seed = Number(parsed.values.seed ?? 1);
    const result = await attachMetrics(bench, await run(bench, adapter(parsed.values.provider, parsed.values.model, bench, seed), {
      ...(parsed.values.concurrency ? { concurrency: Number(parsed.values.concurrency) } : {}),
      ...(parsed.values.timeout ? { timeoutMs: Number(parsed.values.timeout) } : {}),
      ...(parsed.values.retries ? { retries: Number(parsed.values.retries) } : {}),
      seed,
      ...(parsed.values["max-turns"] ? { maxTurns: Number(parsed.values["max-turns"]) } : {}),
      ...(parsed.values["max-tool-calls"] ? { maxToolCalls: Number(parsed.values["max-tool-calls"]) } : {}),
      ...(parsed.values.budget ? { budgetUsd: Number(parsed.values.budget) } : {}),
    }));
    show(result, jsonOutput);
    return result.rows.some((row) => row.error) ? 2 : 0;
  }
  if (command === "score") {
    const file = args[0];
    if (!file) throw new Error("score needs a results JSON file.");
    const original = JSON.parse(await readFile(file, "utf8")) as RunReport;
    if (!original || typeof original !== "object" || !Array.isArray(original.rows)) throw new Error("File is not a run report.");
    const totals: MetricTotals = { staleMemoryUsed: 0, privacyLeak: 0, askedWhenNeeded: 0 };
    const rows = [];
    for (const row of original.rows) {
      const task = await bench.getTask(row.taskId);
      if (!task || row.submission === undefined) throw new Error(`Cannot score task ${row.taskId}.`);
      const grade = await bench.score(task, row.submission, { seed: original.seed });
      if (grade.details && typeof grade.details === "object" && !Array.isArray(grade.details)) {
        const flags = grade.details as unknown as MetricTotals;
        if (flags.staleMemoryUsed) totals.staleMemoryUsed += 1;
        if (flags.privacyLeak) totals.privacyLeak += 1;
        if (flags.askedWhenNeeded) totals.askedWhenNeeded += 1;
      }
      rows.push({ ...row, score: grade.score, reason: grade.reason, details: grade.details });
    }
    const scores = rows.map((row) => row.score);
    show({ ...original, rows, mean: scores.reduce((a, b) => a + b, 0) / scores.length, confidenceInterval95: bootstrapCI(scores, original.seed), totals: { ...original.totals, ...totals } }, jsonOutput);
    return 0;
  }
  return createCli(bench, { bin: "benchmark-memory-conflict" }).main(cleaned);
}

try {
  process.exitCode = await main();
} catch (caught) {
  console.error(caught instanceof Error ? caught.message : String(caught));
  process.exitCode = 2;
}
