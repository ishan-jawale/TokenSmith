# Evidence units and ID citations

Run from the TokenSmith repository:

```bash
npm run test:evidence-units
```

Or invoke `bash scripts/test-practice-evidence.sh` from any directory. Dependencies
are the repository's existing Node/TypeScript dependencies. No Ollama, Ada, PDF
runtime, model downloads, or network connection are needed.

This runs splitter and ID-mapping tests (with mocked providers) and generates:

- `tmp/practice-evidence-preview/index.html`: original extraction beside units.
- `tmp/practice-evidence-preview/evidence-context-preview.txt`: the proposed labeled evidence section.
- `tmp/practice-evidence-preview/evidence-units.json`: originals, IDs, exact UTF-16 offsets, and provenance.

Optional: `npm run test:evidence-units -- --out-dir tmp/another-preview`.
Generated previews are disposable; rerun the command to reproduce them.

## Scope and actual source material

`tests/fixtures/practice-evidence/handbook-passages.json` freezes 44 distinct,
verbatim passages from the supplied Competitive Programmer's Handbook by Antti
Laaksonen (draft August 2, 2017), as retained in the November 9 benchmark. It
includes the book hash and source identities. No paragraph breaks, math markup,
or repaired characters were inserted to make segmentation look better. Only this
book is represented. Additional equations and Markdown/code delimiter cases in
the test file are explicitly synthetic, not textbook quotations.

The preview is the standalone splitter review, not the full generation prompt.
True/False generation is now wired to evidence IDs through the production prompt
builder and ID resolver; see the integration section below. The historical split
preview is not proof of that integration.
It labels all fixture passages for inspection; production generation includes
only its selected, budgeted passages.

## Rules

- Scan fenced backtick/tilde code, inline backticks, dollar math, and LaTeX
  bracket/parenthesis math as protected spans; escaped delimiters are ignored.
- First find paragraph boundaries outside protected spans. In ordinary prose,
  also detect sentence endings outside balanced parentheses and explicit code/math.
  Preserve initials, common abbreviations, decimals, and original whitespace.
- Group ordinary sentences in pairs, extending the group for explicit backward
  references, qualifications, and example steps. This is a heuristic, not semantic
  proof that each group is independently sufficient evidence.
- Keep flattened C++/code, lists, numeric diagrams, and index-like dot leaders
  together. Do not treat punctuation in those structures as sentence boundaries.
- Keep protected display/code blocks with their immediately adjacent paragraphs.
- Join colon introductions, lists, short fragments/headings (under 80 characters),
  and a small explicit set of connective phrases. These are heuristics, not
  semantic dependency detection. Over-merging is an intentional tradeoff.
- An unmatched explicit code/display delimiter protects the remainder. Single
  dollar math requires a plausible pair within one paragraph; unmatched dollars
  are literal text. Flattened code stays intact;
  there is no arbitrary maximum-length slicing or reconstruction of damaged math.
- Preserve every input character, including whitespace and PDF defects. Units
  partition nonblank input exactly; each unit stores its original character range.
- IDs are deterministic within a passage. The caller must supply distinct passage
  labels within each request; duplicate labels are rejected by the preview formatter.

## Reviewing results

Check that equations/code are not cut and that scope/qualifications remain with
claims. Inspect retained larger blocks too: the splitter cannot recover lost PDF
layout, filter table-of-contents entries, or decide factual support. An unknown
semantic dependency can cross paragraphs. The splitter cannot guarantee that
any unit is sufficient evidence for a generated claim.

The frozen corpus currently yields 67 units: 29 passages stay intact and 15
split. Tests cover exact text/offset preservation for all 44 passages, plus
explicit textbook boundary checks (Dijkstra qualifications, Bellman–Ford
conditions, Edmonds–Karp versus scaling, common-prefix context, DP lists and BFS
examples). Synthetic tests cover independent prose grouping and formatting edges.

Passing tests is not a claim of perfect semantic segmentation. The PDF extraction
includes truncated formulas, missing diagrams, and flattened code. This code
preserves those defects and cannot reconstruct omitted context. Inspect the HTML
preview manually when changing splitting rules.

## Manual review and regression ledger

The full command also writes `review.md` and `review.json` in the preview output
directory. `handbook-reviewed-65.json` freezes all 65 units reviewed before the
latest corrections, including exact text, source offsets, hashes, per-unit manual
judgments and separate source-level issues. Original judgments: 48 acceptable
boundaries, 14 unnecessarily broad units and three context-breaking splits.

The three missing-context cases now have direct regression tests. References to
all-the-above, both algorithms, or a previously solved problem conservatively
retain the parent block instead of splitting away the referent. The 14 broad units were recorded separately at that stage; the topic-heading
follow-up below resolves nine and retains five as conservative fallbacks. Original and current IDs
are mapped by source offsets in the ledger. Passing tests verifies the stated
constraints; it does not establish general semantic completeness. BuzzDB audit
instructions and findings are recorded separately in `docs/buzzdb-evidence-audit.md`.

## Explicit topic headings

Before prose grouping, detect numbered sections (including PDF spacing such as
`6. 1`) and Markdown headings. The heading remains attached to its body.
Candidates inside protected math, fenced/inline code, balanced brackets, or
quoted strings are ignored. Contents-page dot leaders, dangling labels and
headings whose following block refers back to both/all earlier items are kept
conservative. Only explicit boundaries are used; unmarked topic shifts are not
guessed. Nine reviewed broad units now have section boundaries with direct book
regressions; five remain broad fallbacks. Original manual labels remain frozen
and the regenerated review records each follow-up disposition.

A preceding explicit scope declaration (such as "We focus on finding minimum
spanning trees") prevents a heading split that could detach the restriction.

## Cleanup and independent audit tooling

The segmentation pipeline is organized into protected-region scanning, paragraph
blocks, explicit topic boundaries, sentence ranges, and conservative grouping.
Shared character/overlap predicates and named rule constants avoid duplicated
regular expressions. The cleanup preserves the exact Algorithms output (all
67 unit IDs, offsets and texts), verified against a pre-cleanup snapshot.

`npm run test:evidence-units` also tests the audit helpers on synthetic inputs.
It does not open BuzzDB. The separate, opt-in BuzzDB command and all output
interpretation details are documented in `docs/buzzdb-evidence-audit.md`.

## Dollar-sign correction

Single-dollar inline math is recognized only with a nonwhitespace opening, a
nonwhitespace closing, and no word/digit/dollar immediately after the closing
delimiter. It cannot cross a blank paragraph. This prevents ordinary amounts
such as `$50 and $100` from pairing across unrelated sections. Escaped currency
and code remain literal. Valid pairs such as `$2^n$`, `$100$`, and `$O(n^2)$`
remain protected. Multi-line inline math may use a single line break, but blank
paragraphs require explicit display math instead. Unmatched single dollars no
longer consume the remainder. Explicit `$$`, `\[` and code-fence handling are
unchanged. These are syntactic heuristics, not a complete currency/math parser.

Five verbatim BuzzDB currency lines and synthetic multi-chapter regressions
cover the observed bug. All 67 Algorithms units remain unchanged. The rerun
produced no structural failures; large complete code blocks and semantic
context warnings remain separate review concerns.

## Current production integration

True/False generation uses the units via `practice-evidence-citations.ts`,
`study-chat-format.ts`, `quiz.ts`, and `practice-client.ts`. Passage labels are
assigned before context packing; the labeled text is counted in the budget.
The model selects evidenceIds; only retained evidence can resolve to saved
sourceKey/quote pairs. Saved sources omit temporary labels. Legacy saved
question parsing, topic discovery and feedback remain compatible.
Integration tests verify actual prompt text/schema, multiple-unit lookup,
invalid IDs, dropped passages, label stability, overhead budgeting and retries.

The resolver looks up IDs directly; it does not serialize a second package or
search again for copied quotes. Shared question-field validation supports both
ID packages and legacy quote packages. Duplicate passage identities/labels are
rejected, and labeled evidence is rendered once per passage per packing pass.
ID mode always retains complete passages rather than clipping their units.

The mapping review also covers identical text in distinct sources, reordered
passages, the six-ID limit, and both providers through response parsing. The
Ollama test forces both estimated-budget dropping and measured-token dropping
to verify labels survive both stages. These tests verify citation provenance;
they cannot judge whether the model selected semantically sufficient evidence.
