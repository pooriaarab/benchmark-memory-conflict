import { run as runBenchmark, type ModelAdapter, type RunOptions, type Trace } from "benchmark-core";
import { benchmark } from "./benchmark.js";
export { benchmark, createBenchmark } from "./benchmark.js";
export type { TaskSource } from "./benchmark.js";
export { HouseholdEnvironment } from "./household-environment.js";
export { loadTasks, publicTask, resolveAllowedTasksPath } from "./task-source.js";
export const run = (adapter: ModelAdapter, options?: RunOptions) => runBenchmark(benchmark, adapter, options);
export async function score(taskId: string, submission: Trace) {
  const task = await benchmark.getTask(taskId); if (!task) throw new Error(`Task not found: ${taskId}`);
  return benchmark.score(task, submission);
}
