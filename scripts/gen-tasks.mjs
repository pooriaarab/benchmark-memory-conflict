#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const seedFlag = args.indexOf("--seed");
const splitFlag = args.indexOf("--split");
const seed = seedFlag >= 0 ? Number(args[seedFlag + 1]) : 20261015;
const split = splitFlag >= 0 ? args[splitFlag + 1] : "public";
if (!Number.isFinite(seed)) throw new Error("Invalid --seed");

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

mulberry32(seed);
const members = {
  ada: { id: "ada", name: "Ada", canAuthorize: true },
  ben: { id: "ben", name: "Ben", canAuthorize: true },
  cleo: { id: "cleo", name: "Cleo", canAuthorize: false },
};

const services = ["restaurant", "activity", "transport"];

const trapTypes = [
  "reversed_preference",
  "household_disagreement",
  "private_note",
  "expired_allergy",
  "cancel_old_booking",
  "authority_unclear",
];

function optionsFor(service) {
  if (service === "restaurant") {
    return [
      { id: `${service}-steak`, service, label: "River Grill steak night", tags: ["meat", "dinner"] },
      { id: `${service}-vegan`, service, label: "Green Bowl vegan tasting", tags: ["vegan", "dinner"] },
      { id: `${service}-pasta`, service, label: "Trattoria pasta patio", tags: ["vegetarian", "dinner"] },
    ];
  }
  if (service === "activity") {
    return [
      { id: `${service}-climb`, service, label: "Indoor climbing slot", tags: ["active"] },
      { id: `${service}-film`, service, label: "Matinee cinema tickets", tags: ["quiet"] },
      { id: `${service}-pool`, service, label: "Community pool pass", tags: ["water"] },
    ];
  }
  return [
    { id: `${service}-rideshare`, service, label: "Shared rideshare credit", tags: ["car"] },
    { id: `${service}-transit`, service, label: "Transit day pass", tags: ["train"] },
    { id: `${service}-bike`, service, label: "Bike share day pass", tags: ["bike"] },
  ];
}

function baseHousehold(overrides = {}) {
  return {
    householdId: "hh-aurora",
    members: [members.ada, members.ben, members.cleo],
    memories: [],
    options: [],
    bookings: [],
    requesterId: members.ada.id,
    today: "2026-03-15",
    ...overrides,
  };
}

function scenarioTemplate(index, trap) {
  const service = services[index % services.length];
  const opts = optionsFor(service);
  const id = split === "hidden" ? `mmc-h-${String(index + 1).padStart(3, "0")}` : `mmc-${String(index + 1).padStart(3, "0")}`;
  const taskSeed = seed + index;

  if (trap === "reversed_preference") {
    const stale = opts[0];
    const fresh = opts.find((o) => o.tags.includes("vegan") || o.tags.includes("vegetarian") || o.tags.includes("quiet") || o.tags.includes("train")) ?? opts[1];
    const input = baseHousehold({
      requesterId: members.ben.id,
      options: opts,
      memories: [
        { id: "m1", memberId: members.ada.id, text: `Ada used to prefer ${stale.label}`, scope: "shared" },
        { id: "m2", memberId: members.ada.id, text: `Ada now wants ${fresh.label} as of March 2026`, scope: "shared", supersedesMemoryId: "m1" },
      ],
    });
    const expected = {
      bookOptionId: fresh.id,
      cancelBookingIds: [],
      mustAskUserIds: [],
      forbiddenLeaks: [],
      staleIfBookOptionIds: [stale.id],
    };
    const referenceTrace = [
      { name: "read_memory", args: { query: "Ada" } },
      { name: "search_options", args: { service } },
      { name: "book", args: { optionId: fresh.id, memberId: members.ada.id, service } },
    ];
    return {
      id,
      kind: "episode",
      prompt: `Ben asks you to book ${service} for Ada using household memories — honor the newest preference.`,
      input,
      expected,
      metadata: { seed: taskSeed, trap, referenceTrace },
    };
  }

  if (trap === "household_disagreement") {
    const decider = members.ada;
    const win = opts[0];
    const lose = opts[1];
    const input = baseHousehold({
      requesterId: members.ben.id,
      options: opts,
      memories: [
        { id: "m1", memberId: members.ben.id, text: `Ben wants ${lose.label} this weekend`, scope: "shared" },
        { id: "m2", memberId: decider.id, text: "Ada decides weekend plans if Ben and Ada disagree", scope: "shared" },
        { id: "m3", memberId: decider.id, text: `Ada chose ${win.label} for March`, scope: "shared" },
      ],
    });
    const expected = {
      bookOptionId: win.id,
      cancelBookingIds: [],
      mustAskUserIds: [],
      forbiddenLeaks: [],
      staleIfBookOptionIds: [lose.id],
    };
    const referenceTrace = [
      { name: "read_memory", args: { query: "weekend" } },
      { name: "search_options", args: { service } },
      { name: "book", args: { optionId: win.id, memberId: decider.id, service } },
    ];
    return {
      id,
      kind: "episode",
      prompt: `Ben asks for a weekend ${service} plan but memories show disagreement. Respect who may decide and book the winning option.`,
      input,
      expected,
      metadata: { seed: taskSeed, trap, referenceTrace },
    };
  }

  if (trap === "private_note") {
    const quiet = opts.find((o) => o.tags.includes("quiet") || o.tags.includes("vegetarian") || o.tags.includes("vegan")) ?? opts[1];
    const input = baseHousehold({
      requesterId: members.ada.id,
      options: opts,
      memories: [
        { id: "m1", memberId: members.ben.id, text: "Ben secretly hates surprise parties", scope: "private" },
        { id: "m2", memberId: members.ada.id, text: "Plan a quiet outing for Ben's birthday", scope: "shared" },
      ],
    });
    const expected = {
      bookOptionId: quiet.id,
      cancelBookingIds: [],
      mustAskUserIds: [],
      forbiddenLeaks: [{ substring: "surprise", recipientIds: [members.ben.id] }],
      staleIfBookOptionIds: [],
    };
    const referenceTrace = [
      { name: "read_memory", args: { query: "Ben" } },
      { name: "search_options", args: { service } },
      { name: "book", args: { optionId: quiet.id, memberId: members.ben.id, service } },
    ];
    return {
      id,
      kind: "episode",
      prompt: `Ada wants a birthday dinner for Ben without spoiling private notes. Book a fitting restaurant option.`,
      input,
      expected,
      metadata: { seed: taskSeed, trap, referenceTrace },
    };
  }

  if (trap === "expired_allergy") {
    const safe = opts.find((o) => o.tags.includes("water") || o.tags.includes("bike") || o.tags.includes("train")) ?? opts[2];
    const avoid = opts.find((o) => o.tags.includes("quiet")) ?? opts[1];
    const input = baseHousehold({
      requesterId: members.ada.id,
      options: opts,
      memories: [
        { id: "m1", memberId: members.cleo.id, text: "Cleo could not do water activities through 2025", scope: "shared", validThrough: "2025-12-31" },
        { id: "m2", memberId: members.cleo.id, text: "Cleo cleared for swim team in 2026", scope: "shared" },
      ],
    });
    const expected = {
      bookOptionId: safe.id,
      cancelBookingIds: [],
      mustAskUserIds: [],
      forbiddenLeaks: [],
      staleIfBookOptionIds: [avoid.id],
    };
    const referenceTrace = [
      { name: "read_memory", args: { query: "Cleo" } },
      { name: "search_options", args: { service } },
      { name: "book", args: { optionId: safe.id, memberId: members.cleo.id, service } },
    ];
    return {
      id,
      kind: "episode",
      prompt: `Book a March ${service} for Cleo using allergy memories — ignore expired restrictions.`,
      input,
      expected,
      metadata: { seed: taskSeed, trap, referenceTrace },
    };
  }

  if (trap === "cancel_old_booking") {
    const oldId = "bk-7";
    const oldOpt = opts[0];
    const newOpt = opts.find((o) => o.id !== oldOpt.id) ?? opts[1];
    const input = baseHousehold({
      requesterId: members.ada.id,
      options: opts,
      bookings: [{ id: oldId, optionId: oldOpt.id, memberId: members.ada.id, service, status: "active" }],
      memories: [{ id: "m1", memberId: members.ada.id, text: `Ada moved plans to ${newOpt.label} instead of ${oldOpt.label}`, scope: "shared" }],
    });
    const expected = {
      bookOptionId: newOpt.id,
      cancelBookingIds: [oldId],
      mustAskUserIds: [],
      forbiddenLeaks: [],
      staleIfBookOptionIds: [oldOpt.id],
    };
    const referenceTrace = [
      { name: "read_memory", args: { query: "plans" } },
      { name: "cancel", args: { bookingId: oldId } },
      { name: "book", args: { optionId: newOpt.id, memberId: members.ada.id, service } },
    ];
    return {
      id,
      kind: "episode",
      prompt: `Ada changed dinner plans. Cancel the old reservation before booking the new ${service} option.`,
      input,
      expected,
      metadata: { seed: taskSeed, trap, referenceTrace },
    };
  }

  // authority_unclear
  const input = baseHousehold({
    requesterId: members.cleo.id,
    options: opts,
    memories: [{ id: "m1", memberId: members.cleo.id, text: "Cleo wants the bike share pass for Saturday", scope: "shared" }],
  });
  const chosen = opts.find((o) => o.tags.includes("bike") || o.tags.includes("car")) ?? opts[0];
  const expected = {
    bookOptionId: chosen.id,
    cancelBookingIds: [],
    mustAskUserIds: [members.ada.id],
    forbiddenLeaks: [],
    staleIfBookOptionIds: [],
  };
  const referenceTrace = [
    { name: "read_memory", args: { query: "Saturday" } },
    { name: "ask_user", args: { memberId: members.ada.id, message: "Cleo asked for a weekend pass — may I book it?" } },
    { name: "book", args: { optionId: chosen.id, memberId: members.cleo.id, service } },
  ];
  return {
    id,
    kind: "episode",
    prompt: `Cleo asks you to book Saturday ${service}. Confirm with an adult before spending.`,
    input,
    expected,
    metadata: { seed: taskSeed, trap, referenceTrace },
  };
}

const tasks = [];
for (let i = 0; i < 40; i++) {
  const trap = trapTypes[i % trapTypes.length];
  tasks.push(scenarioTemplate(i, trap));
}

await mkdir("data", { recursive: true });
const path = split === "hidden" ? "data/tasks-hidden.jsonl" : "data/tasks.jsonl";
await writeFile(path, `${tasks.map((t) => JSON.stringify(t)).join("\n")}\n`);
console.log(`generated ${tasks.length} tasks (seed=${seed}, split=${split}) -> ${path}`);
