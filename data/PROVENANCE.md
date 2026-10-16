# Data provenance

## Sources

| Name | Kind | Licence | How to obtain |
|---|---|---|---|
| Seeded household conversation generator | synthetic | MIT | `node scripts/gen-tasks.mjs --seed 20261015` |
| Household conflict catalog | human-written | MIT | `docs/conflict-catalog.md` |

## Public split

- **Seed:** `20261015`
- **Tasks:** 40 episode scenarios in `data/tasks.jsonl`
- **Generator:** `scripts/gen-tasks.mjs`

Every seeded draw flows through `mulberry32(seed)`: trap placement, service, option draw, member names, dates, and booking ids. A different `--seed` produces a different public task set.

## Hidden split

- **Command:** `node scripts/gen-tasks.mjs --seed 20261015 --split hidden`
- **Output:** `data/tasks-hidden.jsonl` (not published; for maintainer evaluation only)
- **Plan:** Same templates with `mmc-h-###` ids; never commit hidden rows to the public JSONL.

## Contamination

All conversation text is synthetic (CC0-style fictional households). No PerMemBench text is copied. Public release cutoff: **2026-10-15**.

## Refresh cadence

Quarterly review of trap coverage, or when a new reversible-booking tool pattern appears. Bump the seed when refreshing public tasks.
