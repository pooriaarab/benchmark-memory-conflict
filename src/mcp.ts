import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { run, openrouterAdapter, type Benchmark, type Task } from "benchmark-core";
import { benchmark, createBenchmark } from "./benchmark.js";
import { publicTask, resolveAllowedTasksPath } from "./task-source.js";

const withTasks = (schema: Record<string, unknown>) => ({ type: "object" as const, properties: { ...schema, tasks: { type: "string", description: "Optional task split path (inside the package or in BMC_TASKS_ALLOW)." } }, additionalProperties: false });

const tools = [
  { name: "list_tasks", description: "List benchmark task ids and prompts.", inputSchema: withTasks({}) },
  { name: "get_task", description: "Get one benchmark task.", inputSchema: { ...withTasks({ taskId: { type: "string" } }), required: ["taskId"] } },
  { name: "score_answer", description: "Score a trace with the deterministic benchmark grader.", inputSchema: { ...withTasks({ taskId: { type: "string" }, submission: { type: "object" }, seed: { type: "number" } }), required: ["taskId", "submission"] } },
  { name: "run_benchmark", description: "Run every task through an OpenRouter model.", inputSchema: { type: "object" as const, properties: { model: { type: "string" } }, required: ["model"], additionalProperties: false } },
  { name: "get_provenance", description: "Get benchmark data provenance.", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false } },
];

const content = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) });
const args = (value: unknown) => (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const view = (tasks: readonly Task[], strip: boolean) => strip ? tasks.map(publicTask) : tasks;

// Wrap a benchmark as an MCP server; `strip` drops answer fields from every
// served task (used when the server itself runs on a non-default split).
export function createMcpServer(base: Benchmark = benchmark, { strip = false }: { strip?: boolean } = {}) {
  const server = new Server({ name: base.definition.id, version: base.definition.version }, { capabilities: { tools: {} } });
  const alts = new Map<string, Benchmark>();
  const pickBenchmark = async (input: Record<string, unknown>): Promise<{ bench: Benchmark; strip: boolean }> => {
    if (input.tasks === undefined) return { bench: base, strip };
    if (typeof input.tasks !== "string") throw new Error("tasks must be a path string.");
    const resolved = resolveAllowedTasksPath(input.tasks);
    let bench = alts.get(resolved);
    if (!bench) { bench = createBenchmark({ tasksPath: resolved }); alts.set(resolved, bench); }
    return { bench, strip: true };
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const input = args(request.params.arguments);
      if (request.params.name === "list_tasks") {
        const { bench, strip } = await pickBenchmark(input);
        return content({ tasks: view(await bench.listTasks(), strip) });
      }
      if (request.params.name === "get_task") {
        if (typeof input.taskId !== "string") return content({ error: "taskId is required." }, true);
        const { bench, strip } = await pickBenchmark(input);
        const task = await bench.getTask(input.taskId);
        return task ? content({ task: view([task], strip)[0] }) : content({ error: "Task not found." }, true);
      }
      if (request.params.name === "score_answer") {
        if (typeof input.taskId !== "string" || !input.submission || typeof input.submission !== "object" || Array.isArray(input.submission)) return content({ error: "taskId and submission are required." }, true);
        const { bench } = await pickBenchmark(input);
        const task = await bench.getTask(input.taskId);
        return task ? content({ taskId: task.id, ...await bench.score(task, input.submission as Parameters<Benchmark["score"]>[1], typeof input.seed === "number" ? { seed: input.seed } : {}) }) : content({ error: "Task not found." }, true);
      }
      if (request.params.name === "run_benchmark") {
        if (typeof input.model !== "string") return content({ error: "model is required." }, true);
        if (!process.env.OPENROUTER_API_KEY) return content({ error: "OPENROUTER_API_KEY is required to run a benchmark." }, true);
        return content(await run(base, openrouterAdapter({ model: input.model })));
      }
      if (request.params.name === "get_provenance") return content({ provenance: base.definition.provenance });
      return content({ error: `Unknown tool: ${request.params.name}` }, true);
    } catch (caught) {
      return content({ error: caught instanceof Error ? caught.message : "Unknown error." }, true);
    }
  });
  return server;
}

export const startMcp = async (base: Benchmark = benchmark, options?: { strip?: boolean }) => {
  await createMcpServer(base, options).connect(new StdioServerTransport());
};
