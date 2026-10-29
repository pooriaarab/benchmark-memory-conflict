# Memory Conflict paper

Run `npm ci`, then `sh paper/template/reproduce.sh` from the repository root.
Validated with Node 22 and npm 10. Requires Python 3, Tectonic, and Poppler (`pdfinfo`, `pdftotext`).
The output is `paper/memory-conflict-paper.pdf`. PDFs and downloaded styles stay untracked.
The first build downloads the pinned official NeurIPS style and may download TeX packages.
Experiments use no network, model credentials, or paid inference.

The unchanged `template/` comes from benchmark-honesty PR 24.
The study scripts, prose, metrics, and figures are specific to household memory conflict.
`PREREG.md` was committed before results. It is a local plan, not an independent deposit.
`config.json` freezes the benchmark source. `meta.json` follows the pilot's version 1 contract.
Machine outputs have `.generated.json` or `.generated.csv` suffixes; `generated/` holds derived TeX.
Do not edit generated data or tables. The render script also generates metadata.
The benchmark remains MIT. Paper text and generated figures use CC-BY-4.0.

The study runs 12 scripted conditions twice on the public tasks.
The extra simulated study uses 30 seeds, five error probabilities, and five perfect control settings.
Simulation records identify a reproducible trace policy; `scripts/traces.mjs` reconstructs its input.
Wilson intervals describe hypothetical task sampling. Simulated intervals resample agent means.
Perfect simulated repairs use the answer key. They are upper bounds, not practical defenses.
No learned model or human study is included. Free provider availability was not tested.
The unchanged grade accepts a question after booking. The paper reports this limitation.
`verify.mjs` checks every saved score, source hash, repeat, confidence summary, metadata, and PDF.
The repeat command retains stable semantic data; runner timestamps and timings can change.
The parent handles review and publication. Do not merge or publish this packet automatically.

The existing repository E2E pack check fails with npm 12, which returns a keyed object.
Use the CI toolchain above; no benchmark code changes are included for this unrelated issue.
