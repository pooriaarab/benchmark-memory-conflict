# Memory Conflict provenance

This file is generated from the benchmark definition.

## Seeded household conversation generator

- Kind: `synthetic`
- URL: https://github.com/pooriaarab/benchmark-memory-conflict/blob/main/scripts/gen-tasks.mjs
- Licence: `MIT`
- Retrieved: 2026-10-16T00:00:00.000Z
- How to get it: Run `node scripts/gen-tasks.mjs --seed 20261015` from the repository root.
- Contamination notes: Public tasks use seed 20261015. A separately seeded hidden split is added in a follow-up change; this revision only accepts `--split public`.
- Refresh: Edit templates in scripts/gen-tasks.mjs, regenerate, and review the JSONL diff.

## Household conflict catalog

- Kind: `human-written`
- URL: https://github.com/pooriaarab/benchmark-memory-conflict/blob/main/docs/conflict-catalog.md
- Licence: `MIT`
- Retrieved: 2026-10-16T00:00:00.000Z
- How to get it: Read docs/conflict-catalog.md in this repository.
- Contamination notes: Trap labels are maintainer-written; tasks are synthetic from templates.
- Refresh: Extend the catalog and generator templates together.
