import type { Environment, EnvironmentStart, JsonValue, ToolResult } from "benchmark-core";
import type { Booking, HouseholdInput, MemoryEntry, ServiceOption } from "./types.js";
import { parseMemoryTask } from "./types.js";
import type { Task } from "benchmark-core";

const TOOL_SPECS = [
  {
    name: "search_options",
    description: "Search bookable options for a service (restaurant, activity, transport).",
    parameters: {
      type: "object" as const,
      properties: { service: { type: "string" }, query: { type: "string" } },
      required: ["service"],
      additionalProperties: false,
    },
  },
  {
    name: "book",
    description: "Book an option for a household member.",
    parameters: {
      type: "object" as const,
      properties: {
        optionId: { type: "string" },
        memberId: { type: "string" },
        service: { type: "string" },
      },
      required: ["optionId", "memberId", "service"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel",
    description: "Cancel an existing booking by id.",
    parameters: {
      type: "object" as const,
      properties: { bookingId: { type: "string" } },
      required: ["bookingId"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_user",
    description: "Ask a household member a clarifying question.",
    parameters: {
      type: "object" as const,
      properties: { memberId: { type: "string" }, message: { type: "string" } },
      required: ["memberId", "message"],
      additionalProperties: false,
    },
  },
  {
    name: "read_memory",
    description: "Read stored memories for the household (optionally filter by query).",
    parameters: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "write_memory",
    description: "Store a new household memory entry.",
    parameters: {
      type: "object" as const,
      properties: {
        memberId: { type: "string" },
        text: { type: "string" },
        scope: { type: "string" },
      },
      required: ["memberId", "text", "scope"],
      additionalProperties: false,
    },
  },
];

function activeMemories(memories: MemoryEntry[], today: string, written: MemoryEntry[]): MemoryEntry[] {
  const all = [...memories, ...written];
  return all.filter((m) => {
    if (m.validThrough && m.validThrough < today) return false;
    if (all.some((other) => other.supersedesMemoryId === m.id && (!other.validThrough || other.validThrough >= today))) {
      return false;
    }
    return true;
  });
}

export class HouseholdEnvironment implements Environment {
  #input!: HouseholdInput;
  #bookings: Booking[] = [];
  #writtenMemories: MemoryEntry[] = [];
  #asked = new Set<string>();
  #nextBooking = 1;

  reset(task: Task, _seed: number): EnvironmentStart {
    const parsed = parseMemoryTask(task);
    this.#input = parsed.input;
    this.#bookings = parsed.input.bookings.map((b) => ({ ...b }));
    this.#writtenMemories = [];
    this.#asked = new Set();
    this.#nextBooking = 100;
    const member = this.#input.members.find((m) => m.id === this.#input.requesterId);
    const requester = member?.name ?? "the user";
    return {
      system: `You are a household assistant for ${this.#input.householdId}. The current member speaking is ${requester}. Use tools to read memory, clarify conflicts, cancel stale bookings, and book only reversible reservations. Today is ${this.#input.today}.`,
      tools: TOOL_SPECS,
    };
  }

  callTool(name: string, args: Record<string, JsonValue>): ToolResult {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return { result: null, error: { code: "INVALID_ARGUMENTS", message: "Tool arguments must be an object." } };
    }
    switch (name) {
      case "search_options":
        return this.#searchOptions(args);
      case "book":
        return this.#book(args);
      case "cancel":
        return this.#cancel(args);
      case "ask_user":
        return this.#askUser(args);
      case "read_memory":
        return this.#readMemory(args);
      case "write_memory":
        return this.#writeMemory(args);
      default:
        return { result: null, error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` } };
    }
  }

  #searchOptions(args: Record<string, JsonValue>): ToolResult {
    const service = String(args.service ?? "");
    const query = String(args.query ?? "").toLowerCase();
    const options = this.#input.options.filter((o) => o.service === service && (!query || o.label.toLowerCase().includes(query) || o.tags.some((t) => t.includes(query))));
    return { result: { options: options.map((o) => ({ id: o.id, label: o.label, tags: o.tags })) } };
  }

  #book(args: Record<string, JsonValue>): ToolResult {
    const optionId = String(args.optionId ?? "");
    const memberId = String(args.memberId ?? "");
    const service = String(args.service ?? "");
    const option = this.#input.options.find((o) => o.id === optionId && o.service === service);
    const member = this.#input.members.find((m) => m.id === memberId);
    if (!option) return { result: null, error: { code: "NOT_FOUND", message: "Option not found." } };
    if (!member) return { result: null, error: { code: "NOT_FOUND", message: "Member not found." } };
    const id = `bk-${this.#nextBooking++}`;
    const booking: Booking = { id, optionId, memberId, service, status: "active" };
    this.#bookings.push(booking);
    return { result: { booking } };
  }

  #cancel(args: Record<string, JsonValue>): ToolResult {
    const bookingId = String(args.bookingId ?? "");
    const booking = this.#bookings.find((b) => b.id === bookingId);
    if (!booking) return { result: null, error: { code: "NOT_FOUND", message: "Booking not found." } };
    booking.status = "cancelled";
    return { result: { booking } };
  }

  #askUser(args: Record<string, JsonValue>): ToolResult {
    const memberId = String(args.memberId ?? "");
    const message = String(args.message ?? "");
    const member = this.#input.members.find((m) => m.id === memberId);
    if (!member) return { result: null, error: { code: "NOT_FOUND", message: "Member not found." } };
    this.#asked.add(memberId);
    return { result: { delivered: true, memberId, message } };
  }

  #readMemory(args: Record<string, JsonValue>): ToolResult {
    const query = String(args.query ?? "").toLowerCase();
    const memories = activeMemories(this.#input.memories, this.#input.today, this.#writtenMemories);
    const visible = memories.filter((m) => !query || m.text.toLowerCase().includes(query));
    return {
      result: {
        memories: visible.map((m) => ({
          id: m.id,
          memberId: m.memberId,
          text: m.text,
          scope: m.scope,
        })),
      },
    };
  }

  #writeMemory(args: Record<string, JsonValue>): ToolResult {
    const memberId = String(args.memberId ?? "");
    const text = String(args.text ?? "");
    const scope = String(args.scope ?? "shared");
    if (!this.#input.members.some((m) => m.id === memberId)) {
      return { result: null, error: { code: "NOT_FOUND", message: "Member not found." } };
    }
    if (scope !== "private" && scope !== "shared") {
      return { result: null, error: { code: "INVALID_SCOPE", message: "Scope must be private or shared." } };
    }
    const entry: MemoryEntry = { id: `wm-${this.#writtenMemories.length + 1}`, memberId, text, scope: scope as "private" | "shared" };
    this.#writtenMemories.push(entry);
    return { result: { memory: entry } };
  }

  state() {
    const active = this.#bookings.filter((b) => b.status === "active");
    return {
      bookings: this.#bookings,
      activeBookings: active,
      askedMemberIds: [...this.#asked],
      writtenMemories: this.#writtenMemories,
    };
  }

  done(): boolean {
    return false;
  }
}

export function findOption(input: HouseholdInput, optionId: string | null): ServiceOption | undefined {
  if (!optionId) return undefined;
  return input.options.find((o) => o.id === optionId);
}
