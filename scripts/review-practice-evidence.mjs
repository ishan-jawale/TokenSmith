// Render the frozen manual review; never infer semantic quality from test results.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { 'out-dir': { type: 'string', default: 'tmp/practice-evidence-preview' } } })
const out = resolve(values['out-dir'])
const review = JSON.parse(readFileSync('tests/fixtures/practice-evidence/handbook-reviewed-65.json', 'utf8'))
const preview = JSON.parse(readFileSync(resolve(out, 'evidence-units.json'), 'utf8'))
const counts = {}
const fixes = new Set(['P4-E3', 'P29-E2', 'P34-E2'])
// Follow-up manual inspection of explicit section transitions in the book.
const topicFixes = new Set(['P9-E1', 'P16-E2', 'P17-E1', 'P22-E2', 'P27-E1', 'P29-E1', 'P31-E1', 'P39-E2', 'P40-E2'])
function disposition(unit) {
  if (fixes.has(unit.id)) return 'Context restored by conservative backward-reference fallback; covered by a targeted regression test.'
  if (topicFixes.has(unit.id)) return 'Explicit numbered heading now separates the reviewed topics; textbook-specific regression test verifies the boundary.'
  if (unit.boundaryAssessment === 'unnecessarily_broad') return 'Broadness recorded; finer code/diagram/topic segmentation remains open.'
  return 'No boundary correction required; source issues remain independent.'
}
const rows = review.units.map(unit => {
  if (createHash('sha256').update(unit.text).digest('hex') !== unit.textSha256) throw new Error(`Changed review snapshot: ${unit.id}`)
  counts[unit.boundaryAssessment] = (counts[unit.boundaryAssessment] ?? 0) + 1
  const passage = preview.passages.find(p => p.id === unit.passageId)
  if (!passage || passage.text.slice(unit.start, unit.end) !== unit.text) throw new Error(`Review no longer matches source: ${unit.id}`)
  const currentUnits = passage.units.filter(u => u.start < unit.end && u.end > unit.start).map(u => u.id)
  return { ...unit, currentUnits, disposition: disposition(unit) }
})
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'review.json'), JSON.stringify({ method: review.method, originalCounts: counts,
  currentSegmentation: preview.stats, units: rows }, null, 2) + '\n')
const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
const report = [
  '# Manual evidence-split review', '',
  review.method, '',
  '## Findings', '',
  `Reviewed all **${rows.length} original units**: **${counts.acceptable} acceptable boundaries**, **${counts.unnecessarily_broad} unnecessarily broad units**, **${counts.split_missing_context} splits missing context**.`, '',
  'Acceptable is a boundary judgment, not a claim that the unit is factual, complete, or suitable for question generation. It includes explicitly conservative fallbacks. Source issue labels describe the original passage and may affect only part of a unit.', '',
  'Three context-breaking splits were corrected:', '',
  '- P4-E3: retain complexity classes with “all the above” references.',
  '- P29-E2: retain the coin-task objective with the later reference to “the problem.”',
  '- P34-E2: retain both named algorithms when the text compares “both algorithms.”', '',
  `Current output: **${preview.stats.units} units from ${preview.stats.passages} passages**. Original IDs below belong to the frozen review; the current-ID column maps them by original source offsets, not by unstable unit numbers.`, '',
  '**Follow-up topic review: 9 of the original 14 broad units now have explicit section boundaries; five remain conservative fallbacks (P11-E1, P19-E1, P21-E1, P25-E1, P26-E1).** The original judgments are preserved below. Source extraction is not repaired; this is not a declaration of perfect segmentation.', '',
  '## Full annotation ledger', '',
  '| Original unit | Current unit(s) | Boundary assessment | Reason | Original passage issues | Follow-up disposition |',
  '|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.id} | ${r.currentUnits.join(', ')} | ${r.boundaryAssessment} | ${cell(r.reason)} | ${r.sourceIssues.join(', ') || 'None noted'} | ${cell(r.disposition)} |`), '',
  '## Remaining work', '',
  '- Broad units: mixed code/prose and section transitions need separate design review; no forced text-size cuts were added.',
  '- Input defects: clipped formulas/proofs, missing diagram layout, tables of contents/indexes, and references outside supplied passages remain visible.',
  '- BuzzDB audit findings and currency regressions are documented in docs/buzzdb-evidence-audit.md. BuzzDB is no longer an unseen validation set.',
  '- Production True/False generation uses evidence IDs. This report reviews splitting boundaries; prompt integration is covered by the ID-mapping tests, and question quality requires separate review.', '',
  'Reproduce with `npm run test:evidence-units`. The raw annotations, original text, offsets and source identifiers are in `review.json` and the frozen fixture `tests/fixtures/practice-evidence/handbook-reviewed-65.json`.', ''
].join('\n')
writeFileSync(resolve(out, 'review.md'), report)
console.log(`Manual review: ${resolve(out, 'review.md')}`)
console.log(`Original boundary judgments: ${JSON.stringify(counts)}`)
