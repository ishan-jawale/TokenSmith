# Compact evidence: preliminary Ada results

Run: October 6, 2026. Model: gemma4:12b (Q4_K_M), evidence budget 1500 estimated tokens, ten unchanged BuzzDB questions, two planned repeats. Only source evidence differs; normal prompts and settings are preserved. No production UI or normal TokenSmith entry point changed.

**Result: a promising latency reduction, with quality issues and an incomplete run. Do not present this as preserved answer quality or an established causal speedup.**

33 of 40 answers completed. Seven requests failed with `fetch failed`; the saved error does not establish why. Sixteen matched successful pairs are available, including at least one pair for every question. The extra completed compact WAL answer is reviewed but excluded from latency averages.

| Comparison | Pairs | Standard average | Compact average | Time saved |
| --- | ---: | ---: | ---: | ---: |
| All completed matched pairs, including fallbacks | 16 | 18.98 s | 15.89 s | 16.3% |
| Pairs where compact evidence was applied | 13 | 19.12 s | 14.81 s | 22.5% |

| Case | Matched pairs | Standard (s) | Compact (s) | Time saved | Selection |
| --- | ---: | ---: | ---: | ---: | --- |
| pinning_needed | 2 | 15.20 | 12.63 | 16.9% | Compact |
| lru_sequential_scan | 2 | 19.40 | 16.83 | 13.2% | Compact |
| bplus_vs_binary_tree | 2 | 17.18 | 18.45 | -7.4% | Standard fallback |
| hash_range_queries | 2 | 16.64 | 14.00 | 15.9% | Compact |
| bplus_sequence_set | 2 | 18.37 | 16.36 | 10.9% | Compact |
| aggregation_grouping | 2 | 27.81 | 18.83 | 32.3% | Compact |
| wal_write_ordering | 1 | 17.08 | 9.52 | 44.3% | Compact |
| oltp_vs_olap | 1 | 20.76 | 24.77 | -19.4% | Standard fallback |
| column_store_analytics | 1 | 22.24 | 11.49 | 48.3% | Compact |
| volcano_iterator_model_alias | 1 | 14.45 | 14.25 | 1.4% | Compact |

## What these timings measure

Answer-ready wall time includes source selection, engine preparation, network/server waiting, and complete answer generation. Retrieval is frozen and excluded; normal follow-ups are preserved and measured separately. These are engine measurements, not end-to-end UI timings.

Across matched pairs, average actual prompt tokens fell from 3655.7 to 2250.4 (38.4%). Average output tokens also fell from 327.0 to 293.8 (10.2%). Mean selector overhead was 6.94 ms. Provider prompt-processing time fell from 6.02 to 4.23 seconds, while generation time fell from 12.42 to 11.17 seconds. Provider timings overlap with wall time and should not be added to it.

Normal sampling, different output lengths, prompt caching, and shared-server load can affect these measurements. Nonzero prompt-cache counts occurred in seven standard runs and one compact run among matched pairs. Two fallback questions actually ran slower despite retaining standard evidence, illustrating timing variation. Two planned repeats are too few to establish reliability.

## Manual quality review

All 33 completed answers were inspected against the existing reference facts and actual supplied evidence. Verdicts are qualitative, not an independent accuracy score: pass means the core requested explanation is correct; incomplete flags an omitted implementation step or reference benefit; incorrect flags a material false claim even when the main explanation is correct. Supplemental remedies need not appear in answers to causal “why” questions. This rubric and reviewer judgment should be disclosed.

| Arm | Completed answers | Pass | Incomplete | Incorrect |
| --- | ---: | ---: | ---: | ---: |
| Standard | 16 | 14 | 2 | 0 |
| Compact | 17 | 12 | 3 | 2 |

The counts include one unmatched compact WAL answer, so they are not an equal-sample accuracy comparison. Passing answers can still be less detailed.

- Compact LRU repeat 1 incorrectly says a new page evicts the immediately previous page in a four-frame example. The supplied evidence retained correct LRU examples.
- Compact pinning repeat 1 claims a scoped C++ reference prevents memory reclamation. The textbook itself contains this misleading claim; standard answers also echo the scope-based explanation less explicitly. A raw reference is non-owning ([C++ Core Guidelines, R.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#Rr-ref)); lifetime safety depends on the buffer-manager implementation. This source problem is not proof that selection caused the mistake.
- All four aggregation answers omit the final one-result-per-group emission step. Compact answers additionally lose the concrete unordered_map detail. The compact evidence retained the output-phase explanation.
- Compact column-store answer omits compression, although its evidence retained that benefit; standard includes it. The selective-I/O explanation remains correct.
- Both Volcano answers explain the CPU overhead correctly but omit batching as a remedy; this supplemental detail is noted rather than counted as a wrong causal explanation.

These observations do not support a claim of fully maintained quality. They also do not establish that missing source text caused the errors: several required details were still supplied.

## Meeting takeaway

The generic, configurable prototype works and its selection overhead is small. The preliminary measurements motivate further investigation, but accuracy and incomplete measurements remain unresolved. Present the measured reduction with those qualifications; use saved outputs for the demo.

Raw answers, exact transmitted evidence, per-answer verdicts, runtime details, token metrics, and failures are preserved in `tmp/compact-evidence-poc/2026-10-06T21-39-59-330Z`. `comparison.csv` and `comparison.md` contain the regenerated per-question table. No additional model calls were made during review.
