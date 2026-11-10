# BuzzDB splitter audit (opt-in)

Run from the TokenSmith directory:

```bash
npm run test:evidence-buzzdb
```

Or, from any terminal directory:

```bash
bash "/Users/Skaterboi/Documents/Masters/Georgia Tech/Semester 1/CS8903/TokenSmith/scripts/test-buzzdb-evidence.sh"
```

The default input is `tests/fixtures/buzzdb/buzzdb-book.tokensmith.md`.
No Ollama, Ada, Python setup, network access or model calls are needed. The
repository's existing Node and TypeScript dependencies must be installed.
The script is separate from automatic unit-test discovery and is never run by
`npm run test:evidence-units` or `npm test`.

## Coverage

- Complete Markdown document.
- Every Markdown heading section and every adjacent-section pair.
- Overlapping 1,000- and 2,400-character windows, including clipped edge cases.
- Every fenced code block and standalone display-math block, both isolated and
  with explanatory context added around it.
- Per-case exact reconstruction, contiguous UTF-16 offsets, original source
  mapping, nonempty units, unique sequential IDs, deterministic repeated output,
  label-independent boundaries, labeled evidence formatting and CRLF variants.
- A separate line-oriented Markdown scanner checks that code/display-math
  bodies are not cut apart. It does not reuse the splitter's private scanner.

Generated windows are stress inputs, not production retrieval chunks. Some start
or end inside code, equations or sentences; those omissions are input clipping,
not necessarily segmentation errors. The current production indexer and question
prompt are not exercised by this script.

## Output

Each run creates a new `tmp/buzzdb-evidence-<timestamp>` directory and prints it.
The script refuses to overwrite existing results. Use `--out` only with a new
output directory. Optional custom input must be Markdown or plain text:

```bash
npm run test:evidence-buzzdb -- --book /path/to/book.md --out tmp/buzzdb-review-01
```

- `summary.md`: scenario counts, failures, execution time and source/code hashes.
- `results.json`: machine-readable test results without duplicate unit text.
- `cases.jsonl`: every case, original source offsets, every unit and every assertion.
- `index.html`: all failures plus a bounded, evenly distributed sample of review
  candidates, showing original text beside units. This is not every case.
- `review.json`: blank annotation fields for every section plus flagged/failing
  windows. Use acceptable / broad / missing_context / uncertain with cited IDs.

Structural failures return exit code 1 after writing reports. Review warnings
(broad units, reference-sensitive starts, extraction artifacts or unclosed input
structures) are not semantic failures. Counts across overlapping scenarios can
refer to the same underlying source issue repeatedly. A passing run does not
prove factual correctness or context sufficiency; those require human review.

## Execution status

The first audit was run by the user. After its dollar-sign bug was reviewed,
the user explicitly authorized the fix and rerun. The assistant then ran the
complete audit with the corrected splitter: all 4,699 cases and 28,756 assertions
passed. Whole-document units increased from 2,100 to 4,570, and the largest
unit decreased from 610,703 to 9,701 characters (a complete code example).

BuzzDB has now contributed currency regression examples; it is no longer an
unseen validation set for future splitter changes. Semantic quality remains
ungraded; warning counts increased as previously swallowed units became visible.
