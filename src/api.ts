import { createHandler, type Benchmark, type Task } from "benchmark-core";
import { benchmark, createBenchmark } from "./benchmark.js";
import { publicTask, resolveAllowedTasksPath } from "./task-source.js";

const json = (value: unknown, status: number, cors: boolean) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...(cors ? { "access-control-allow-origin": "*" } : {}) } });

// Tasks served off a non-default split lose expected/metadata.referenceTrace.
async function stripResponse(response: Response, request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" || (url.pathname !== "/v1/tasks" && !url.pathname.startsWith("/v1/tasks/"))) return response;
  if (!response.ok) return response;
  const body = await response.json() as { tasks?: Task[]; task?: Task };
  if (Array.isArray(body.tasks)) body.tasks = body.tasks.map(publicTask);
  if (body.task) body.task = publicTask(body.task);
  return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
}

// createApiHandler wraps the benchmark-core handler: a `?tasks=<path>` query
// selects another split (inside the package or in BMC_TASKS_ALLOW).
export function createApiHandler(base: Benchmark, { strip = false }: { strip?: boolean } = {}) {
  const baseHandler = createHandler(base);
  const altHandlers = new Map<string, (request: Request) => Promise<Response>>();
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const tasksParam = url.searchParams.get("tasks");
    if (!tasksParam) {
      const response = await baseHandler(request);
      return strip ? stripResponse(response, request) : response;
    }
    let resolved: string;
    try { resolved = resolveAllowedTasksPath(tasksParam); }
    catch (error) { return json({ error: { code: "FORBIDDEN_TASKS", message: error instanceof Error ? error.message : String(error) } }, 403, request.method === "GET"); }
    let handler = altHandlers.get(resolved);
    if (!handler) { handler = createHandler(createBenchmark({ tasksPath: resolved })); altHandlers.set(resolved, handler); }
    return stripResponse(await handler(request), request);
  };
}

export const handler = createApiHandler(benchmark);
