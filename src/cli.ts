#!/usr/bin/env node
import { createCli, serve } from "benchmark-core";
import { createBenchmark } from "./benchmark.js";
import { createApiHandler } from "./api.js";
import { startMcp } from "./mcp.js";

// `--tasks <path>` selects another task split for any command. serve and mcp
// are handled here so the split reaches the API and MCP surfaces too.
const argv = process.argv.slice(2);
const cleaned: string[] = [];
let tasksPath: string | undefined;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (arg === "--tasks") { tasksPath = argv[++i]; }
  else if (arg.startsWith("--tasks=")) { tasksPath = arg.slice("--tasks=".length); }
  else cleaned.push(arg);
}
if (argv.includes("--tasks") && tasksPath === undefined) {
  console.error("--tasks needs a path.");
  process.exitCode = 1;
} else {
  const split = tasksPath !== undefined;
  const bench = split ? createBenchmark({ tasksPath: tasksPath! }) : createBenchmark();
  const command = cleaned[0];
  if (command === "serve") {
    const hostIndex = cleaned.indexOf("--host");
    const port = Number(cleaned[1] && /^\d+$/.test(cleaned[1]) ? cleaned[1] : process.env.PORT ?? 3000);
    const hostname = (hostIndex >= 0 ? cleaned[hostIndex + 1] : undefined) ?? "127.0.0.1";
    await serve(createApiHandler(bench, { strip: split }), { port, hostname });
    console.log(`Listening on http://${hostname}:${port}`);
    process.exitCode = 0;
  } else if (command === "mcp") {
    await startMcp(bench, { strip: split });
    process.exitCode = 0;
  } else {
    process.exitCode = await createCli(bench, { bin: "benchmark-memory-conflict" }).main(cleaned);
  }
}
