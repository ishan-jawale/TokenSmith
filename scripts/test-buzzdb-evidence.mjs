// OPT-IN: opens BuzzDB only when the user explicitly runs this script.
// No LLM, embeddings, installed app profile, network calls or production writes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { performance } from 'node:perf_hooks'
import { requireTranspiledTs } from '../tests/unit/typescript/ts-module-loader.mjs'
import { scanMarkdown, assertUnitIntegrity, assertProtectedBoundaries, sectionCases, windowCases, reviewWarnings, escapeHtml as esc } from './lib/evidence-audit.mjs'

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const { values } = parseArgs({ options: {
  book: { type: 'string', default: 'tests/fixtures/buzzdb/buzzdb-book.tokensmith.md' },
  out: { type: 'string' }, help: { type: 'boolean' }
} })
if (values.help) {
  console.log('Usage: npm run test:evidence-buzzdb -- [--book /path/to/book.md] [--out NEW_DIRECTORY]\nOffline whole-book, section, adjacent-section and clipped-window splitter audit.\nWrites summary.md, results.json, cases.jsonl, review.json and index.html.\nFails on structural violations; warnings and semantic review remain separate.\nNo model calls. Existing output directories are never overwritten.')
  process.exit(0)
}
const bookPath = resolve(values.book)
if (!/\.(?:md|markdown|txt)$/i.test(bookPath)) throw new Error('Supply the Markdown/text book, not a PDF; no extraction conversion is performed by this audit.')
const input = readFileSync(bookPath, 'utf8')
if (!input.trim()) throw new Error('Book is empty.')
const output = resolve(values.out ?? `tmp/buzzdb-evidence-${new Date().toISOString().replaceAll(':', '-')}`)
if (existsSync(output)) throw new Error(`Output already exists; choose a new --out directory: ${output}`)
mkdirSync(dirname(output), { recursive: true }); mkdirSync(output)
const hash = text => createHash('sha256').update(text).digest('hex')
const splitterPath = 'src/shared/practice-evidence-units.ts'
const { createEvidenceUnits, formatEvidenceUnits } = requireTranspiledTs(splitterPath)
const structures = scanMarkdown(input)
const sections = sectionCases(input, structures.headings)
const cases = [
  { kind: 'whole_book', start: 0, end: input.length, title: 'Complete original Markdown document' },
  ...sections,
  ...sections.slice(0, -1).map((section, i) => ({ kind: 'adjacent_sections', start: section.start, end: sections[i + 1].end,
    title: `${section.title} + next section` })),
  ...windowCases(input, 1000, 250), ...windowCases(input, 2400, 600)
]
// Independently identified fenced blocks/display math get isolation tests too.
for (const span of structures.protectedRanges) cases.push({ kind: `isolated_${span.kind}`, start: span.start, end: span.end,
  title: `${span.kind} [${span.start}, ${span.end})` })
const started = performance.now(), results = [], review = [], previewCandidates = []
const summary = { status: 'running', book: bookPath, bookSha256: hash(input), splitterSha256: hash(readFileSync(splitterPath)),
  runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), helperSha256: hash(readFileSync('scripts/lib/evidence-audit.mjs')),
  createdAt: new Date().toISOString(), inputCharacters: input.length,
  sourceStructures: { headings: structures.headings.length, protectedBlocks: structures.protectedRanges.length },
  semanticQuality: 'ungraded', cases: 0, assertions: 0, failedCases: 0, warnings: 0, kinds: {} }
writeFileSync(resolve(output, 'cases.jsonl'), '')
for (const [index, specification] of cases.entries()) {
  const id = `B${index + 1}`, text = input.slice(specification.start, specification.end)
  const row = { id, ...specification, characters: text.length, assertions: [], errors: [], warnings: [], units: [] }
  const caseStart = performance.now()
  const check = (name, fn) => {
    summary.assertions++
    try { fn(); row.assertions.push({ name, status: 'pass' }) }
    catch (error) { row.errors.push({ name, message: error.message }); row.assertions.push({ name, status: 'fail' }) }
  }
  try {
    row.units = createEvidenceUnits(text, 'buzzdb', id)
    check('exact coverage, text, offsets, source mapping and unique sequential IDs', () => assertUnitIntegrity(text, row.units, 'buzzdb', id))
    check('deterministic repeated generation', () => assert.deepEqual(createEvidenceUnits(text, 'buzzdb', id), row.units))
    check('renaming IDs does not change boundaries or content', () => {
      const renamed = createEvidenceUnits(text, 'buzzdb', `Q${index + 1}`)
      assert.deepEqual(renamed.map(({ id, ...u }) => u), row.units.map(({ id, ...u }) => u))
    })
    const spans = scanMarkdown(text).protectedRanges.map(span => ({ ...span,
      contentEnd: span.end - (text.slice(0, span.end).endsWith('\r\n') ? 2 : text.slice(0, span.end).endsWith('\n') ? 1 : 0) }))
    check('independently scanned fences/display math remain uncut', () => assertProtectedBoundaries(row.units, spans))
    check('labeled evidence preview contains every original unit in order', () => {
      assert.equal(formatEvidenceUnits(row.units), row.units.map(u => `Evidence ID: ${u.id}\n${u.text}`).join('\n\n'))
    })
    check('CRLF variant preserves all variant text and protected structures', () => {
      const crlf = text.replace(/\r?\n/g, '\r\n'), units = createEvidenceUnits(crlf, 'buzzdb-crlf', id)
      assertUnitIntegrity(crlf, units, 'buzzdb-crlf', id)
      assertProtectedBoundaries(units, scanMarkdown(crlf).protectedRanges.map(span => ({ ...span,
        contentEnd: span.end - (crlf.slice(0, span.end).endsWith('\r\n') ? 2 : 0) })))
    })
    if (specification.kind.startsWith('isolated_')) check('isolated protected block remains present within one unit', () => {
      const wrapped = `The following evidence block is shown without changes:\n\n${text}\n\nThis explanation belongs to the preceding block.`
      const units = createEvidenceUnits(wrapped, 'buzzdb-wrapped', id)
      assertUnitIntegrity(wrapped, units, 'buzzdb-wrapped', id)
      assert.ok(units.some(unit => unit.text.includes(text)))
    })
    row.warnings = reviewWarnings(text, row.units)
  } catch (error) { row.errors.push({ name: 'splitter execution', message: error.message }) }
  row.seconds = (performance.now() - caseStart) / 1000
  row.status = row.errors.length ? 'fail' : 'pass'
  summary.cases++; summary.failedCases += Number(row.status === 'fail'); summary.warnings += row.warnings.length
  const kind = summary.kinds[row.kind] ??= { cases: 0, failed: 0, units: 0 }
  kind.cases++; kind.failed += Number(row.status === 'fail'); kind.units += row.units.length
  appendFileSync(resolve(output, 'cases.jsonl'), JSON.stringify(row) + '\n')
  results.push({ ...row, units: undefined })
  // Include every section in the manual form; warning/failing windows are added.
  if (row.kind === 'section' || row.errors.length || row.warnings.length) review.push({ id, kind: row.kind, start: row.start, end: row.end,
    warningKinds: [...new Set(row.warnings.map(w => w.kind))], boundaryQuality: '', contextSufficiency: '', notes: '' })
  if (row.kind === 'section' || row.errors.length || row.warnings.length) previewCandidates.push({ ...row, original: text })
  if ((index + 1) % 100 === 0) console.log(`${index + 1}/${cases.length} cases checked; ${summary.failedCases} structural failures`)
}
summary.status = summary.failedCases ? 'failed' : 'complete'
summary.seconds = (performance.now() - started) / 1000
summary.finishedAt = new Date().toISOString()
writeFileSync(resolve(output, 'results.json'), JSON.stringify({ ...summary, results }, null, 2) + '\n')
writeFileSync(resolve(output, 'review.json'), JSON.stringify({ instructions: 'UNREVIEWED. For each case inspect cases.jsonl or the HTML. Mark boundaryQuality and contextSufficiency acceptable / broad / missing_context / uncertain. Cite exact units. Warning flags are not semantic judgments. Clipped windows may deliberately omit context or opening/closing delimiters.', cases: review }, null, 2) + '\n')
const preview = previewCandidates.filter(c => c.errors.length)
const remaining = previewCandidates.filter(c => !c.errors.length)
// Bound HTML size while covering the document evenly; JSONL retains all cases.
const stride = Math.max(1, Math.ceil(remaining.length / 120))
for (let i = 0; i < remaining.length; i += stride) preview.push(remaining[i])
writeFileSync(resolve(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuzzDB evidence audit</title><style>body{font:16px/1.5 system-ui;max-width:1400px;margin:30px auto;padding:0 24px;background:#f6f8fa;color:#172536}details{background:white;border:1px solid #cbd5df;border-radius:8px;padding:16px;margin:14px 0}summary{cursor:pointer;font-weight:bold}.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 monospace;background:#f0f3f6;padding:14px}.notice{background:#fff1d0;padding:16px}.fail{color:#a12622}@media(max-width:800px){.cols{grid-template-columns:1fr}}</style><h1>BuzzDB evidence audit</h1><p>${summary.cases} cases · ${summary.assertions} assertions · ${summary.failedCases} failing cases · ${summary.warnings} review flags (may overlap across windows)</p><p class="notice">Structural tests only. Semantic quality is ungraded. This HTML shows ${preview.length} selected cases; cases.jsonl contains every case and every evidence unit. Artificial windows deliberately clip source material. All sections appear in review.json for human review. No model calls were made.</p>${preview.map(c => `<details><summary>${esc(c.id)} — ${esc(c.kind)} — ${esc(c.title)}</summary><p class="fail">${c.errors.map(e => esc(e.name + ': ' + e.message)).join('<br>')}</p><p>${c.warnings.map(w => esc(w.kind)).join(', ')}</p><div class="cols"><section><h2>Original [${c.start}, ${c.end})</h2><pre>${esc(c.original)}</pre></section><section><h2>Evidence units</h2>${c.units.map(u => `<h3>${esc(u.id)} [${u.start}, ${u.end})</h3><pre>${esc(u.text)}</pre>`).join('')}</section></div></details>`).join('\n')}</html>`)
writeFileSync(resolve(output, 'summary.md'), [
  '# BuzzDB splitter audit', '', `Status: ${summary.status}. Semantic quality: **ungraded**.`, '',
  `Input: ${bookPath}`, `Book SHA-256: ${summary.bookSha256}`, `Splitter SHA-256: ${summary.splitterSha256}`, '',
  `${summary.cases} cases; ${summary.assertions} assertions; ${summary.failedCases} failing cases; ${summary.warnings} review flags; ${summary.seconds.toFixed(2)} seconds.`, '',
  '| Scenario | Cases | Failing cases | Units |', '|---|---:|---:|---:|',
  ...Object.entries(summary.kinds).map(([kind, result]) => `| ${kind} | ${result.cases} | ${result.failed} | ${result.units} |`), '',
  'Structural failures exit nonzero. Broad-unit, reference and extraction warnings require human review, not automatic rejection. Counts across overlapping cases are not counts of distinct defects.', '',
  'Open index.html for a bounded visual sample, cases.jsonl for all raw text/units/assertions, results.json for the machine summary, and review.json for blank per-case human annotations. Token use, question quality and generation latency are not measured. The audit does not exercise production document indexing or prompt generation.', ''
].join('\n'))
console.log(`BuzzDB audit: ${summary.status}; ${summary.cases} cases; ${summary.failedCases} structural failures.`)
console.log(`Summary: ${resolve(output, 'summary.md')}\nReview preview: ${resolve(output, 'index.html')}\nAll units: ${resolve(output, 'cases.jsonl')}`)
if (summary.failedCases) process.exitCode = 1
