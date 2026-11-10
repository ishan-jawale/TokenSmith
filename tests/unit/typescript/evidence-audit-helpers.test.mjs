// Synthetic tests of the audit infrastructure; never opens the BuzzDB book.
import test from 'node:test'
import assert from 'node:assert/strict'
import { scanMarkdown, assertUnitIntegrity, assertProtectedBoundaries, sectionCases, windowCases, reviewWarnings, escapeHtml } from '../../../scripts/lib/evidence-audit.mjs'
const text = 'Alpha. Beta.'
const units = [{ id: 'P1-E1', sourceKey: 's', start: 0, end: text.length, text }]
test('audit accepts exact text and rejects lost, overlapping, relabeled and rewritten output', () => {
  assertUnitIntegrity(text, units, 's', 'P1')
  for (const change of [{ start: 1 }, { end: 3 }, { id: 'P2-E1' }, { sourceKey: 'other' }, { text: 'changed' }]) {
    assert.throws(() => assertUnitIntegrity(text, [{ ...units[0], ...change }], 's', 'P1'))
  }
  assert.throws(() => assertUnitIntegrity(text, [units[0], units[0]], 's', 'P1'))
  assertUnitIntegrity(' \n', [], 's', 'P1')
})
for (const [open, close] of [['```cpp', '```'], ['~~~~', '~~~~'], ['$$', '$$'], ['\\[', '\\]']]) {
  test(`audit protects ${open} and ignores headings in its body`, () => {
    const t = `# Actual\r\n${open}\r\n## Hidden\r\n\r\nbody\r\n${close}\r\n# Next\r\n`
    const scan = scanMarkdown(t)
    assert.equal(scan.headings.length, 2)
    assert.equal(scan.protectedRanges.length, 1)
    assertProtectedBoundaries([{ end: t.length }], scan.protectedRanges)
    assert.throws(() => assertProtectedBoundaries([{ end: t.indexOf('body') + 1 }], scan.protectedRanges))
    const sections = sectionCases(t, scan.headings)
    assert.equal(sections.map(c => t.slice(c.start, c.end)).join(''), t)
  })
}
test('audit identifies unclosed fences and excludes their fake headings', () => {
  const s = scanMarkdown('Intro\n```\n# Fake')
  assert.equal(s.headings.length, 0)
  assert.equal(s.protectedRanges[0].unclosed, true)
})
test('overlapping windows cover every source position without a lost tail', () => {
  const t = 'a'.repeat(43), windows = windowCases(t, 12, 3)
  assert.equal(windows.at(-1).end, 43)
  for (let i = 0; i < t.length; i++) assert.ok(windows.some(w => w.start <= i && i < w.end))
  assert.throws(() => windowCases(t, 12, 12))
  assert.deepEqual(windowCases('', 12, 3), [])
})
test('warnings are review flags rather than assertions of semantic failure', () => {
  const t = 'However, this follows.\ufffe' + 'x'.repeat(3001)
  assert.deepEqual(reviewWarnings(t, [{ id: 'P1-E1', text: t }]).map(w => w.kind), ['broad_unit', 'context_sensitive_start', 'extraction_artifact'])
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;')
})
