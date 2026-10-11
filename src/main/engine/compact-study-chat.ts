// Opt-in experiment only. No production entry point imports this module.
import type { EngineChatRequest, EngineChatResponse, EngineRunOptions } from '../../shared/engine'
import type { ChatSource } from '../../shared/app-state'
import type { CompactEvidenceDiagnostics, EvidenceSelectionOptions } from '../../shared/compact-evidence'
import { selectCompactEvidence } from './compact-evidence'
import { packSourceContext, prepareStudyChatMessages, usesGemma4E4BBudget } from './study-chat-format'
import { runOllamaStudyEngine } from './ollama-service'

export interface CompactStudyChatPreparation {
  request: EngineChatRequest
  diagnostics: CompactEvidenceDiagnostics
  prepared: ReturnType<typeof prepareStudyChatMessages>
}

export function prepareCompactStudyChat(request: EngineChatRequest, selection: EvidenceSelectionOptions = {}): CompactStudyChatPreparation {
  const started = performance.now()
  const baseline = prepareStudyChatMessages(request)
  const original = request.retrievedSources ?? []
  const selected = selectCompactEvidence({
    question: request.prompt, resolvedQuery: request.retrievalQuery ?? request.answerPrompt ?? request.prompt,
    sources: original, sourceBudgetTokens: baseline.budget.sourceBudgetTokens,
    evidenceTokenBudget: selection.evidenceTokenBudget,
    baselineTokens: baseline.budget.usedSourceTokens,
    selectedPassage: Boolean(request.selectedPassage),
    // Keep this prototype on the agreed model; other adapters are unchanged.
    unsupportedWorkflow: Boolean(request.answerToSimplify) || request.model.engine !== 'ollama' ||
      !/^gemma4:12b(?:$|-)/i.test(request.model.ollamaModelName ?? ''),
    estimateTokens: text => Math.ceil(text.length / (usesGemma4E4BBudget(request.model) ? 2.5 : 4)),
    // Reuse the production source labels instead of inventing a second prompt format.
    formatSource: source => packSourceContext([source], { includeInstructions: false }).context.replace(/^### Context:\n/, '')
  })
  let diagnostics = selected.diagnostics
  if (diagnostics.appliedMode === 'compact') {
    // The source array is the sole changed request field. Runtime settings,
    // question, history, instructions, and generation options retain identity.
    const compactRequest = { ...request, retrievedSources: selected.sources }
    const compact = prepareStudyChatMessages(compactRequest)
    if (compact.sources.length === selected.sources.length && compact.budget.truncatedSourceCount === 0 &&
        compact.budget.usedSourceTokens <= diagnostics.targetTokens) {
      return { request: compactRequest, prepared: compact,
        diagnostics: { ...diagnostics, selectedEvidenceTokens: compact.budget.usedSourceTokens, selectionMs: performance.now() - started } }
    }
    diagnostics = { ...diagnostics, appliedMode: 'standard', fallbackReason: 'packet-does-not-fit', spans: [] }
  }
  return { request, prepared: baseline, diagnostics: { ...diagnostics,
    sourceIndices: baseline.sources.map(source => original.indexOf(source)), selectedEvidenceTokens: baseline.budget.usedSourceTokens,
    selectionMs: performance.now() - started } }
}

export interface CompactStudyChatResponse extends EngineChatResponse {
  evidenceDiagnostics: CompactEvidenceDiagnostics
}

export async function runCompactStudyChat(request: EngineChatRequest, options: EngineRunOptions = {},
  selection: EvidenceSelectionOptions = {}): Promise<CompactStudyChatResponse> {
  options.signal?.throwIfAborted()
  const preparation = prepareCompactStudyChat(request, selection)
  const supplied = preparation.request.retrievedSources ?? []
  const original = request.retrievedSources ?? []
  const mapSource = (source: ChatSource) => {
    if (preparation.diagnostics.appliedMode !== 'compact') return source
    const index = supplied.indexOf(source)
    return index < 0 ? source : original[preparation.diagnostics.sourceIndices[index]]
  }
  const mapAnswer = (answer: EngineChatResponse): CompactStudyChatResponse => ({
    ...answer, sources: answer.sources.map(mapSource), evidenceDiagnostics: preparation.diagnostics
  })
  const answer = await runOllamaStudyEngine(preparation.request, {
    ...options, onAnswer: options.onAnswer ? (value, hasFollowUps) => options.onAnswer!(mapAnswer(value), hasFollowUps) : undefined
  })
  return mapAnswer(answer)
}

export function runStudyChatWithEvidence(request: EngineChatRequest, selection: EvidenceSelectionOptions = {},
  options: EngineRunOptions = {}): Promise<EngineChatResponse & { evidenceDiagnostics?: CompactEvidenceDiagnostics }> {
  if (!selection.mode || selection.mode === 'standard') return runOllamaStudyEngine(request, options)
  if (selection.mode !== 'compact') throw new Error('Unknown evidence mode.')
  return runCompactStudyChat(request, options, selection)
}
