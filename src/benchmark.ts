import { defineBenchmark, type ScriptedTurn, type Task, type ToolLogEntry } from "benchmark-core";
import { gradeMemoryConflict, HouseholdEnvironment } from "./household-environment.js";
import { loadTasks as loadTaskRows } from "./task-source.js";

export interface TaskSource {
  tasksPath?: string;
  tasks?: Task[];
}

function referenceTrace(task: Task): ToolLogEntry[] {
  const trace = task.metadata?.referenceTrace;
  if (!Array.isArray(trace)) return [];
  return trace.map((row) => {
    const entry = row as { name: string; args?: Record<string, unknown> };
    return { name: entry.name, args: (entry.args ?? {}) as Record<string, import("benchmark-core").JsonValue>, result: {} };
  });
}

function traceToTurns(trace: ToolLogEntry[]): ScriptedTurn[] {
  const turns: ScriptedTurn[] = trace.map((entry) => ({ toolCalls: [{ name: entry.name, args: entry.args }] }));
  turns.push({ content: "Booked with the latest household preferences." });
  return turns;
}

// Every call builds a fresh benchmark object: benchmark-core caches the task
// list per object, so a new object is the only way to switch splits.
export function createBenchmark(source: TaskSource = {}) {
  if (source.tasksPath && source.tasks) throw new Error("Pass tasksPath or tasks, not both.");
  return defineBenchmark({
    id: "benchmark-memory-conflict", name: "Memory Conflict", tagline: "Changing preferences and household disagreements in an assistant's memory.", tags: ["helpful"], category: "agents",
    whatItMeasures: "Whether an assistant applies the latest valid household preference, respects privacy and authority, and keeps bookings reversible.",
    version: "0.1.0", status: "alpha", loadTasks: async () => source.tasks ?? loadTaskRows(source.tasksPath),
    async grade(task, submission, context) { return gradeMemoryConflict(task, submission, context.seed); },
    environment: () => new HouseholdEnvironment(),
    mockPolicies: {
      good: (task) => traceToTurns(referenceTrace(task)),
      bad: (task) => {
        const input = task.input as { requesterId?: string; options?: Array<{ id: string; service: string }> } | undefined;
        const expected = task.expected as { bookOptionId?: string; staleIfBookOptionIds?: string[]; forbiddenLeaks?: Array<{ phrases?: string[]; substring?: string; recipientIds: string[] }> } | undefined;
        const memberId = input?.requesterId ?? "unknown";
        const service = input?.options?.[0]?.service ?? "activity";
        const wrongOption = expected?.staleIfBookOptionIds?.[0] ?? input?.options?.find((o) => o.id !== expected?.bookOptionId)?.id ?? "none";
        const trap = task.metadata?.trap;
        const turns: ScriptedTurn[] = [{ toolCalls: [{ name: "read_memory", args: {} }] }];
        if (trap === "private_note") {
          const rule = expected?.forbiddenLeaks?.[0];
          const recipient = rule?.recipientIds?.[0] ?? memberId;
          const phrase = rule?.phrases?.[0] ?? rule?.substring ?? "private note";
          turns.push({ toolCalls: [{ name: "ask_user", args: { memberId: recipient, message: `Quick check about the ${phrase} before I book.` } }] });
        }
        const optionId = trap === "authority_unclear" || trap === "private_note" ? expected?.bookOptionId ?? wrongOption : wrongOption;
        turns.push({ toolCalls: [{ name: "book", args: { optionId, memberId, service } }] }, { content: "Done." });
        return turns;
      },
    },
    provenance: [{
      name: "Seeded household conversation generator", kind: "synthetic", url: "https://github.com/pooriaarab/benchmark-memory-conflict/blob/main/scripts/gen-tasks.mjs",
      licence: "MIT", howToGet: "Run `node scripts/gen-tasks.mjs --seed 20261015` from the repository root.", retrievedAt: "2026-10-16T00:00:00.000Z",
      contaminationNotes: "Public tasks use seed 20261015; public release cutoff 2026-10-15 and no PerMemBench text copied. Hidden split: `node scripts/gen-tasks.mjs --seed <unpublished> --split hidden` (never committed). The hidden template profile ships in this repository, so the split is protected only by the unpublished seed, not by content isolation.",
      refresh: "Edit templates in scripts/gen-tasks.mjs, regenerate, and review the JSONL diff.",
    }, {
      name: "Household conflict catalog", kind: "human-written", url: "https://github.com/pooriaarab/benchmark-memory-conflict/blob/main/docs/conflict-catalog.md",
      licence: "MIT", howToGet: "Read docs/conflict-catalog.md in this repository.", retrievedAt: "2026-10-16T00:00:00.000Z",
      contaminationNotes: "Trap labels are maintainer-written; tasks are synthetic from templates.", refresh: "Extend the catalog and generator templates together.",
    }],
    gradingMethod: "Deterministic simulator replay; see docs/grading.md.", shareCardTitle: "Memory Conflict",
  });
}

export const benchmark = createBenchmark();
