// Offline evidence-context preview only; does not call a model or modify app data.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { requireTranspiledTs } from '../tests/unit/typescript/ts-module-loader.mjs'
import { escapeHtml as esc } from './lib/evidence-audit.mjs'
const { createEvidenceUnits, formatEvidenceUnits } = requireTranspiledTs('src/shared/practice-evidence-units.ts')
const { values } = parseArgs({ options: { 'out-dir': { type: 'string', default: 'tmp/practice-evidence-preview' } } })
const corpus = JSON.parse(readFileSync('tests/fixtures/practice-evidence/handbook-passages.json', 'utf8'))
const passages = corpus.passages.map((passage, i) => {
  const units = createEvidenceUnits(passage.text, passage.sourceKey, `P${i + 1}`)
  return { ...passage, units, evidenceContextPreview: formatEvidenceUnits(units) }
})
const stats = { passages: passages.length, units: passages.reduce((n, p) => n + p.units.length, 0),
  splitPassages: passages.filter(p => p.units.length > 1).length,
  intactPassages: passages.filter(p => p.units.length === 1).length }
const out = resolve(values['out-dir']); mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'evidence-units.json'), JSON.stringify({ book: corpus.book, bookSha256: corpus.bookSha256, stats, passages }, null, 2) + '\n')
writeFileSync(resolve(out, 'evidence-context-preview.txt'), passages.map(p => `=== ${p.id} ===\n${p.evidenceContextPreview}`).join('\n\n'))
writeFileSync(resolve(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Practice evidence split review</title><style>
body{font:16px/1.55 system-ui;margin:32px auto;max-width:1400px;padding:0 24px;color:#172536;background:#f5f7fa}h1{margin-bottom:6px}header{margin-bottom:28px}.note{background:#e7eef7;padding:16px;border-radius:8px}details{background:white;border:1px solid #ccd5df;border-radius:8px;margin:14px 0;padding:16px}summary{cursor:pointer;font-weight:650}.columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 ui-monospace,monospace;background:#f5f7fa;padding:14px;border-radius:6px}.unit{border-left:3px solid #16796e;padding-left:12px}small{color:#506175}@media(max-width:800px){.columns{grid-template-columns:1fr}}
</style><header><h1>Practice evidence split review</h1><p><a href="review.md">Read the full manual annotation ledger</a></p><p>${esc(corpus.book)}</p><p><b>${stats.passages}</b> actual extracted passages · <b>${stats.units}</b> evidence units · <b>${stats.splitPassages}</b> passages split · <b>${stats.intactPassages}</b> kept intact</p><p class="note">Offline split review. The right-hand preview shows the labeled evidence section, not the complete generation prompt. Production True/False prompts use the same splitter and formatter. No model calls are made. Extracted PDF defects are deliberately preserved.</p></header>
${passages.map(p => `<details ${p.units.length > 1 ? 'open' : ''}><summary>${esc(p.id)} — ${p.units.length} unit${p.units.length === 1 ? '' : 's'}</summary><small>Source ${esc(p.sourceKey)} · first seen ${esc(p.firstSeen)}</small><div class="columns"><section><h2>Original extraction</h2><pre>${esc(p.text)}</pre></section><section><h2>Evidence context preview</h2>${p.units.map(u => `<article class="unit"><b>${esc(u.id)}</b> <small>UTF-16 offsets [${u.start}, ${u.end})</small><pre>${esc(u.text)}</pre></article>`).join('')}</section></div></details>`).join('\n')}</html>`)
console.log(JSON.stringify(stats, null, 2))
console.log(`Open split preview: ${resolve(out, 'index.html')}`)
console.log(`Exact proposed evidence context: ${resolve(out, 'evidence-context-preview.txt')}`)
console.log(`IDs, offsets, provenance and original text: ${resolve(out, 'evidence-units.json')}`)
