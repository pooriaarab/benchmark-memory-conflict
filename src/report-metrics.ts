import type { Benchmark, JsonValue, RunReport, Task } from "benchmark-core";

export interface MetricTotals { staleMemoryUsed: number; privacyLeak: number; askedWhenNeeded: number }
export type ReportWithMetrics = RunReport & { totals: RunReport["totals"] & MetricTotals };

// Re-grade every submitted row and fold the grader's per-task detail flags
// (staleMemoryUsed, privacyLeak, askedWhenNeeded) into row.details and
// report.totals, matching what POST /v1/score returns per task.
export async function attachMetrics(bench: Benchmark<Task>, report: RunReport): Promise<ReportWithMetrics> {
  const totals: MetricTotals = { staleMemoryUsed: 0, privacyLeak: 0, askedWhenNeeded: 0 };
  for (const row of report.rows) {
    if (!row.submission) continue;
    const task = await bench.getTask(row.taskId);
    if (!task) continue;
    const { details } = await bench.score(task, row.submission, { seed: report.seed });
    const flags = details && typeof details === "object" && !Array.isArray(details) ? details as Record<string, JsonValue> : {};
    (row as typeof row & { details?: Record<string, JsonValue> }).details = flags;
    if (flags.staleMemoryUsed) totals.staleMemoryUsed += 1;
    if (flags.privacyLeak) totals.privacyLeak += 1;
    if (flags.askedWhenNeeded) totals.askedWhenNeeded += 1;
  }
  (report as ReportWithMetrics).totals = { ...report.totals, ...totals };
  return report as ReportWithMetrics;
}

export const metricsLine = (totals: Partial<MetricTotals>) => `staleMemoryUsed: ${totals.staleMemoryUsed ?? 0}, privacyLeak: ${totals.privacyLeak ?? 0}, askedWhenNeeded: ${totals.askedWhenNeeded ?? 0}`;
