import { readFile } from "node:fs/promises";
import { defineBenchmark, type ScriptedTurn, type Task, type ToolLogEntry } from "benchmark-core";
import { gradeMemoryConflict } from "./grade.js";
import { HouseholdEnvironment } from "./household-environment.js";

async function loadTasks(): Promise<Task[]> {
  const text = await readFile(new URL("../data/tasks.jsonl", import.meta.url), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Task);
}

function referenceTrace(task: Task): ToolLogEntry[] {
  const trace = task.metadata?.referenceTrace;
  if (!Array.isArray(trace)) return [];
  return trace.map((row) => {
    const entry = row as { name: string; args?: Record<string, unknown> };
    return {
      name: entry.name,
      args: (entry.args ?? {}) as Record<string, import("benchmark-core").JsonValue>,
      result: {},
    };
  });
}

function traceToTurns(trace: ToolLogEntry[]): ScriptedTurn[] {
  const turns: ScriptedTurn[] = trace.map((entry) => ({ toolCalls: [{ name: entry.name, args: entry.args }] }));
  turns.push({ content: "Booked with the latest household preferences." });
  return turns;
}

export const benchmark = defineBenchmark({
  id: "benchmark-memory-conflict",
  name: "Memory Conflict",
  tagline: "Changing preferences and household disagreements in an assistant's memory.",
  tags: ["helpful"],
  category: "agents",
  whatItMeasures:
    "Whether an assistant applies the latest valid household preference, respects privacy and authority, and keeps bookings reversible.",
  version: "0.1.0",
  status: "alpha",
  loadTasks,
  async grade(task, submission, context) {
    return gradeMemoryConflict(task, submission, context.seed);
  },
  environment: () => new HouseholdEnvironment(),
  mockPolicies: {
    good: (task) => traceToTurns(referenceTrace(task)),
    bad: (task) => {
      const trace = referenceTrace(task);
      if (!trace.length) return [{ content: "No tools." }];
      const first = trace[0]!;
      if (task.metadata?.trap === "authority_unclear") {
        return traceToTurns(trace.filter((t) => t.name !== "ask_user"));
      }
      if (task.metadata?.trap === "private_note") {
        const book = trace.find((t) => t.name === "book");
        const turns = [
          ...traceToTurns(trace.filter((t) => t.name !== "book")),
          {
            toolCalls: [
              {
                name: "ask_user",
                args: {
                  memberId: "ben",
                  message: "Should we plan a surprise party with steak?",
                },
              },
            ],
          },
        ];
        if (book) turns.push({ toolCalls: [{ name: book.name, args: book.args }] });
        return turns;
      }
      return traceToTurns([first]);
    },
  },
  provenance: [
    {
      name: "Seeded household conversation generator",
      kind: "synthetic",
      url: "https://github.com/pooriaarab/benchmark-memory-conflict/blob/main/scripts/gen-tasks.mjs",
      licence: "MIT",
      howToGet: "Run `node scripts/gen-tasks.mjs --seed 20261015` from the repository root.",
      retrievedAt: "2026-10-16T00:00:00.000Z",
      contaminationNotes:
        "Public tasks use seed 20261015. Hidden evaluation split: `node scripts/gen-tasks.mjs --seed 20261015 --split hidden` (not committed). Cutoff 2026-10-15.",
      refresh: "Edit templates in scripts/gen-tasks.mjs, regenerate, and review the JSONL diff.",
    },
    {
      name: "Household conflict catalog",
      kind: "human-written",
      url: "https://github.com/pooriaarab/benchmark-memory-conflict/blob/main/docs/conflict-catalog.md",
      licence: "MIT",
      howToGet: "Read docs/conflict-catalog.md in this repository.",
      retrievedAt: "2026-10-16T00:00:00.000Z",
      contaminationNotes: "Trap labels are maintainer-written; tasks are synthetic from templates.",
      refresh: "Extend the catalog and generator templates together.",
    },
  ],
  gradingMethod: "Deterministic simulator replay; see docs/grading.md.",
  shareCardTitle: "Memory Conflict",
});
