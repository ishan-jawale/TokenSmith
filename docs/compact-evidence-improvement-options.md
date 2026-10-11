# Improving compact evidence: options and recommended sequence

These are proposals, not implemented feature changes. Offline replay used the existing live run’s frozen retrieval and current selector, with no Gemma calls. Existing benchmark outputs and normal TokenSmith behavior remain unchanged.

## Diagnose before tuning

The current “80–20” guards are independent: retain at least 80% of query terms found in the retrieved text, and save at least 20% of estimated evidence tokens. Neither measures answer quality or probability of correctness. The budget is estimated evidence tokens, not the entire prompt or model context window.

Several reviewed problems were not missing-evidence problems. Correct LRU examples, the aggregation output phase, and column-store compression were in the compact packets. The pinning claim also appears in the textbook. Changing coverage or budget cannot guarantee resolution of these generation/source issues.

There is nevertheless a genuine selection weakness: at 1500, the Volcano packet omits the word “Volcano,” while retaining generic analytical-query material. Aggregation keeps a long hashing-versus-sorting tradeoff table but drops the concrete unordered_map implementation. Current scoring counts matched terms equally and allows only prose to initiate a candidate; code, numeric examples, lists and tables enter as neighboring blocks. It also requires anchors from the first two matching retrieved sources, regardless of whether both help answer the specific question.

## Offline budget replay

| Evidence limit | Cases using compact | Fallback cases | Observations |
| --- | ---: | ---: | --- |
| 1000 | 7 | 3 | WAL additionally falls back for low term coverage. Less context; quality and speed unmeasured. |
| 1500 | 8 | 2 | Current measured setting; LRU and Volcano retain 80% of matched query terms. |
| 2000 | 8 | 2 | Restores Volcano topic name and aggregation unordered_map text. LRU still drops “fail.” |
| 2500 | 6 | 4 | Hash-range and Volcano additionally fail the minimum 20% savings guard. Larger limit can reduce application rate. |

At 2000, actual estimated selected evidence is 1512–1965 tokens in the eight applied cases, still below their standard 2618–3572-token packets. This establishes retained context only, not better answers or a specific speedup. A higher budget is a maximum: WAL and sequence-set packets do not necessarily fill it.

Changing coverage alone from 80% to 90% at the current 1500 setting would force LRU and Volcano to standard fallback, because both retain 80%. The dropped term is “fail” for LRU and “Volcano” for Volcano. Equal-weight coverage cannot distinguish these situations. Pinning, aggregation, and column-store packets already have 100% coverage despite quality concerns.

## Options

1. **Budget-only comparison, 1500 versus 2000.** Lowest-risk next experiment. Same selector, guards, prompts, model, settings, and frozen retrieved sources. Inspect whether implementation specificity improves, and measure the actual quality/latency tradeoff. Do not promise the observed errors disappear.
2. **Improve paragraph relevance before stricter thresholds.** Weight distinctive topic terms and query phrases more strongly, with original retrieval rank as a modest prior. Consider BM25 over the retrieved blocks. Permit relevant structured blocks to initiate candidates while preserving entire code/list/table/example boundaries. Avoid automatically spending much of the budget on a second weakly related source.
3. **Remove repeated explanation, retain distinct support.** Prefer a block contributing a new mechanism, condition, example, or implementation detail over another paraphrase of an already covered introduction. Exact paragraph deduplication is the simpler first step; approximate matching requires caution around differing numbers, negation and conditions. Relevance and novelty remain heuristics, not proof of sufficient evidence.
4. **Small adaptive budget: 1500 → 2000 → standard.** Build a packet at 1500. If an important topic anchor found in retrieved text is missing, or a relevant complete block does not fit, try 2000 locally. If guards still fail or savings are under 20%, use standard evidence. Detect anchors generically from identifiers, acronyms and distinctive phrases; never use benchmark answers or hardcoded per-question rules. No preliminary model answer is required.
5. **Separate source correctness from compression.** Flag the textbook’s pinning claim for correction. Any revised corpus belongs in a separate experiment with identical revised sources for both arms and rebuilt indexes. Do not silently fix only compact evidence. Source correction addresses a different problem from shorter context.

More complex alternatives are cached Nomic paragraph embeddings or a separate reranker. They can address lexical paraphrases but introduce indexing/cache or inference costs. Keep them for a later stage; do not add an LLM summarizer, automatic answer retry, prompt changes, or model changes to this experiment.

## Recommended sequence

First, leave the 80% coverage and 20% savings guards unchanged and compare the existing 1500 setting with 2000 using frozen retrieval. Retain the standard arm. Complete all ten pairs for each setting before drawing a conclusion; use repeated answers to check recurrence rather than treating a single omission as causal evidence. No automatic rerun has been started.

Next, if the budget-only test leaves relevance problems, improve the generic ranking and structured-block selection at a fixed budget. Evaluate that change separately. Only then add the two-level adaptive budget if its local guards produce useful decisions. These stages are diagnostic comparisons, not a large parameter search. Choose the smallest packet with acceptable factual coverage, and validate the chosen policy on a few unseen questions rather than optimizing solely for these ten.

Record answer-ready time, provider input-processing time, output token count, fallback rate, factual errors, and missing core facts. Keep output-length/cache variation visible. Existing normal sampling and follow-ups remain unchanged; no provider cache resets or altered generation settings.

## Primary research supporting the options

[Introduction to Information Retrieval: inverse document frequency](https://nlp.stanford.edu/IR-book/html/htmledition/inverse-document-frequency-1.html) explains why frequent words have little discriminating power. [Its BM25 chapter](https://nlp.stanford.edu/IR-book/html/htmledition/okapi-bm25-a-non-binary-model-1.html) combines term frequency, inverse document frequency, and length normalization. Applying it to this selector is a proposed engineering choice, not a measured improvement here.

[Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) finds that information position can affect model performance in long-context tasks. It supports inspecting packet organization rather than assuming additional tokens always improve answers. It does not establish the same behavior for our Gemma model or short evidence packets.

Offline replay details: `tmp/compact-evidence-poc/budget-sensitivity-offline.json`. Original measured results: `compact-evidence-poc-results.md`.
