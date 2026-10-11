# Meeting material: October 7, 2026

## Five slide bullets

- **Goal:** Reduce Gemma answer latency by selecting relevant original passages after existing Nomic retrieval, preserving prompts and model settings.
- **Prototype:** Generic, configurable evidence selector; current budget 2,000 estimated tokens. Comparisons and broad tasks use standard evidence. Normal TokenSmith behavior stays unchanged.
- **Experiment:** Ten fixed BuzzDB questions on Ada using gemma4:12b, two repeats; all 40 answers completed with the same frozen retrieval as the earlier run.
- **Measured latency:** Average answer-ready time fell from 18.85 to 16.98 seconds (9.9%); applied-only pairs saved 13.5%. Selector overhead averaged 11 ms.
- **Quality and limits:** Compact answers recovered aggregation implementation details and compression. One reference omission remains; source inaccuracies, workload assumptions, sampling, output length and caching limit the conclusion.

## What to show

1. The conceptual pipeline diagram in `assets/compact-evidence-concept.png`.
2. The completed per-question table from `tmp/compact-evidence-poc/2026-10-06T23-14-14-587Z/comparison.md`, including standard fallback labels and quality notes.
3. The aggregation example: 1,500-token compact answers omit unordered_map; both 2,000-token answers include it, and one explains the final output step. This is an observed comparison, not proof of causation.

## Suggested explanation

I implemented a small experiment that changes only the source passages supplied to Gemma. Selection happens after our existing retrieval, with a configurable budget and standard-evidence fallback. The prototype is isolated from normal TokenSmith operation.

The completed 2,000-token run averaged 18.85 seconds with standard evidence and 16.98 seconds with compact evidence. Selection took about eleven milliseconds. Important details returned compared with the smaller-budget run, but one aggregation answer still omits a reference step, and some textbook claims and workload simplifications need care. I can demonstrate a working feature and measured latency improvement, while keeping the quality and measurement limitations explicit.

The next feature improvement would be better generic relevance scoring and preservation of implementation blocks at a fixed budget. The measured report is `compact-evidence-2000-results.md`; use saved outputs rather than live generation for the meeting.
