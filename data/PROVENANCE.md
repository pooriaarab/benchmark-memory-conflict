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

## Hidden split

- **Status:** pending; lands in a follow-up change (`bmcf-20-hidden-split`). This revision only accepts `--split public`.
- **Plan:** unpublished seed with `mmc-h-###` ids; `data/tasks-hidden.jsonl` is never committed.

## Contamination

All conversation text is synthetic (CC0-style fictional households). No PerMemBench text is copied. Public release cutoff: **2026-10-15**.

## Refresh cadence

Quarterly review of trap coverage, or when a new reversible-booking tool pattern appears. Bump the seed when refreshing public tasks.
