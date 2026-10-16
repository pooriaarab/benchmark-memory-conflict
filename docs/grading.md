# Grading

Deterministic replay of the household simulator. See `src/household-environment.ts` for tools.

## Failure modes

Wrong booking, missed cancel, stale memory use, private text in `ask_user`, skipping required clarification, invalid tool replay.

## Metrics

`staleMemoryUsed`, `privacyLeak`, `askedWhenNeeded` in score details.

## E2E

`scripts/e2e.mjs` scores empty, stale, leaking, and no-ask traces below 0.35; mock good policy above 0.85 on average.
