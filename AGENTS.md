# Working on benchmark-memory-conflict

## Commands

- Install with `npm ci`.
- Run the full gate with `npm run ci:local`.
- Generate tasks with `npm run generate:tasks` (`node scripts/gen-tasks.mjs --seed 20261015`).
- Hidden split: `node scripts/gen-tasks.mjs --seed <unpublished> --split hidden` lands in a follow-up change (`bmcf-20-hidden-split`); until then the generator only accepts `--split public`.
- Generate provenance after building with `npm run provenance`.
- Add no unit tests. Extend `scripts/e2e.mjs` through a public surface.

## Contracts

Keep tasks, deterministic grading (`src/household-environment.ts`, `docs/grading.md`), and provenance in sync. Episode environments must be seeded. Grade episode traces by replaying their tool log in `src/household-environment.ts`.

Never read provider keys from repository files. OpenRouter uses `OPENROUTER_API_KEY`. OpenAI-compatible providers use `OPENAI_BASE_URL` and `OPENAI_API_KEY`.

Open an issue before a branch. Use `bmcf-<issue>-<slug>` and `[bmcf-<issue>] Imperative subject`. Keep pull requests below 500 counted lines. Do not merge your own pull request or push `release`.
