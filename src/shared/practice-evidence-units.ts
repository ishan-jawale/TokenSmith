/** Conservative, local evidence segmentation used by practice generation.
 * Offsets use JavaScript UTF-16 indices and always refer to the untouched input.
 * Ranges partition the entire nonblank passage, including boundary whitespace.
 */
export interface EvidenceUnit {
  id: string
  sourceKey: string
  start: number
  end: number
  text: string
}
interface Region { start: number; end: number; display: boolean }
interface Range { start: number; end: number }

const minFragmentCharacters = 80
const collectiveReference = /\ball (?:the )?above\b|\bboth algorithms\b/i
const previousProblemReference = /\bin (?:chapter|section) [\d.]+,? we solved (?:the|this) problem\b/i
const dotLeaders = /(?:\.\s*){4,}/
const listItem = (text: string) => /^(?:[-*+•]|\d+[.)])[ \t]+/.test(text.trimStart())
const indentedContinuation = (text: string) => /^(?: {2,}|\t)\S/.test(text)
const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end
const contains = (range: Range, position: number) => range.start <= position && position < range.end
const backwardContinuation = /^(?:this|that|these|those|it|its|they|their|such|however|therefore|thus|hence|because|but|then|instead|otherwise|once|after this|both algorithms|for this reason|by using|unlike|while the|the values|what is the|what are the|for example|as an example|as another example|in this|in that|in the example|in practice|initially|always when|first|second|finally|if (?:the|this|it|there)|the (?:algorithm|difference|reason|correctness|time complexity|running time|benefit|idea))\b/i
const structuralProseGuards = [
  /\b(?:for|while|if)\s*\(|\b(?:struct|class)\s+\w+\s*\{/,
  /\b(?:int|bool|void|auto|double|float)\s+\w+\s*(?:[=;(\[])|\[[^\]\n]+\]\s*(?:[+%*/-]?=)|\b(?:sort|dfs)\s*\(/,
  /(?:^|\n)\s*(?:[-*+•]|\d+[.)])\s|\n\s*\n[A-Z]\s*\n/,
  dotLeaders,
  /\b\d+(?:\s+\d+){4,}/
]

function escaped(text: string, index: number): boolean {
  let count = 0
  while (index > 0 && text[--index] === '\\') count++
  return count % 2 === 1
}

function delimiterEnd(text: string, from: number, close: string): number {
  let end = from
  while (end < text.length) {
    if (text.startsWith(close, end) && !escaped(text, end)) return end + close.length
    end++
  }
  return text.length
}

// A single dollar is ambiguous (currency or inline math). Unlike explicit
// display delimiters, it must never protect text across a paragraph boundary.
// Require a plausible closing delimiter; "$50 and $100" is not a math pair.
function inlineDollarEnd(text: string, start: number): number | undefined {
  if (!text[start + 1] || /\s/.test(text[start + 1])) return undefined
  const paragraphBreak = /\r?\n[ \t]*\r?\n/.exec(text.slice(start + 1))
  const limit = paragraphBreak ? start + 1 + paragraphBreak.index : text.length
  for (let end = start + 1; end < limit; end++) {
    if (text[end] !== '$' || escaped(text, end)) continue
    if (/\s/.test(text[end - 1]) || /[\w$]/.test(text[end + 1] ?? '')) return undefined
    return end + 1
  }
  // An unmatched dollar is literal text, not an instruction to consume the book.
  return undefined
}

// Unmatched explicit code/display delimiters protect the remainder. Single
// dollars use bounded, paired recognition instead (they may be currency).
function protectedRegions(text: string): Region[] {
  const regions: Region[] = []
  for (let i = 0; i < text.length;) {
    const atLineStart = i === 0 || text[i - 1] === '\n'
    const fence = atLineStart ? /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/.exec(text.slice(i)) : null
    if (fence) {
      const marker = fence[1][0], size = fence[1].length
      const closer = new RegExp(`^ {0,3}${marker}{${size},}[ \\t]*\\r?$`, 'gm')
      closer.lastIndex = i + fence[0].length
      const end = closer.exec(text)
      const stop = end ? end.index + end[0].length : text.length
      regions.push({ start: i, end: stop, display: true }); i = stop; continue
    }
    if (escaped(text, i)) { i++; continue }
    let open = '', close = '', display = false
    if (text.startsWith('$$', i)) { open = close = '$$'; display = true }
    else if (text.startsWith('\\[', i)) { open = '\\['; close = '\\]'; display = true }
    else if (text.startsWith('\\(', i)) { open = '\\('; close = '\\)' }
    else if (text[i] === '$') {
      const stop = inlineDollarEnd(text, i)
      if (stop !== undefined) { regions.push({ start: i, end: stop, display: false }); i = stop }
      else i++
      continue
    }
    else if (text[i] === '`') { open = close = /^`+/.exec(text.slice(i))![0] }
    if (!open) { i++; continue }
    const stop = delimiterEnd(text, i + open.length, close)
    regions.push({ start: i, end: stop, display }); i = stop
  }
  return regions
}

// Explicit headings are stronger boundaries than sentence-pair heuristics. Match
// numbered sections only after a completed sentence/code statement or at a line
// boundary, so decimal values, numbered citations and inline formulas aren't
// mistaken for headings. The title stays with its following explanation.
function topicRanges(passage: string, range: Range, regions: Region[]): Range[] {
  const text = passage.slice(range.start, range.end)
  // Contents-page dot leaders rule out topic splits before scanning headings.
  if (dotLeaders.test(text)) return [range]
  const candidates = new Set<number>()
  const headings = /(?:^|[.!?};]\s+|\n[ \t]*)(\d{1,2}\.[ \t]*\d{1,2}(?:\.[ \t]*\d{1,2})*[ \t]+(?=[A-Z])|#{1,6}[ \t]+(?=\S))/g
  for (const match of text.matchAll(headings)) {
    const position = range.start + match.index! + match[0].length - match[1].length
    if (position <= range.start || !passage.slice(range.start, position).trim()) continue
    if (regions.some(span => contains(span, position))) continue
    // An explicit scope declaration can govern the algorithm under a later
    // heading (e.g. minimum versus maximum spanning trees). Don't detach it.
    if (/\bwe (?:focus on finding|assume)\b/i.test(passage.slice(range.start, position))) continue
    // Unfenced C++ and mathematical braces still need balanced protection.
    let depth = 0, inQuote = false
    for (let i = range.start; i < position; i++) {
      const span = regions.find(span => contains(span, i))
      if (span) { i = span.end - 1; continue }
      const char = passage[i]
      if ((char === '"' || char === "'") && !escaped(passage, i) &&
        !(char === "'" && /\w/.test(passage[i - 1] ?? '') && /\w/.test(passage[i + 1] ?? ''))) {
        let close = i + 1
        while (close < range.end && (passage[close] !== char || escaped(passage, close))) close++
        if (close >= position) { inQuote = true; break }
        i = close; continue
      }
      if ('([{'.includes(passage[i])) depth++
      if (')]}'.includes(passage[i])) depth = Math.max(0, depth - 1)
    }
    if (depth || inQuote) continue
    const tail = passage.slice(position, range.end).trim()
    // A trailing section label with no body is an upstream fragment, not a unit.
    if (!/[.!?]/.test(tail.replace(/^\d+(?:\.\s*\d+)+\s*/, '')) || tail.length < minFragmentCharacters) continue
    candidates.add(position)
  }
  const starts = [range.start, ...candidates].sort((a, b) => a - b)
  const result: Range[] = []
  for (let i = 0; i < starts.length; i++) {
    const part = { start: starts[i], end: starts[i + 1] ?? range.end }
    if (result.length && collectiveReference.test(passage.slice(part.start, part.end))) {
      result[result.length - 1].end = part.end
    } else result.push(part)
  }
  return result
}

function sentenceRanges(passage: string, range: Range, regions: Region[]): Range[] {
  const sentences: Range[] = []
  let start = range.start, depth = 0, regionIndex = 0
  for (let i = range.start; i < range.end; i++) {
    while (regionIndex < regions.length && regions[regionIndex].end <= i) regionIndex++
    const protectedSpan = regions[regionIndex]
    if (protectedSpan && protectedSpan.start <= i && i < protectedSpan.end) {
      i = Math.min(protectedSpan.end, range.end) - 1; continue
    }
    const char = passage[i]
    if ('([{'.includes(char)) depth++
    if (')]}'.includes(char)) depth = Math.max(0, depth - 1)
    if (depth || !'.!?'.includes(char)) continue
    let end = i + 1
    // Closing quotation marks belong to the preceding sentence.
    while (end < range.end && /["'”’]/u.test(passage[end])) end++
    const gap = /^\s+/.exec(passage.slice(end, range.end))
    if (!gap) continue
    const next = end + gap[0].length
    if (!/[A-Z]/.test(passage[next] ?? '')) continue
    const word = /([A-Za-z.]+)$/.exec(passage.slice(start, i))?.[1] ?? ''
    if (char === '.' && (/^[A-Za-z]$/.test(word) || /^(?:e\.g|i\.e|etc|vs|Fig|Eq|Dr|Mr|Mrs|Prof|No|St)$/i.test(word))) continue
    sentences.push({ start, end: next }); start = next; i = next - 1
  }
  if (start < range.end) sentences.push({ start, end: range.end })
  return sentences
}

// Prefer small sentence groups in ordinary flattened prose. Never run this on
// code, lists, display math, diagrams or index-like extraction: without layout,
// punctuation in those regions is not a reliable sentence boundary.
function groupProse(passage: string, range: Range, regions: Region[]): Range[] {
  const text = passage.slice(range.start, range.end)
  // These references may depend on several earlier sentences/groups. Without
  // semantic resolution, retaining the parent block is safer than a detached ID.
  if (collectiveReference.test(text) || previousProblemReference.test(text)) return [range]
  if (regions.some(span => span.display && overlaps(span, range)) ||
    structuralProseGuards.some(pattern => pattern.test(text))) return [range]
  const sentences = sentenceRanges(passage, range, regions)
  const groups: Range[] = []
  let count = 0
  for (const sentence of sentences) {
    const nextText = passage.slice(sentence.start, sentence.end).trimStart()
    const previous = groups.at(-1)
    const dependent = backwardContinuation.test(nextText)
    if (previous && (count < 2 || dependent || passage.slice(previous.start, previous.end).trimEnd().endsWith(':'))) {
      previous.end = sentence.end; count++
    } else { groups.push({ ...sentence }); count = 1 }
  }
  // A dangling heading or a truncated formula must not become a tiny citation.
  if (groups.length > 1) {
    const last = groups[groups.length - 1]
    const tail = passage.slice(last.start, last.end).trim()
    if (tail.length < minFragmentCharacters && !/[.!?]["'”’]*$/u.test(tail)) {
      groups[groups.length - 2].end = last.end; groups.pop()
    }
  }
  return groups
}

function paragraphBlocks(passage: string, protectedSpans: Region[]): Range[] {
  const ranges: Range[] = []
  let start = 0
  for (const match of passage.matchAll(/\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*/g)) {
    const boundary = match.index! + match[0].length
    if (protectedSpans.some(span => match.index! < span.end && boundary > span.start)) continue
    ranges.push({ start, end: boundary }); start = boundary
  }
  if (start < passage.length) ranges.push({ start, end: passage.length })
  // Mark boundaries to remove. Decisions use original paragraphs, so a merge
  // cannot accidentally turn an equation block into ordinary prose mid-pass.
  const join = new Set<number>()
  const contents = ranges.map(range => passage.slice(range.start, range.end).trim())
  let inList = false
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i], text = contents[i]
    if (listItem(text)) inList = true
    else if (!indentedContinuation(passage.slice(range.start, range.end))) inList = false
    const protectedBlock = protectedSpans.some(span => span.display && overlaps(span, range))
    if (protectedBlock) {
      if (i > 0) join.add(i - 1)
      if (i + 1 < ranges.length) join.add(i)
    }
    // Short fragments/headings attach forward; a trailing fragment attaches back.
    if (text.length < minFragmentCharacters) {
      if (i + 1 < ranges.length) join.add(i)
      else if (i > 0) join.add(i - 1)
    }
    if (i + 1 < ranges.length && (text.endsWith(':') || listItem(contents[i + 1]) ||
      (inList && indentedContinuation(passage.slice(ranges[i + 1].start, ranges[i + 1].end))) ||
      /^(?:therefore|thus|hence|this algorithm|this equation|this recurrence)\b/i.test(contents[i + 1]))) join.add(i)
  }
  const blocks: Range[] = []
  for (let i = 0; i < ranges.length; i++) {
    if (i > 0 && join.has(i - 1)) blocks[blocks.length - 1].end = ranges[i].end
    else blocks.push({ ...ranges[i] })
  }
  return blocks
}

/** Labels must be distinct for different passages in a request. No text repair,
 * length-based slicing, semantic interpretation, or model calls are performed.
 */
export function createEvidenceUnits(passage: string, sourceKey: string, passageId: string): EvidenceUnit[] {
  if (!sourceKey.trim() || !/^[A-Za-z0-9_-]+$/.test(passageId)) throw new Error('Supply a source key and a safe, request-unique passage ID.')
  if (!passage.trim()) return []
  const protectedSpans = protectedRegions(passage)
  const blocks = paragraphBlocks(passage, protectedSpans)
  const groups = blocks.flatMap(range => topicRanges(passage, range, protectedSpans))
    .flatMap(range => groupProse(passage, range, protectedSpans))
  return groups.map((range, index) => ({ id: `${passageId}-E${index + 1}`, sourceKey, ...range,
    text: passage.slice(range.start, range.end) }))
}

/** Render the same labeled units for production prompts and offline previews. */
export function formatEvidenceUnits(units: EvidenceUnit[]): string {
  if (new Set(units.map(unit => unit.id)).size !== units.length) throw new Error('Duplicate evidence IDs.')
  return units.map(unit => `Evidence ID: ${unit.id}\n${unit.text}`).join('\n\n')
}
