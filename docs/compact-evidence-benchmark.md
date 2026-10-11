# Compact evidence: feature and benchmark

This is an opt-in experiment with a reusable selector, two evidence modes, and a configurable evidence budget. No normal TokenSmith entry point imports it. No existing production source, renderer, IPC, dependency, or model setting was changed. The pre-existing package-lock edit and older experiment files are unrelated and remain intact.

## Evidence modes

`runStudyChatWithEvidence(request, selection, callbacks)` lives in `src/main/engine/compact-study-chat.ts`.

```ts
// Same request and existing generation service; normal is the default.
await runStudyChatWithEvidence(request)
await runStudyChatWithEvidence(request, { mode: 'standard' })

// Only retrievedSources changes; all other request fields retain their values.
await runStudyChatWithEvidence(request, {
  mode: 'compact',
  evidenceTokenBudget: 2000
})
```

The default budget is 2,000, exported from `src/shared/compact-evidence.ts`. Pass a different positive integer to change it without editing code, including 1,500 to reproduce the first experiment. The effective target is bounded by TokenSmith's existing available source allowance. It counts estimated evidence tokens, including source labels and omission markers; it excludes instructions, the question, history, and output. Actual full-prompt token counts come from Ollama when returned.

The selector works on arbitrary question/source input, not question IDs or reference answers. It identifies blank-line paragraphs, preserves complete fenced code/math and neighboring lists/tables, scores prose using distinct query-term matches, and retains immediate neighbors. Source rank and original position break ties. It keeps anchors from the first two matching sources, checks 80% coverage of query terms found in the original evidence, and requires at least 20% estimated evidence savings. These are initial guards, not semantic sufficiency guarantees. Identical optional prose spans may be deduplicated with provenance retained.

Calculations, summaries, comparisons, ambiguous tasks, selected passages, unclear boundaries, excessive complete spans, and insufficient coverage/savings use normal evidence. Fallback does not expand retrieval or guarantee entire-chapter coverage. The experimental answer adapter is scoped to the agreed `gemma4:12b`; the pure selector is model-independent. Other models use standard evidence. Normal mode remains the original service call, including its existing packing, verification, cancellation, early-answer callback, and follow-up behavior.

## Run after Ada is connected

From the repository root:

```bash
node tests/experiments/evaluate-compact-evidence.mjs --url http://127.0.0.1:11435 --budget 2000 --repeats 2 --snapshot tmp/compact-evidence-poc/2026-10-06T21-39-59-330Z/results.json
```

This command uses the existing Ada tunnel at `http://127.0.0.1:11435`, the installed `gemma4:12b`, and the first run's frozen retrieval, making the budget the only experimental change. It never downloads a model or changes server configuration. Omit `--snapshot` to perform fresh retrieval; the runner's default endpoint remains `http://127.0.0.1:11434`. Use `--url URL` if the existing connection has a different endpoint. Use `--embedding-url URL` if Nomic is reachable separately.

The script copies the prior disposable BuzzDB index into the new run directory using SQLite backup and a FAISS copy. It performs fresh production Nomic retrieval once for each of the unchanged ten questions in `tests/benchmarks/buzzdb_grounding_cases.json`, then freezes that snapshot for both arms. If the old index is unavailable, it creates a new isolated Basic index using the normal worker. It does not reindex the user's library. Model, embedder, runtime version, corpus hashes, settings, snapshots, and setup/retrieval costs are saved.

By default, settings come from `tests/experiments/compact-evidence-settings.json`: the existing normal v0.1.14 fresh-profile settings used in the earlier experiment. Temperature stays **0.7**, output cap **1,536**, context setting **8,192**, thinking **off**, and follow-ups **on**. There is no experiment-specific sampling or prompt override. To use a different saved normal configuration, pass `--settings PATH`; this accepts a settings JSON or TokenSmith state JSON and applies its selected-model overrides identically to both arms. Do not include credentials in that file.

The runner warms the normal model path once, excludes that warm-up, and runs two standard/compact pairs per question: **40 timed answers**, with order alternating by question and reversed on the next round. It leaves normal follow-ups enabled and saves their separate timings. Warm-up and answer follow-ups are additional normal inference calls. It adds no judge/classifier/summarizer calls, retries, unloads, or cache resets. One pair per question can be requested with `--repeats 1`, but has greater timing uncertainty.

The runner observes requests and responses without changing their content, provider options, timeout, or cancellation. It saves actual outbound messages and actual evidence text, including any normal packing/clipping. Original navigation records are not presented as proof that all their text reached Gemma. No request headers or credentials are recorded.

Each answer is saved immediately, and tables are updated after every run. Results go into a new timestamped directory under `tmp/compact-evidence-poc/`. An existing results directory is never overwritten; choose a fresh `--out PATH` for a new experiment. Failed calls remain recorded, and the remaining questions continue when possible. A setup failure stops the run and preserves its diagnostic.

## Results and review

| File | Purpose |
| --- | --- |
| `results.json` | Full configuration, frozen sources, exact prompts/responses, passage offsets, stage timings, counts, outcomes, and errors. |
| `comparison.md` | Per-question mean answer-ready time, overall matched-pair mean, applied-only mean, selection overhead, fallback count, and quality status. |
| `comparison.csv` | The same per-question comparison for a table or spreadsheet. |
| `summary.json` | Numeric summary with unavailable values represented as null. |
| `answers.md` | Every answer beside its evaluation-only reference and actual transmitted evidence. |
| `review.json` | Editable verdict and reason for each answer. |

Answer-ready wall time starts before the evidence-mode call and ends at the normal early-answer callback. It includes selector overhead, normal preparation, any applicable verification, the network/server wait, and the full generated answer. Retrieval is frozen and excluded from this comparison, and later follow-ups are separate. This is not a complete UI latency measurement. Provider prompt/evaluation/load durations are overlapping diagnostics; they are not added to wall time. A client/server difference is not a precise network measurement.

Means use matching successfully completed pairs in both arms. An unmatched failure is not silently compared with a successful counterpart. Missing token/timing fields remain unavailable, never zero. Tables explicitly say when the ten-case comparison is incomplete. Normal-sampling variation, output length, cache behavior, and shared Ada load limit what a small experiment establishes.

Before claiming maintained quality, inspect each answer for required facts, incorrect claims, conditions, and source support. Set each `review.json` verdict to `pass`, `incomplete`, or `incorrect`, with a short reason. Then regenerate the table without model calls:

```bash
node tests/experiments/evaluate-compact-evidence.mjs --summarize tmp/compact-evidence-poc/RUN_DIRECTORY
```

Quality stays “Review pending” until answers are inspected. A smaller prompt or lexical coverage score does not establish answer quality.

## Offline preparation and replay

Use saved sources to inspect selection without connecting Ada:

```bash
node tests/experiments/evaluate-compact-evidence.mjs --dry-run --snapshot tmp/compact-evidence-poc/2026-10-06T21-39-59-330Z/results.json --budget 2000
```

This reads only the prior question/retrieval/source fields for selector input; old generated answers and evaluation references never enter prompts. It checks the book hash and matching questions. No retrieval or generation runs, and no latency/quality result is claimed.

Omit `--dry-run` to generate paired answers from the same frozen snapshot once Ada is on. Such a run is labeled replayed retrieval, with new retrieval time unavailable. `--budget 2000` changes only the evidence target. `--help` lists all arguments.

## Verification

Focused tests cover dynamic selection, budget validation, exact substrings/provenance, task and packet fallback, whole protected neighbors, resolved questions, input immutability, unchanged normal requests/settings, cancellation, and original source navigation. A fully simulated runner test covers all ten cases, forty answers, warm-up exclusion, unchanged normal follow-ups, alternating order, missing-token handling, matching-pair averages, and pending quality review. Simulation timings are test data, not Ada measurements.

Run `npm run test:unit:ts` and `npm run build`. Python and existing production code are unchanged. Live server results remain pending until Ada is connected.

### Verification recorded October 6, 2026

- All 236 TypeScript unit tests passed, including the new selector, adapter, and benchmark tests.
- Typechecking and the production build passed.
- Offline preparation on the previous ten-question BuzzDB retrieval snapshots applied compact evidence to eight cases and retained standard evidence for the two comparisons. This is selection behavior, not a latency or quality result.
- A simulated forty-answer run verified paired scheduling, normal settings/follow-ups, actual evidence capture, and reporting.
- The only existing-file code adjustment is a test-helper fix using fileURLToPath so BuzzDB fixtures load when the workspace path contains spaces. Normal production code remains unchanged.
- Live Ada timings and answer-quality inspection remain pending.
