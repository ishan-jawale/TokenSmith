export type EvidenceMode = 'standard' | 'compact'
export const defaultEvidenceTokenBudget = 2000

export interface EvidenceSelectionOptions {
  mode?: EvidenceMode
  evidenceTokenBudget?: number
}
export type EvidenceBlockKind = 'prose' | 'code' | 'list' | 'table' | 'equation' | 'numeric'

export interface EvidenceSpan {
  sourceIndex: number
  sourceId?: string
  start: number
  end: number
  kind: EvidenceBlockKind
  matchedTerms: string[]
  reason: 'match' | 'neighbor'
  duplicateOf?: { sourceIndex: number; start: number; end: number }
}

export interface CompactEvidenceDiagnostics {
  requestedMode: EvidenceMode
  appliedMode: EvidenceMode
  fallbackReason?: string
  originalEvidenceTokens: number
  selectedEvidenceTokens: number
  selectionMs: number
  targetTokens: number
  queryTermCoverage?: number
  // Indices refer to the original retrieval snapshot, before packing or preflight.
  sourceIndices: number[]
  spans: EvidenceSpan[]
}
