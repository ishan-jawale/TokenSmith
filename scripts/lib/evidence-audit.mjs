// Generic audit helpers. No book is opened here and no splitter rules are imported.
import assert from 'node:assert/strict'

/** Independent, line-oriented Markdown structure scanner for test oracles.
 * It tracks fenced code and standalone display math, not semantic dependencies.
 */
export function scanMarkdown(text) {
  const protectedRanges = [], headings = []
  let active = null, offset = 0
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const content = line.replace(/\r?\n$/, '')
    if (active) {
      const closes = active.kind === 'code'
        ? new RegExp(`^ {0,3}${active.marker}{${active.length},}[ \\t]*$`).test(content)
        : content.trim() === active.close
      if (closes) { protectedRanges.push({ start: active.start, end: offset + line.length, kind: active.kind }); active = null }
    } else {
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(content)
      if (fence) active = { start: offset, kind: 'code', marker: fence[1][0], length: fence[1].length }
      else if (['$$', '\\['].includes(content.trim())) active = { start: offset, kind: 'display_math', close: content.trim() === '$$' ? '$$' : '\\]' }
      else if (/^ {0,3}#{1,6}[ \t]+\S/.test(content)) headings.push({ start: offset, title: content.trim() })
    }
    offset += line.length
  }
  if (active) protectedRanges.push({ start: active.start, end: text.length, kind: active.kind, unclosed: true })
  return { protectedRanges, headings }
}

export function assertUnitIntegrity(text, units, sourceKey, label) {
  if (!text.trim()) { assert.deepEqual(units, []); return }
  assert.ok(units.length, 'Nonblank text must produce units')
  assert.equal(new Set(units.map(u => u.id)).size, units.length, 'IDs must be unique')
  let position = 0
  for (const [i, unit] of units.entries()) {
    assert.equal(unit.id, `${label}-E${i + 1}`, 'IDs must be sequential and label-scoped')
    assert.equal(unit.sourceKey, sourceKey, 'Source mapping must be retained')
    assert.ok(Number.isInteger(unit.start) && Number.isInteger(unit.end), 'Offsets must be integers')
    assert.equal(unit.start, position, 'No gap or overlap is permitted')
    assert.ok(unit.end > unit.start && unit.end <= text.length, 'Invalid range')
    assert.equal(unit.text, text.slice(unit.start, unit.end), 'Text must equal the exact input slice')
    assert.ok(unit.text.trim(), 'Whitespace-only evidence is not useful')
    position = unit.end
  }
  assert.equal(position, text.length, 'The last unit must reach the input end')
  assert.equal(units.map(u => u.text).join(''), text, 'No input characters may be lost or rewritten')
}

export function assertProtectedBoundaries(units, ranges) {
  for (const span of ranges) {
    for (const unit of units) {
      // A newline following a closing delimiter may belong to the next unit;
      // allow that terminal whitespace while protecting the actual syntax/body.
      const end = span.contentEnd ?? span.end
      assert.ok(!(span.start < unit.end && unit.end < end), `${span.kind} split at offset ${unit.end}`)
    }
  }
}

export function sectionCases(text, headings) {
  const starts = [...new Set([0, ...headings.map(h => h.start)])].sort((a, b) => a - b)
  return starts.map((start, i) => ({ kind: 'section', start, end: starts[i + 1] ?? text.length,
    title: headings.find(h => h.start === start)?.title ?? 'Front matter' }))
    .filter(c => text.slice(c.start, c.end).trim())
}

export function windowCases(text, size, overlap) {
  assert.ok(Number.isInteger(size) && size > 0 && overlap >= 0 && overlap < size)
  const cases = []
  for (let start = 0; start < text.length;) {
    const end = Math.min(text.length, start + size)
    cases.push({ kind: `window_${size}`, start, end, title: `Clipped window [${start}, ${end})` })
    if (end === text.length) break
    start += size - overlap
  }
  return cases
}

export function reviewWarnings(text, units) {
  const warnings = []
  if (!units.length) return warnings
  for (const unit of units) {
    if (unit.text.length > 3000) warnings.push({ id: unit.id, kind: 'broad_unit', note: 'Over 3,000 characters; review whether this conservative block is useful.' })
    if (/^(?:however|therefore|thus|it|this|these|both|the above)\b/i.test(unit.text.trimStart())) warnings.push({ id: unit.id, kind: 'context_sensitive_start', note: 'Possible backward reference; human review required, not an automatic error.' })
    if (/\ufffd|\ufffe/.test(unit.text)) warnings.push({ id: unit.id, kind: 'extraction_artifact', note: 'Input already contains replacement/noncharacter code points.' })
  }
  for (const span of scanMarkdown(text).protectedRanges) if (span.unclosed) warnings.push({ kind: 'unclosed_structure', note: 'Input ends with an unclosed fence/display delimiter; may be caused by artificial window clipping.' })
  return warnings
}

export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
