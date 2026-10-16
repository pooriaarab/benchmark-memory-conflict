import { readFile } from "node:fs/promises";
import { delimiter, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "benchmark-core";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));
export const defaultTasksPath = resolve(packageRoot, "data/tasks.jsonl");

export async function loadTasks(tasksPath?: string): Promise<Task[]> {
  const text = await readFile(tasksPath ? resolve(tasksPath) : defaultTasksPath, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Task);
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

// A caller-supplied split path is allowed when it resolves inside the package
// or matches an entry (file or directory) of BMC_TASKS_ALLOW.
export function resolveAllowedTasksPath(requested: string, allow = process.env.BMC_TASKS_ALLOW): string {
  if (typeof requested !== "string" || !requested.trim()) throw new Error("Task split path must be a non-empty string.");
  const resolved = resolve(requested);
  if (inside(packageRoot, resolved)) return resolved;
  for (const entry of (allow ?? "").split(delimiter).filter(Boolean)) {
    const root = resolve(entry);
    if (resolved === root || inside(root, resolved)) return resolved;
  }
  throw new Error("Task split path must live inside the package or in BMC_TASKS_ALLOW.");
}

// Answer-bearing fields are stripped from tasks served off a non-default
// split; the grader still sees the full task server-side.
export function publicTask(task: Task): Task {
  const { expected: _expected, metadata, ...rest } = task;
  const cleaned = { ...metadata };
  delete cleaned.referenceTrace;
  return { ...rest, metadata: cleaned };
}
