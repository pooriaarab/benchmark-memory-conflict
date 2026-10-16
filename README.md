# benchmark-memory-conflict

[![npm](https://img.shields.io/npm/v/benchmark-memory-conflict)](https://www.npmjs.com/package/benchmark-memory-conflict) [![downloads](https://img.shields.io/npm/dm/benchmark-memory-conflict)](https://www.npmjs.com/package/benchmark-memory-conflict) [![license](https://img.shields.io/npm/l/benchmark-memory-conflict)](./LICENSE) [![types](https://img.shields.io/badge/TypeScript-types-3178c6)](#sdk)

[AI Benchmark Index](https://private-repo-337e.com/benchmarks/benchmark-memory-conflict) · [npm](https://www.npmjs.com/package/benchmark-memory-conflict) · [API](#http-api) · [MCP](#model-context-protocol)

benchmark-memory-conflict measures whether an assistant keeps household bookings aligned with the **latest** valid memory: reversed preferences, disagreements between adults, private notes, expired allergies, cancel-first rules, and who may authorize spend.

```bash
npx benchmark-memory-conflict run --model offline --provider mock --json
```

```json
{"model":"mock:1","mean":0.5,"confidenceInterval95":{"low":0.35,"high":0.65},"totals":{"tasks":40,"passed":20,"failed":0}}
```

The mock run above uses the committed reference traces (20 tasks score 1, 20 score 0). Real models need OpenRouter or an OpenAI-compatible endpoint.

## Install

Node.js 20 or newer.

```bash
npm install benchmark-memory-conflict
```

## Run your first benchmark

```bash
npx benchmark-memory-conflict run --model offline --provider mock
```

Offline mock needs no API key. For a live model:

```bash
export OPENROUTER_API_KEY=...
npx benchmark-memory-conflict run --model anthropic/claude-sonnet-4 --provider openrouter
```

## What the score means

Each episode replays tool calls in a household simulator (`search_options`, `book`, `cancel`, `ask_user`, `read_memory`, `write_memory`). The grader checks:

- Final booking matches the newest valid preference
- Required cancellations happened
- Private memories never leak through `ask_user`
- Adults are consulted when a teen cannot authorize spend

Per-task details include `staleMemoryUsed`, `privacyLeak`, and `askedWhenNeeded`. See [docs/grading.md](./docs/grading.md).

## How it works

```text
tasks.jsonl -> model adapter -> household simulator replay -> report
                         |-> CLI / SDK / MCP / HTTP API
```

## Data provenance

Forty synthetic household episodes are generated from MIT templates:

```bash
node scripts/gen-tasks.mjs --seed 20261015
```

`data/PROVENANCE.md` documents the public seed, hidden split command, and refresh cadence. Trap labels live in [docs/conflict-catalog.md](./docs/conflict-catalog.md). All conversation text is fictional (CC0-style).

**Prior art:** [PerMemBench](https://arxiv.org/abs/2402.17746) studies long-term personal memory; this package focuses on **conflicting** household preferences with deterministic booking-state grading and no LLM judge.

## Compare

| Property | benchmark-memory-conflict | General chat leaderboard |
| --- | --- | --- |
| Target | Memory conflict + consent in bookings | Broad quality |
| Grading | Deterministic simulator replay | Varies |
| Offline mock | Yes | Varies |
| Provenance | Generator + catalog in-repo | Varies |

## SDK

```ts
import { benchmark, createBenchmark, run, score } from "benchmark-memory-conflict";
```

`createBenchmark({ tasksPath })` or `createBenchmark({ tasks })` builds a fresh benchmark over another task split (a cached task list never leaks between objects).

## CLI

`list`, `show`, `run`, `score`, `card`, `provenance`, `index-entry`, `serve`, `mcp`. Pass `--json` for machine-readable output. Any command takes `--tasks <path>` to run against another split file.

## Model Context Protocol

```bash
npx benchmark-memory-conflict mcp
```

Tools: `list_tasks`, `get_task`, `score_answer`, `run_benchmark`, `get_provenance`. `list_tasks`, `get_task` and `score_answer` take an optional `tasks` path to reach another split.

## HTTP API

`handler` from `benchmark-memory-conflict/api`, or `npx benchmark-memory-conflict serve`.

Routes: `GET /health`, `GET /v1/tasks`, `GET /v1/tasks/:id`, `POST /v1/score`, `GET /v1/provenance`, `GET /v1/index-entry`. `?tasks=<path>` selects another split; the path must sit inside the package or in the `BMC_TASKS_ALLOW` env list. Served non-default tasks omit `expected` and `metadata.referenceTrace`.

## Limits

No public leaderboard yet (no OpenRouter runs from this repo). Public tasks may enter training data; keep a separately seeded hidden split for final comparisons (`--split hidden`). Grading does not judge natural-language quality beyond tool effects.

## Status

Version 0.1.0, alpha. Task traps and grading weights may change before 1.0.

## License

[MIT](LICENSE) © Pooria Arab

## Cite

Please cite this package with its Zenodo DOI. The DOI below names all versions. GitHub also shows a "Cite this repository" box from `CITATION.cff`.

```bibtex
@software{arab2026benchmarkmemoryconflict,
  author  = {Arab, Pooria},
  title   = {benchmark-memory-conflict},
  year    = {2026},
  version = {0.1.0},
  doi     = {10.5281/zenodo.23422400},
  url     = {https://private-repo-337e.com/benchmarks/benchmark-memory-conflict}
}
```
