import type { ChatSource } from './app-state'
import { practiceSourceKey } from './practice'
import { createEvidenceUnits, formatEvidenceUnits } from './practice-evidence-units'

export function labelPracticeSources(sources: ChatSource[]): ChatSource[] {
  const labels = new Set<string>(), identities = new Set<string>()
  return sources.map((source, index) => {
    const label = source.practiceEvidenceLabel ?? `P${index + 1}`
    const key = practiceSourceKey(source)
    if (labels.has(label)) throw new Error('Duplicate practice passage labels.')
    if (identities.has(key)) throw new Error('Duplicate practice source identities.')
    labels.add(label); identities.add(key)
    return source.practiceEvidenceLabel === label ? source : { ...source, practiceEvidenceLabel: label }
  })
}

export function practiceEvidenceUnits(source: ChatSource) {
  if (!source.practiceEvidenceLabel) throw new Error('Missing practice passage label.')
  return createEvidenceUnits(source.context || source.excerpt, practiceSourceKey(source), source.practiceEvidenceLabel)
}

export function practiceEvidenceText(source: ChatSource): string {
  return formatEvidenceUnits(practiceEvidenceUnits(source))
}

export function withoutPracticeLabel(source: ChatSource): ChatSource {
  const { practiceEvidenceLabel: _label, ...original } = source
  return original
}
