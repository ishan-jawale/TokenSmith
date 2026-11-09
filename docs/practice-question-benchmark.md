# Competitive Programming Practice baseline

This opt-in diagnostic uses the production Practice client, Basic PDF preparation,
hybrid search, topic preparation, source rotation, prompts, model provider and
question parser. It does not measure the graphical interface or student learning.
The benchmark uses a separate library under its output folder; the installed app
and its saved study sessions are not modified. Model downloads are never automatic.

## Run on this Mac

Start the existing Ollama server or Ada tunnel first. Both `gemma4:12b` (the chosen
middle-tier generator) and `nomic-embed-text` must be available at that endpoint.
If using Ada, follow [the existing connection instructions](../../ADA_Instructions.txt).

Once the Ada server and Mac SSH tunnel are running, this single command performs
the readiness check and starts the agreed full baseline:

```bash
bash "/Users/Skaterboi/Documents/Masters/Georgia Tech/Semester 1/CS8903/TokenSmith/scripts/run-practice-cp.sh"
```

It selects the supplied handbook and Gemma 4 12B automatically, checks both models
before generating anything, and prevents idle sleep on macOS while the run is
active. Keep the laptop lid, Terminal, server and tunnel open. The full output
directory is printed when generation starts. Add `--check` for readiness only, or
`--smoke` for a one-question trial. No extra installation or app launch is needed.

The lower-level commands below are available for running individual stages.

Run in Terminal:

```bash
cd "/Users/Skaterboi/Documents/Masters/Georgia Tech/Semester 1/CS8903/TokenSmith"
npm run test:practice-benchmark -- --book "/Users/Skaterboi/Documents/IIT Delhi/Career/Placement Prep./Competitive Programming.pdf" --check
```

The check lists installed models, confirms the 300-page handbook edition, and
shows an extraction sample using the app's PDFium reader. It makes no generation
requests. Check mathematical notation in the saved extraction samples and source
passages as part of the review, too.

Generate one trial question before starting the full run:

```bash
npm run test:practice-benchmark -- --book "/Users/Skaterboi/Documents/IIT Delhi/Career/Placement Prep./Competitive Programming.pdf" --model gemma4:12b --smoke
```

After inspecting that trial's `questions.md`, start the full baseline:

```bash
npm run test:practice-benchmark -- --book "/Users/Skaterboi/Documents/IIT Delhi/Career/Placement Prep./Competitive Programming.pdf" --model gemma4:12b
```

The app does not need to be open. Keep Ollama/Ada and the tunnel running. The full
book is prepared afresh for each run. The output path is printed at startup and
after completion. Optional `--out tmp/my-run-name` must name a new directory.
`--ollama-url` changes the endpoint for both generation and embeddings.

## Sampling and settings

The frozen plan in `tests/experiments/practice-cp-cases.json` defines six topics:
time complexity, sorting/binary search, greedy algorithms, dynamic programming,
graph traversal, and shortest paths. Each has one continuous session with ten
scheduled generation attempts: **60 scheduled attempts**, not a guarantee of 60
usable questions. Joshua's PR retries a rejected question once, with validation
feedback. The runner preserves that production behavior and records each attempt,
response and rejection reason; it adds no extra retries or replacement questions.
There can therefore be up to 120 generation attempts across 60 scheduled slots.
A failed
topic retrieval blocks that session's slots and is reported separately. An invalid
generation is retained; the next slot continues with the accepted session history,
as the app would after a failed generation.

The whole book is indexed; chapter/page annotations are reviewer references and do
not restrict retrieval. Each fresh topic session uses the app's scoped topic search
once, then rotates its retrieved pool for subsequent questions. Hybrid retrieval
must return vector hits; an embedding failure cannot silently become a keyword-only
benchmark.

The runner imports the same built-in defaults as the application from
`src/shared/default-settings.ts`, rather than maintaining a custom benchmark
profile. These are factory defaults, not any personalized settings saved in the
installed app. The application defaults themselves are unchanged. The current
defaults use Auto context (8,192-token starting value), a 1,536-token output
allowance, Auto reasoning, temperature 0.7, top-p 0.4, top-k 40, min-p 0, and
repetition penalty 1.18. Search defaults to hybrid; document preparation uses the
app's `defaultPreparation()` Basic settings and preparation workflow.

The existing Practice client/provider still applies its ordinary overrides:
thinking/reasoning off, no custom chat persona or follow-up suggestions, output
capped at 2,048 (so the default 1,536 remains), and provider temperature 0.3. These
are application behavior, not benchmark-specific adjustments. Auto context and
production preflight/packing may change the effective context or included sources.
Base settings, actual provider requests and responses are retained in the results.
No seed is forced. Local model digests, the book hash, source hashes and a snapshot
of the evaluated app source are saved.

## Review the outputs

- `questions.md`: generated statements, keys, explanations, assumptions, quoted
  criteria, retained passages and rejected model responses.
- `results.json`: complete run metadata, session retrieval results, raw provider
  requests/responses, timings and failures. Contains book excerpts; keep it local.
- `summary.md`: per-topic execution counts and exact repeats, with no inferred
  question-quality score.
- `review.json`: blank judgments for each accepted question. Fill with
  `pass`, `issue`, or `uncertain`, plus a short evidence-based explanation.
- `extraction-samples.json`: PDFium text samples for checking extraction.

Assess relevance, wording and necessary assumptions, answer-key correctness,
evidence sufficiency, and novelty. Classify depth as recall, understanding or
application separately from validity. For False statements require a contradiction
supported by the material, rather than absence of a claim. An application-accepted
question is not automatically correct; a rejected generation is not automatically
semantically wrong. Generation acceptance, question validity and generation time
are different measurements.

The generator supplies its own key and explanation. They are evaluation targets,
not independent ground truth. All accepted outputs start ungraded. Report the
number actually reviewed, separate uncertain judgments, and show counts by topic.
Use a few representative examples for tomorrow's slides. This single-book,
single-model baseline supports claims about the observed sample.

Per-question times include provider preflight and generation. Topic preparation and
book import are timed separately. The first question can include cold model load;
the runner does not report these timings as controlled hardware comparisons.
Completed rows are saved after every attempt. There is no automatic resumption;
keep any interrupted run and label it incomplete rather than combining runs silently.

## Optional cloud model

`--provider gemini --model <exact-model-name>` uses the production remote provider.
It requires `TOKENSMITH_BENCHMARK_API_KEY` in the terminal environment; it does not
read the installed app's encrypted credentials or save the key. Nomic embeddings
still require Ollama/Ada. The current agreed baseline is local `gemma4:12b`.
