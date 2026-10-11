import type { ChatSource } from '../../shared/app-state'
import type { CompactEvidenceDiagnostics, EvidenceBlockKind, EvidenceSpan } from '../../shared/compact-evidence'
import { defaultEvidenceTokenBudget } from '../../shared/compact-evidence'

interface Block { start: number; end: number; kind: EvidenceBlockKind; terms: string[] }
interface Candidate { sourceIndex: number; blocks: number[]; score: number; offset: number }
export interface CompactEvidenceInput {
  question: string
  resolvedQuery?: string
  sources: ChatSource[]
  sourceBudgetTokens: number
  evidenceTokenBudget?: number
  estimateTokens: (text: string) => number
  formatSource: (source: ChatSource) => string
  baselineTokens?: number
  selectedPassage?: boolean
  unsupportedWorkflow?: boolean
}
export interface CompactEvidenceResult {
  sources: ChatSource[]
  diagnostics: CompactEvidenceDiagnostics
}

const omission = '\n\n[Passages omitted]\n\n'
const stopWords = new Set(('a an and are as at be been by can could do does for from how i in is it its me of on or our that the their them there these they this those to us was we were what when where which who why will with would you your explain define needed require requires').split(' '))
function terms(text: string): string[] {
  return [...new Set((text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9][a-z0-9_+#.-]*/g) ?? [])
    .map(token => token.replace(/[.-]+$/, '')).filter(token => token.length >= 2 && !stopWords.has(token)))]
}
function matches(text: string, queryTerms: string[]): string[] {
  const available = new Set(terms(text))
  return queryTerms.filter(term => available.has(term))
}

export function compactTaskFallback(question: string, resolvedQuery = question): string | undefined {
  const protectedTask = /\b(?:summari[sz](?:e|es|ing|ation)|summary|overview|chapter|entire|whole|all\s+(?:sources|steps|items)|list\s+all|comput(?:e|es|ing)|calculat\w*|arithmetic|trace|deriv\w*|prov(?:e|ing)|proof|worked\s+example|complete\s+example|step[- ]by[- ]step|compar\w*|versus|vs\.?|differen\w*|prefer\w*|synthesi[sz]\w*|across\s+(?:sources|documents)|both)\b/i
  if ([question, resolvedQuery].some(text => protectedTask.test(text))) return 'protected-task'
  if ((question.match(/\?/g) ?? []).length > 1 || (resolvedQuery.match(/\?/g) ?? []).length > 1) return 'unknown-task'
  if (!/^(?:what\s+(?:is|are|does)|define\b|why\b|how\b|explain\b)/i.test(resolvedQuery.trim())) return 'unknown-task'
  if (/^(?:why|how|what\s+(?:is|does))\s+(?:it|that|this|they)\b/i.test(resolvedQuery.trim()) || terms(resolvedQuery).length < 2) return 'unresolved-question'
  return undefined
}

// Blank-line paragraphs, with fenced code/math kept whole even across blank lines.
// Offsets always refer to the original retrieved text, including CRLF documents.
function parseBlocks(text: string, queryTerms: string[]): Block[] | undefined {
  const blocks: Block[] = []
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(line => line[0].length)
  let start: number | undefined
  let fence: string | undefined
  let fenceLength = 0
  let math = false
  function add(end: number) {
    if (start === undefined) return
    let begin = start
    while (begin < end && /\s/.test(text[begin])) begin++
    while (end > begin && /\s/.test(text[end - 1])) end--
    if (begin < end) {
      const value = text.slice(begin, end)
      const kind: EvidenceBlockKind = /^(?:```|~~~)/m.test(value) || /^(?: {4}|\t)\S/m.test(value) ? 'code'
        : /\$\$|\\\[|\\\]/.test(value) ? 'equation'
        : /^\s*\|.*\|\s*$/m.test(value) ? 'table'
        : /^\s*(?:[-*+]\s|\d+[.)]\s)/m.test(value) ? 'list'
        : (value.match(/\b\d+(?:\.\d+)?\b/g) ?? []).length >= 3 || /\w\s*[=<>]\s*\w/.test(value) ? 'numeric' : 'prose'
      blocks.push({ start: begin, end, kind, terms: matches(value, queryTerms) })
    }
    start = undefined
  }
  for (const line of lines) {
    const offset = line.index!
    const value = line[0].trim()
    if (!value && !fence && !math) { add(offset); continue }
    if (start === undefined && value) start = offset
    const mark = /^(\s*)(`{3,}|~{3,})/.exec(line[0])
    if (mark) {
      if (!fence) { fence = mark[2][0]; fenceLength = mark[2].length }
      else if (mark[2][0] === fence && mark[2].length >= fenceLength && /^\s*(?:`+|~+)\s*$/.test(value)) fence = undefined
    }
    if (!fence && (value === '$$' || value === '\\[' || value === '\\]')) math = !math
  }
  if (fence || math) return undefined
  add(text.length)
  if (!blocks.length || (blocks.length === 1 && text.length > 1600)) return undefined
  // Markdown lists can contain blank lines between items. Keep adjacent list
  // fragments together so a neighboring list is not reduced to its final item.
  const merged: Block[] = []
  for (const block of blocks) {
    const previous = merged.at(-1)
    if (previous?.kind === 'list' && block.kind === 'list') {
      previous.end = block.end
      previous.terms = matches(text.slice(previous.start, previous.end), queryTerms)
    } else merged.push(block)
  }
  return merged
}

export function selectCompactEvidence(input: CompactEvidenceInput): CompactEvidenceResult {
  const started = performance.now()
  const { sources, estimateTokens, formatSource } = input
  const count = (items: ChatSource[]) => items.reduce((sum, source) => sum + estimateTokens(formatSource(source)), 0)
  const originalTokens = input.baselineTokens ?? count(sources)
  const configuredTarget = input.evidenceTokenBudget ?? defaultEvidenceTokenBudget
  if (!Number.isSafeInteger(configuredTarget) || configuredTarget <= 0) throw new Error('Evidence token budget must be a positive integer.')
  const target = Math.max(0, Math.min(configuredTarget, input.sourceBudgetTokens))
  const diagnostics: CompactEvidenceDiagnostics = {
    requestedMode: 'compact', appliedMode: 'standard', originalEvidenceTokens: originalTokens,
    selectedEvidenceTokens: originalTokens, targetTokens: target, selectionMs: 0,
    sourceIndices: sources.map((_, index) => index), spans: []
  }
  const fallback = (reason: string) => ({ sources, diagnostics: { ...diagnostics, fallbackReason: reason, selectionMs: performance.now() - started } })
  if (input.unsupportedWorkflow) return fallback('unsupported-workflow')
  if (input.selectedPassage) return fallback('selected-passage')
  const taskReason = compactTaskFallback(input.question, input.resolvedQuery)
  if (taskReason) return fallback(taskReason)
  if (originalTokens <= target) return fallback('already-small')
  const queryTerms = terms(input.resolvedQuery ?? input.question)
  const sourceTexts = sources.map(source => source.context || source.excerpt)
  const parsed = sourceTexts.map(text => parseBlocks(text, queryTerms))
  if (parsed.some(blocks => !blocks)) return fallback('ambiguous-structure')
  const blocks = parsed as Block[][]
  const candidates: Candidate[] = []
  blocks.forEach((items, sourceIndex) => items.forEach((block, index) => {
    if (block.kind !== 'prose' || !block.terms.length) return
    candidates.push({ sourceIndex, blocks: [index - 1, index, index + 1].filter(i => i >= 0 && i < items.length), score: block.terms.length, offset: block.start })
  }))
  candidates.sort((a, b) => b.score - a.score || a.sourceIndex - b.sourceIndex || a.offset - b.offset)
  if (!candidates.length) return fallback('no-matches')
  const matchingSources = [...new Set(candidates.map(candidate => candidate.sourceIndex))].sort((a, b) => a - b).slice(0, 2)
  const selected = new Map<number, Set<number>>()
  function add(candidate: Candidate, targetMap = selected) {
    const indices = targetMap.get(candidate.sourceIndex) ?? new Set<number>()
    candidate.blocks.forEach(index => indices.add(index))
    targetMap.set(candidate.sourceIndex, indices)
  }
  function assemble(selection: Map<number, Set<number>>) {
    const result: ChatSource[] = []
    const indices: number[] = []
    const spans: EvidenceSpan[] = []
    const seen = new Map<string, { sourceIndex: number; start: number; end: number }>()
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      const selectedBlocks = [...(selection.get(sourceIndex) ?? [])].sort((a, b) => a - b)
      const groups: number[][] = []
      for (const index of selectedBlocks) {
        const last = groups.at(-1)
        if (last && last.at(-1)! + 1 === index) last.push(index)
        else groups.push([index])
      }
      const slices: string[] = []
      for (const group of groups) {
        const first = blocks[sourceIndex][group[0]], last = blocks[sourceIndex][group.at(-1)!]
        const text = sourceTexts[sourceIndex].slice(first.start, last.end)
        const key = text.replace(/\s+/g, ' ').trim()
        const deduplicable = group.every(index => blocks[sourceIndex][index].kind === 'prose') && !/\d/.test(text)
        // Preserve mandatory anchors even if a different source repeats their text.
        const duplicateOf = !matchingSources.includes(sourceIndex) && deduplicable ? seen.get(key) : undefined
        if (!duplicateOf) {
          slices.push(text)
          if (deduplicable) seen.set(key, { sourceIndex, start: first.start, end: last.end })
        }
        group.forEach(index => {
          const block = blocks[sourceIndex][index]
          spans.push({ sourceIndex, sourceId: sources[sourceIndex].sourceId ?? sources[sourceIndex].sourceUnitId,
            start: block.start, end: block.end, kind: block.kind, matchedTerms: block.terms,
            reason: block.kind === 'prose' && block.terms.length ? 'match' : 'neighbor', ...(duplicateOf ? { duplicateOf } : {}) })
        })
      }
      if (!slices.length) continue
      const text = `${selectedBlocks[0] > 0 ? '[Passages omitted]\n\n' : ''}${slices.join(omission)}${selectedBlocks.at(-1)! < blocks[sourceIndex].length - 1 ? '\n\n[Passages omitted]' : ''}`
      result.push({ ...sources[sourceIndex], context: text, excerpt: text, sourceUnitComplete: text === sourceTexts[sourceIndex] && sources[sourceIndex].sourceUnitComplete !== false })
      indices.push(sourceIndex)
    }
    return { sources: result, indices, spans }
  }
  matchingSources.forEach(sourceIndex => add(candidates.find(candidate => candidate.sourceIndex === sourceIndex)!))
  if (count(assemble(selected).sources) > target) return fallback('mandatory-span-too-large')
  for (const candidate of candidates) {
    const proposal = new Map([...selected].map(([index, value]) => [index, new Set(value)]))
    add(candidate, proposal)
    if (count(assemble(proposal).sources) <= target) { selected.clear(); proposal.forEach((value, index) => selected.set(index, value)) }
  }
  const packet = assemble(selected)
  if (matchingSources.some(index => !packet.indices.includes(index))) return fallback('missing-anchor')
  const foundTerms = new Set(matches(sourceTexts.join('\n'), queryTerms))
  const retainedTerms = new Set(matches(packet.sources.map(source => source.context).join('\n'), queryTerms))
  diagnostics.queryTermCoverage = foundTerms.size ? [...foundTerms].filter(term => retainedTerms.has(term)).length / foundTerms.size : 0
  if (diagnostics.queryTermCoverage < 0.8) return fallback('low-term-coverage')
  const selectedTokens = count(packet.sources)
  if ((originalTokens - selectedTokens) / originalTokens < 0.2) return fallback('insufficient-savings')
  return { sources: packet.sources, diagnostics: { ...diagnostics, appliedMode: 'compact',
    selectedEvidenceTokens: selectedTokens, sourceIndices: packet.indices, spans: packet.spans, selectionMs: performance.now() - started } }
}
