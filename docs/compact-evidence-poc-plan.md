# Compact evidence: execution plan

Updated October 6, 2026 to reflect the agreed scope: ten BuzzDB questions, Gemma 4 12B on Ada, no UI, and source evidence as the sole experimental request difference.

This is the authoritative plan. The [feature and benchmark guide](compact-evidence-benchmark.md) documents the implemented API, arguments, saved artifacts, and measurement boundaries.

## Fixed scope

- Reusable runtime selection, never question-specific paragraphs or reference-answer input.
- Two explicit modes: standard and compact. Standard is the default and calls the existing answer service unchanged.
- Parameterized estimated evidence-token budget, default 2,000 for the next experiment (the first measured run used 1,500), bounded by the normal available source allowance. Change it with the API argument or benchmark --budget flag.
- Keep normal questions, instructions, source-label format, history handling, model settings, generation options, verification, cancellation, and follow-up behavior. Only retrievedSources changes in compact mode.
- Existing Nomic retrieval, frozen once per question and shared across each pair; same gemma4:12b package and Ada connection.
- No UI, dependency, IPC, Python, normal production service, model download, or serving changes. Preserve pre-existing package-lock and experiment files.
- Ten unchanged definitions from tests/benchmarks/buzzdb_grounding_cases.json. Their references are evaluation-only.
- Existing normal v0.1.14 settings, including temperature 0.7 and follow-ups on, in both arms. A different saved normal configuration can be supplied with --settings; no experiment-specific overrides.

## 1. Implement the generic selector

Parse existing retrieved text into paragraphs using original character offsets. Preserve complete fenced code/math and neighboring lists/tables; unclear structures use standard evidence. Score prose by distinct resolved-question terms, with source rank and original position as tie-breakers. Include immediate neighbors, merge contiguous spans, and optionally deduplicate identical prose while recording provenance.

Seed the first two matching sources. Add more spans within the configured budget. Fall back for protected/unknown tasks, selected passages, ambiguous boundaries, no matches, oversized complete anchors, under 80% coverage of question terms present in the original evidence, or under 20% estimated evidence savings. These rules do not prove semantic completeness. Chapter summarization and full quantitative tasks retain standard evidence; this does not guarantee complete chapter coverage.

Checkpoint: exact original passages, deterministic selection, immutable input, bounded evidence, and documented fallback.

## 2. Add the two-mode adapter

Keep the adapter isolated from normal application entry points. Standard mode passes the unchanged request to the existing Ollama service. Compact mode prepares normal budget information, selects passages, verifies they survive the existing packer without clipping, and changes only the source array before using the same service.

Preserve normal early-answer callbacks, cancellation, follow-ups, and original records for source navigation. Scope this proof-of-concept adapter to the agreed 12B model; other models use standard evidence. The pure selector remains model-independent.

Checkpoint: tests prove standard outbound requests are identical to the existing service, and compact answer prompts differ only in their evidence.

## 3. Build the opt-in benchmark runner

Reuse normal saved settings and the production Nomic worker. Back up the earlier disposable BuzzDB index into a new run profile without modifying its original. If absent, create an isolated Basic index. Retrieve once per question and freeze sources. Alternatively replay an explicitly supplied saved snapshot, recording retrieval time as unavailable.

Record installed model digest, quantization, runtime version, embedder digest, settings, corpus/question hashes, setup costs, and frozen source snapshots. Reuse the existing Ada connection; the user will open the password-protected tunnel after code is ready. Do not download or substitute a generator.

Warm once, excluding warm-up from averages. Run two pairs per question by default, alternating first-arm order and reversing it on the next round: forty timed answers plus normal follow-up calls. Complete the first round across all ten questions before repeating. Keep failures, do not retry or force model unload/cache resets.

Capture actual outbound messages, provider responses/counts, passage manifest, selector duration, answer-ready wall time, and separate follow-up time. Missing metrics remain unavailable rather than zero. Save after every run and update the table.

Checkpoint: simulated runner completes all ten cases and forty answers, forwards unchanged normal options, saves exact evidence, and does not claim simulated timings as model performance.

## 4. Verify before connecting Ada

Run focused selector/adapter/report tests, the full TypeScript unit suite, and the build. Check byte-for-byte normal request equality, compact evidence-only differences, configurable budgets, protected blocks, lexical matching limitations, packet guards, input preservation, cancellation, and source mapping. Verify paired averages exclude unmatched failures and missing token fields remain unavailable.

Prepare the ten saved source snapshots offline. This can demonstrate selection and fallback behavior but cannot establish latency or answer quality. Check the existing source and benchmark definitions remain unmodified.

Checkpoint: recorded passing checks, normal production paths unchanged, and ready-to-run command.

## 5. Run on Ada after the user connects it

Execute node tests/experiments/evaluate-compact-evidence.mjs --url http://127.0.0.1:11435 --budget 2000 --repeats 2 --snapshot tmp/compact-evidence-poc/2026-10-06T21-39-59-330Z/results.json from the repository root. The next run reuses the first run's frozen retrieval and changes only the evidence budget. Confirm the fixed model and same settings for both arms. Use a new output directory for every run. If setup fails, retain the diagnostic and resolve that prerequisite; do not change the experiment to another model.

Primary metric: complete engine answer-ready time, including selector overhead, preparation, applicable verification, network/server waiting, and generation. Frozen retrieval and later follow-ups are separately recorded. Provider timings overlap with wall time and must not be added to it. This does not exercise React, IPC, or UI latency.

Checkpoint: saved outcomes for all ten cases, real sample counts, actual transmitted evidence, and model/server configuration. Shared-server load and output/cache variation remain limitations.

## 6. Inspect quality and produce the meeting table

Review every answer against existing reference facts and its actual evidence. Mark pass, incomplete, or incorrect with a reason in review.json. References are never passed to the selector or generator. Regenerate the report with --summarize without additional model calls.

Show each question's mean standard/compact answer-ready time, percentage time saved, selector overhead, applied/fallback status, quality verdict, and paired count. Overall averages use matching successful pairs, include fallback cases, and explicitly identify incomplete runs. Also show applied-only averages and prompt/output token counts. Do not claim maintained quality before inspection or infer causation from smaller prompts alone.

Use saved answers and comparison.csv/comparison.md for tomorrow's meeting. Report a positive, neutral, or negative result honestly; no measured speedup is required to complete the prototype.

## Current checkpoints

| Work | Status |
| --- | --- |
| Generic configurable selector | Implemented; focused tests pass. |
| Isolated normal/compact adapter | Implemented; request-invariance tests pass. |
| Ten-case automatic runner/report | Implemented; simulated complete-run test passes. |
| Full verification | Complete: 236 TypeScript tests pass; build passes; offline ten-case preparation and simulated forty-answer run verified. |
| Ada connection and live measurements | Complete at 2,000: 40/40 answers, twenty matched pairs, no failures. Earlier 1,500 run retained separately. |
| Answer review and final latency table | All forty new answers reviewed; completed table and fair cross-budget comparison saved in compact-evidence-2000-results.md. Limitations and omissions recorded. |

Resume at the first incomplete checkpoint. Change the budget as a separate recorded experiment; never mix runs using different budgets into one average.
