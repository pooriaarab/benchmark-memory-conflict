# Memory Conflict study plan

Date: 2026-10-29. No study results collected. Source inspection is complete.
Source: benchmark-memory-conflict 0.1.0, bec4441f88d15c68eb256b81589a1f1f5d5fa328.
The accepted honesty pilot supplies only unchanged build/statistics files, not scientific text or metrics.
This is a local prospective plan, not an independent public registration. No deposit is authorized.

1. Question: Does replay distinguish correct household actions from omissions and unsafe choices?
H1: Reference actions pass more items than empty output. H2: Removing required questions or cancellations fails affected items.
H3 (simulated): Perfect controls improve composite pass rates as injected error probability rises; no learned-agent claim.
2. Primary outcome: binary native grade. Secondary outcomes: stale choice, privacy leak, and clarification success conditional on required clarification.
Report Wilson 95% intervals over tasks, with fixed-template sampling caveats. No significance threshold or model ranking.
3. Run all 40 public tasks through the package runner with 12 scripted conditions: empty, constant, echo, refuse, first-tool, packaged-good, packaged-bad, no-ask, no-cancel, stale-choice, leak, late-ask.
The last five modify the reference trace. Stale-choice substitutes a rubric-listed stale option when one exists. Leak appends private memory to a shared write. Late-ask moves questions after booking.
Packaged controls have access to expected outcomes. They are instrument checks, not autonomous solvers.
4. Runner seed 1, concurrency 1, retries 0, maximum 12 turns and 12 tool calls, API budget USD 0. Repeat every condition once. Repeats do not increase sample size.
5. Additional simulated population sweep: 30 independent seeds (1 through 30), all tasks, error probability 0, .25, .5, .75, 1.
For each seed/task draw one reproducible uniform value. If below probability, inject a trap-specific error: omit ask for authority; omit cancel for cancellation; disclose private text for privacy; choose stale option for remaining traps.
Compare no control, perfect authority repair, perfect privacy repair, perfect cancellation repair, and all repairs including stale choice.
Repair restores the reference trace only for its target trap. These controls have oracle knowledge and no false positives by construction.
Score every simulated trace through the public score API. Save seed, task, probability, control, selected trace, score, and detail flags.
Use paired bootstrap 95% intervals over simulated agent seeds, 2,000 draws, seed 20261029. Never treat all seed/task rows as independent households.
6. Figures: taxonomy counts, scripted pass rates with Wilson intervals, simulated control curves with cluster bootstrap intervals. Include task-stratum outcomes and paired all-versus-none contrasts.
7. No outcome exclusions. Infrastructure errors halt the run. Empty outputs and refusals count as failed bookings. No hidden tasks, human study, or trained model inference.
Free hosted inference is not configured for this study; no provider availability claim. No remote inference requests or credentials are used.
8. Failure checks before implementation: missing/duplicate tasks; adapter errors; source drift; replay disagreement; mismatched trace hashes; invalid denominators; confidence bounds outside range; simulation joins misaligned; metadata mismatch; missing figure data; undefined citations.
Stop after the fixed grid. Report nulls, timing limitations, lexical privacy limits, and deviations. Preserve both repeats and hashes.
