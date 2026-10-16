import type { Task } from "benchmark-core";

export interface HouseholdMember {
  id: string;
  name: string;
  canAuthorize: boolean;
}

export interface MemoryEntry {
  id: string;
  memberId: string;
  text: string;
  scope: "private" | "shared";
  /** ISO date; omitted means still valid */
  validThrough?: string;
  /** When set, this memory replaces the referenced older row */
  supersedesMemoryId?: string;
}

export interface ServiceOption {
  id: string;
  service: string;
  label: string;
  tags: string[];
}

export interface Booking {
  id: string;
  optionId: string;
  memberId: string;
  service: string;
  status: "active" | "cancelled";
}

export interface HouseholdInput {
  householdId: string;
  members: HouseholdMember[];
  memories: MemoryEntry[];
  options: ServiceOption[];
  bookings: Booking[];
  /** Member speaking in the final user message */
  requesterId: string;
  /** Simulated calendar day for expiry checks */
  today: string;
}

export interface ExpectedOutcome {
  bookOptionId: string | null;
  cancelBookingIds: string[];
  mustAskUserIds: string[];
  /** Private substrings that must not appear in ask_user to these recipients */
  forbiddenLeaks: Array<{ substring: string; recipientIds: string[] }>;
  staleIfBookOptionIds: string[];
}

export interface ParsedMemoryTask {
  task: Task;
  input: HouseholdInput;
  expected: ExpectedOutcome;
}

export function parseMemoryTask(task: Task): ParsedMemoryTask {
  if (!task.input || typeof task.input !== "object" || Array.isArray(task.input)) {
    throw new Error(`Task ${task.id} missing household input.`);
  }
  if (!task.expected || typeof task.expected !== "object" || Array.isArray(task.expected)) {
    throw new Error(`Task ${task.id} missing expected rubric.`);
  }
  return {
    task,
    input: task.input as unknown as HouseholdInput,
    expected: task.expected as unknown as ExpectedOutcome,
  };
}
