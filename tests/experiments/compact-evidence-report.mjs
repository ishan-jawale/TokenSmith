// Pure reporting helpers; importing this module performs no model calls.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
const finite = value => typeof value === 'number' && Number.isFinite(value)
const mean = (runs, field) => average(runs.map(run => run[field]).filter(finite))
const seconds = value => finite(value) ? (value / 1000).toFixed(2) : '—'
const percent = value => finite(value) ? `${value.toFixed(1)}%` : '—'
const text = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')

export function pairedSummary(report, review = {}) {
  const pairs = []
  const rows = report.cases.map(definition => {
    const standard = [], compact = []
    for (let repeat = 0; repeat < report.repeats; repeat++) {
      const a = report.runs.find(run => run.caseId === definition.id && run.repeat === repeat && run.mode === 'standard')
      const b = report.runs.find(run => run.caseId === definition.id && run.repeat === repeat && run.mode === 'compact')
      if (a?.status === 'complete' && b?.status === 'complete' && finite(a.answerReadyMs) && finite(b.answerReadyMs)) {
        standard.push(a); compact.push(b); pairs.push([a, b])
      }
    }
    const a = mean(standard, 'answerReadyMs'), b = mean(compact, 'answerReadyMs')
    const judged = [...standard, ...compact].map(run => review[run.id]?.verdict ?? 'pending')
    const quality = judged.length && judged.every(verdict => verdict === 'pass') ? 'All inspected answers pass'
      : judged.some(verdict => ['incorrect', 'incomplete'].includes(verdict)) ? 'Quality issue recorded' : 'Review pending'
    return { id: definition.id, question: definition.question, pairedRuns: standard.length,
      standardMs: a, compactMs: b, changePercent: a > 0 && finite(b) ? 100 * (a - b) / a : null,
      selectionMs: mean(compact, 'selectionMs'),
      applied: compact.filter(run => run.evidenceDiagnostics?.appliedMode === 'compact').length,
      fallback: compact.filter(run => run.evidenceDiagnostics?.appliedMode === 'standard').length,
      failures: report.runs.filter(run => run.caseId === definition.id && run.status !== 'complete').length,
      standardPromptTokens: average(standard.flatMap(run => run.calls.filter(call => call.stage === 'answer').map(call => call.promptTokens)).filter(finite)),
      compactPromptTokens: average(compact.flatMap(run => run.calls.filter(call => call.stage === 'answer').map(call => call.promptTokens)).filter(finite)),
      standardOutputTokens: average(standard.flatMap(run => run.calls.filter(call => call.stage === 'answer').map(call => call.outputTokens)).filter(finite)),
      compactOutputTokens: average(compact.flatMap(run => run.calls.filter(call => call.stage === 'answer').map(call => call.outputTokens)).filter(finite)), quality }
  })
  // Match the same successful pairs in both averages. Incomplete pairs are visible,
  // never silently compared against a larger set from the other arm.
  const standardMs = mean(pairs.map(pair => pair[0]), 'answerReadyMs')
  const compactMs = mean(pairs.map(pair => pair[1]), 'answerReadyMs')
  const appliedPairs = pairs.filter(pair => pair[1].evidenceDiagnostics?.appliedMode === 'compact')
  return { rows, pairCount: pairs.length, standardMs, compactMs,
    changePercent: standardMs > 0 && finite(compactMs) ? 100 * (standardMs - compactMs) / standardMs : null,
    appliedStandardMs: mean(appliedPairs.map(pair => pair[0]), 'answerReadyMs'),
    appliedCompactMs: mean(appliedPairs.map(pair => pair[1]), 'answerReadyMs'), appliedPairs: appliedPairs.length,
    completeTenCaseComparison: rows.length === 10 && rows.every(row => row.pairedRuns === report.repeats) }
}

export function writeComparisonArtifacts(directory, report, review = {}) {
  const summary = pairedSummary(report, review)
  const lines = ['# Compact evidence comparison', '',
    `Model: ${report.model?.ollamaModelName ?? 'not connected'}. Evidence target: ${report.evidenceTokenBudget} estimated tokens. Repeats: ${report.repeats}.`, '',
    'Answer-ready time includes selection, production preparation, verification if applicable, network/server waiting, and complete answer generation. Frozen retrieval time and later follow-up generation are recorded separately. This is an engine experiment, not a UI measurement.', '',
    'Both arms use the normal TokenSmith prompt and identical model settings. No sampling overrides, extra judge model, retry, or cache reset is added. Reference answers are for review only.', '',
    '| Question | Paired runs | Standard avg (s) | Compact avg (s) | Time saved | Selector avg (ms) | Applied / fallback | Quality |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...summary.rows.map(row => `| ${text(row.question)} | ${row.pairedRuns} | ${seconds(row.standardMs)} | ${seconds(row.compactMs)} | ${percent(row.changePercent)} | ${finite(row.selectionMs) ? row.selectionMs.toFixed(2) : '—'} | ${row.applied} / ${row.fallback} | ${row.quality} |`), '',
    `Overall matched-pair average: standard ${seconds(summary.standardMs)}s; compact ${seconds(summary.compactMs)}s; time saved ${percent(summary.changePercent)} (${summary.pairCount} pairs).`, '',
    `Applied-only matched-pair average: standard ${seconds(summary.appliedStandardMs)}s; compact ${seconds(summary.appliedCompactMs)}s (${summary.appliedPairs} pairs).`, '',
    summary.completeTenCaseComparison ? 'All ten cases completed their planned pairs.' : 'The ten-case comparison is incomplete. Missing/failed runs remain in results.json; these averages describe only completed matched pairs.', '',
    '## Prompt and output diagnostics', '',
    '| Case | Standard prompt tokens | Compact prompt tokens | Standard output tokens | Compact output tokens | Failures |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...summary.rows.map(row => `| ${row.id} | ${[row.standardPromptTokens, row.compactPromptTokens, row.standardOutputTokens, row.compactOutputTokens].map(v => finite(v) ? v.toFixed(1) : '—').join(' | ')} | ${row.failures} |`), '',
    '## Quality review', '',
    'Inspect each saved answer and its supplied passages against the reference facts in answers.md. Set review.json verdicts to pass, incomplete, or incorrect and add a reason; then rerun the script with --summarize. Query-term coverage is a source-selection guard, not an automatic answer-quality score. Until all required answers are reviewed, quality preservation is unverified.', '',
    'Output lengths, prompt caching, shared-server load, and ordinary sampling variation can affect latency. Token reduction alone does not prove improved speed or preserved quality.', '']
  writeFileSync(join(directory, 'comparison.md'), lines.join('\n'))
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  const header = ['question', 'paired_runs', 'standard_avg_ms', 'compact_avg_ms', 'time_saved_percent', 'selection_avg_ms', 'compact_applied', 'fallback', 'quality', 'failures']
  const csv = value => `"${String(value ?? '').replaceAll('"', '""')}"`
  writeFileSync(join(directory, 'comparison.csv'), [header, ...summary.rows.map(row => [row.question, row.pairedRuns, row.standardMs, row.compactMs,
    row.changePercent, row.selectionMs, row.applied, row.fallback, row.quality, row.failures])].map(row => row.map(csv).join(',')).join('\n') + '\n')
  const answers = ['# Answers for quality review', '', 'Reference answers below are evaluation-only; they are never sent to Gemma or the selector.', '']
  for (const definition of report.cases) {
    answers.push(`## ${definition.id}`, '', definition.question, '', `Reference: ${definition.referenceAnswer}`, '')
    for (const run of report.runs.filter(run => run.caseId === definition.id)) {
      answers.push(`### ${run.id}`, '', `Status: ${run.status}; review: ${review[run.id]?.verdict ?? 'pending'}.`, '',
        run.answer?.text ?? run.error ?? 'No answer available.', '',
        `Applied mode: ${run.evidenceDiagnostics?.appliedMode ?? 'standard'}; fallback: ${run.evidenceDiagnostics?.fallbackReason ?? 'none'}.`, '',
        '<details><summary>Actual supplied source evidence</summary>', '', run.evidenceText || 'No answer request evidence captured.', '</details>', '')
    }
  }
  writeFileSync(join(directory, 'answers.md'), answers.join('\n'))
  return summary
}
