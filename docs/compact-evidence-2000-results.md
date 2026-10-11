# 2,000-token evidence: completed Ada run

Run: October 6, 2026, saved at `tmp/compact-evidence-poc/2026-10-06T23-14-14-587Z`. Model: gemma4:12b, Q4_K_M. All 40 timed answers completed: ten questions, two repeats, twenty matched pairs. No failures.

The same frozen retrieved sources, corpus/question hashes, model digest and settings were used as in the 1,500-token run. The selector and guards did not change. Actual standard answer messages and non-message generation request fields match the earlier completed counterparts. Normal production behavior remains unchanged.

| Comparison | Pairs | Standard | Compact | Time saved |
| --- | ---: | ---: | ---: | ---: |
| All questions, including standard fallbacks | 20 | 18.85 s | 16.98 s | 9.9% |
| Questions where compact evidence applied | 16 | 18.29 s | 15.82 s | 13.5% |

| Case | Standard (s) | Compact (s) | Time saved | Selection |
| --- | ---: | ---: | ---: | --- |
| pinning_needed | 14.92 | 13.95 | 6.5% | Compact |
| lru_sequential_scan | 19.48 | 18.79 | 3.6% | Compact |
| bplus_vs_binary_tree | 17.51 | 18.14 | -3.6% | Standard fallback |
| hash_range_queries | 15.80 | 14.65 | 7.3% | Compact |
| bplus_sequence_set | 16.61 | 15.74 | 5.3% | Compact |
| aggregation_grouping | 26.69 | 21.22 | 20.5% | Compact |
| wal_write_ordering | 15.44 | 11.76 | 23.8% | Compact |
| oltp_vs_olap | 24.73 | 25.11 | -1.5% | Standard fallback |
| column_store_analytics | 22.28 | 16.68 | 25.1% | Compact |
| volcano_iterator_model_alias | 15.08 | 13.75 | 8.8% | Compact |

## Comparison with 1,500

The first run completed only sixteen matched pairs. Comparing its overall average directly with all twenty pairs in the new run changes the sample. Restricting both runs to the same sixteen case/repeat pairs gives:

| Budget | Common pairs | Standard | Compact | Time saved |
| --- | ---: | ---: | ---: | ---: |
| 1500 | 16 | 18.98 s | 15.89 s | 16.3% |
| 2000 | 16 | 18.65 s | 17.29 s | 7.3% |

The 2,000-token compact answers were slower on these common pairs, consistent with supplying more text; they also generated more output on average (313.6 versus 293.8 tokens). Caching, output length, normal sampling, and shared-server conditions differ between sessions. This comparison does not establish a causal budget effect or a statistically reliable optimum.

## Answer inspection

All forty answers and selected evidence were manually reviewed using the previous core-reference-coverage rubric. This is a qualitative, unblinded review, not an independent accuracy benchmark. Pass means the requested core mechanism is covered; caveats and simplifications remain in the review notes. Incomplete means a required reference step is omitted; incorrect means a material false claim appears despite a correct core explanation.

| Arm | Pass | Incomplete | Incorrect |
| --- | ---: | ---: | ---: |
| Standard | 16 | 2 | 2 |
| Compact | 19 | 1 | 0 |

Do not interpret these small-sample counts as model accuracy rates or proof that compaction improves quality.

- Both compact aggregation answers now identify unordered_map and vector-based group/aggregate states. Repeat 1 also explains final traversal into output tuples; repeat 2 still omits explicitly emitting a result for each group. Both standard repeats omit that final step.
- Both compact column-store answers now include compression, resolving the omission observed in the first run.
- Both compact pinning answers avoid the misleading reference-lifetime aside, despite the same inaccurate textbook claim still being supplied. The first standard answer explicitly repeats it and is marked incorrect; the second standard answer has an imprecise scope-based aside. A raw reference is non-owning ([C++ Core Guidelines, R.4](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#Rr-ref)). Source correction remains separate work.
- Compact LRU answers avoid the earlier immediately-previous-page eviction mistake. The first standard answer now makes that mistake and is marked incorrect. Compact LRU zero-hit statements still need initial-cache/workload assumptions; repeat 1 overstates eviction timing relative to another process’s reuse. These qualifications prevent a claim of flawless quality.
- All sequence-set answers use the textbook’s sequential-I/O simplification: logical leaf links do not themselves guarantee contiguous physical disk placement.

These changes show improved detail coverage in the saved compact answers, but they do not prove the larger budget caused it. Ordinary generation variation is visible in both arms.

## Timing diagnostics and limitations

Mean selector overhead was 11.01 ms. Across all twenty pairs, actual prompt tokens averaged 3602.1 standard versus 2556.3 compact (29.0% reduction); output tokens averaged 326.45 versus 312.8. Provider prompt processing averaged 5.88 versus 4.55 seconds, and output generation 12.43 versus 11.84 seconds. Nonzero prompt-cache counts occurred in nine standard calls and two compact calls. Provider timings overlap with wall time and are not additive.

Answer-ready timing includes selection, engine preparation, server/network waiting, and full answer generation. Frozen retrieval and later normal follow-ups are excluded. This is not a UI latency measurement. The two comparison questions fell back to identical standard evidence and ran slightly slower, demonstrating normal timing variation.

## Recommended meeting claim

A configurable evidence selector reduced average answer-ready time by about 10% in a completed ten-question, two-repeat run using Gemma 12B. The compact answers recovered important details relative to the earlier smaller-budget run, with one remaining reference omission and qualifications. The results support further work on selection quality; they do not establish universal speedup or fully preserved quality.

Keep 2,000 as the current experimental budget. If another implementation iteration is requested, improve generic paragraph relevance and preservation of implementation blocks at this fixed budget. Avoid increasing the budget again or changing prompts and model settings together.

Raw results, actual evidence, per-answer judgments and comparison tables are saved beside the run. The previous 1,500-token results are preserved. No extra model calls were made during analysis.
