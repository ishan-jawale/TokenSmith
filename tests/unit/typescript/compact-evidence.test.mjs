import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { requireTranspiledTs } from './ts-module-loader.mjs'

const { selectCompactEvidence, compactTaskFallback } = requireTranspiledTs('src/main/engine/compact-evidence.ts')
const { prepareCompactStudyChat, runStudyChatWithEvidence } = requireTranspiledTs('src/main/engine/compact-study-chat.ts')
const { prepareStudyChatMessages } = requireTranspiledTs('src/main/engine/study-chat-format.ts')
const { runOllamaStudyEngine } = requireTranspiledTs('src/main/engine/ollama-service.ts')
const settings = JSON.parse(readFileSync('tests/experiments/compact-evidence-settings.json', 'utf8')).settings

const filler = 'Unrelated storage material describes disk geometry and historical implementation details. '.repeat(12)
const source = (title, text) => ({ title, locator: title, sourceId: title, context: text, excerpt: text, sourceUnitComplete: true })
const sources = [source('alpha', [filler, filler, 'A quasar anchor introduces the condition.',
  'The quasar beacon preserves a stable signal.', 'The next paragraph explains that stable signal.', filler, filler].join('\n\n')),
  source('beta', [filler, 'A beacon anchor provides neighboring context.', 'A quasar beacon maintains a stable signal.',
    'A complete explanation follows the beacon.', filler, filler].join('\n\n'))]
const request = overrides => ({ prompt: 'Why is a quasar beacon stable?', messages: [], materials: [], settings,
  applicationSettings: { ...settings.application, suggestionMode: 'off' }, modelSettings: { ...settings.modelDefaults },
  model: { id: 'ollama:gemma4:12b', name: 'Gemma 12B', engine: 'ollama', ollamaModelName: 'gemma4:12b', contextLength: 131072 },
  retrievedSources: structuredClone(sources), ...overrides })
// Keep the small selector fixtures at their original budget; the runner test
// verifies the configurable experiment default independently.
const input = overrides => ({ question: 'Why is a quasar beacon stable?', sources: structuredClone(sources), sourceBudgetTokens: 6000, evidenceTokenBudget: 1500,
  estimateTokens: text => Math.ceil(text.length / 4), formatSource: s => `Source ${s.title}\n${s.context}\nEnd source`, ...overrides })

test('selection is dynamic, deterministic, source-preserving, and does not mutate inputs', () => {
  const original = input(), saved = structuredClone(original.sources)
  const a = selectCompactEvidence(original), b = selectCompactEvidence(original)
  assert.equal(a.diagnostics.appliedMode, 'compact')
  assert.deepEqual(a.sources, b.sources)
  assert.deepEqual(a.diagnostics.spans, b.diagnostics.spans)
  assert.deepEqual(original.sources, saved)
  assert.ok(a.diagnostics.selectedEvidenceTokens <= 1500)
  assert.ok(a.diagnostics.queryTermCoverage >= 0.8)
  for (const span of a.diagnostics.spans) {
    if (span.duplicateOf) continue
    const selected = a.sources[a.diagnostics.sourceIndices.indexOf(span.sourceIndex)].context
    assert.ok(selected.includes(saved[span.sourceIndex].context.slice(span.start, span.end)))
  }
  assert.ok(a.sources.some(s => s.sourceUnitComplete === false))
  const different = selectCompactEvidence(input({ question: 'Why does disk geometry matter?' }))
  assert.notDeepEqual(different.diagnostics.spans, a.diagnostics.spans)
})

test('budget is configurable, validated, and bounded by the normal source allowance', () => {
  const reduced = selectCompactEvidence(input({ evidenceTokenBudget: 700 }))
  assert.equal(reduced.diagnostics.targetTokens, 700)
  assert.equal(reduced.diagnostics.appliedMode, 'compact')
  assert.ok(reduced.diagnostics.selectedEvidenceTokens <= 700)
  assert.equal(selectCompactEvidence(input({ evidenceTokenBudget: 2400, sourceBudgetTokens: 900 })).diagnostics.targetTokens, 900)
  for (const evidenceTokenBudget of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => selectCompactEvidence(input({ evidenceTokenBudget })), /positive integer/)
  }
  const small = selectCompactEvidence(input({ evidenceTokenBudget: 50 }))
  assert.equal(small.diagnostics.appliedMode, 'standard')
  assert.equal(small.diagnostics.fallbackReason, 'mandatory-span-too-large')
})

test('coverage and savings guards restore original inputs before generation', () => {
  const extra = source('technical', ['An unrelated introduction.', '```cpp\n// nebula oscillator resonant\n' + filler.repeat(3) + '\n```', 'An unrelated ending.'].join('\n\n'))
  const original = input({ question: 'Why is a quasar beacon stable and a nebula oscillator resonant?', sources: [...structuredClone(sources), extra] })
  const coverage = selectCompactEvidence(original)
  assert.equal(coverage.diagnostics.fallbackReason, 'low-term-coverage')
  assert.strictEqual(coverage.sources, original.sources)
  assert.equal(coverage.diagnostics.spans.length, 0)
  const dense = Array.from({ length: 20 }, (_, index) =>
    `The quasar beacon is stable under condition ${index}. ${'Additional explanatory prose. '.repeat(16)}`).join('\n\n')
  const result = selectCompactEvidence(input({ sources: [source('dense', dense)], evidenceTokenBudget: 2400 }))
  assert.equal(result.diagnostics.fallbackReason, 'insufficient-savings')
})

test('task routing protects broad and quantitative tasks rather than just question openings', () => {
  for (const question of ['Why is a B+ tree preferred over a binary tree?', 'Summarise an entire chapter',
    'Explain the complete worked example', 'How do I calculate a sum?', 'Trace the accumulator',
    'Prove this result', 'What is the difference between OLTP and OLAP?', 'Synthesize across sources']) {
    assert.equal(compactTaskFallback(question), 'protected-task', question)
  }
  assert.equal(compactTaskFallback('Why does this work?'), 'unresolved-question')
  assert.equal(compactTaskFallback('Tell me more about quasar beacons'), 'unknown-task')
  assert.equal(compactTaskFallback('Why is a quasar beacon stable? Why does it fail?'), 'unknown-task')
  assert.equal(compactTaskFallback('Why is a quasar beacon stable?'), undefined)
  assert.equal(selectCompactEvidence(input({ selectedPassage: true })).diagnostics.fallbackReason, 'selected-passage')
})

test('unclear boundaries, nonmatches, small packets, and lexical paraphrases fall back', () => {
  assert.equal(selectCompactEvidence(input({ sources: [source('huge', 'quasar '.repeat(500))], baselineTokens: 3000 })).diagnostics.fallbackReason, 'ambiguous-structure')
  assert.equal(selectCompactEvidence(input({ sources: [source('broken', '```cpp\nquasar\n\n' + filler)], baselineTokens: 3000 })).diagnostics.fallbackReason, 'ambiguous-structure')
  assert.equal(selectCompactEvidence(input({ question: 'Why is a nebula oscillator resonant?' })).diagnostics.fallbackReason, 'no-matches')
  assert.equal(selectCompactEvidence(input({ sources: [source('small', 'A quasar beacon is stable.')] })).diagnostics.fallbackReason, 'already-small')
  assert.equal(selectCompactEvidence(input({ unsupportedWorkflow: true })).diagnostics.fallbackReason, 'unsupported-workflow')
})

test('code with internal blank lines, equations, lists, and tables stay intact as neighbors', () => {
  for (const block of ['```cpp\nint signal = 1;\n\nreturn signal;\n```', '$$\nx = y\n\n+ z\n$$',
    '- Preserve the first condition\n\n- Preserve the second condition', '| Condition | Effect |\n| --- | --- |\n| Stable | Preserved |']) {
    const text = [filler.repeat(3), filler.repeat(3), block, 'The quasar beacon preserves a stable signal.', 'The following explanation completes the condition.', filler].join('\n\n')
    const result = selectCompactEvidence(input({ sources: [source('protected', text)] }))
    assert.equal(result.diagnostics.appliedMode, 'compact', block)
    assert.ok(result.sources[0].context.includes(block))
  }
})

test('compact preparation changes only sources and reuses the exact production prompt outside evidence', () => {
  const original = request(), saved = structuredClone(original)
  const normal = prepareStudyChatMessages(original)
  const compact = prepareCompactStudyChat(original, { evidenceTokenBudget: 1500 })
  assert.equal(compact.diagnostics.appliedMode, 'compact')
  for (const key of Object.keys(original).filter(key => key !== 'retrievedSources')) assert.strictEqual(compact.request[key], original[key], key)
  assert.deepEqual(original, saved)
  assert.equal(compact.prepared.messages[0].content, normal.messages[0].content)
  const outsideEvidence = messages => messages.at(-1).content.replace(/### Context:[\s\S]*?(?=\n\nQuestion:)/, '[EVIDENCE]')
  assert.equal(outsideEvidence(compact.prepared.messages), outsideEvidence(normal.messages))
  assert.equal(compact.prepared.budget.truncatedSourceCount, 0)
  const protectedRequest = request({ prompt: 'Compare quasar beacons and nebula oscillators.' })
  const fallback = prepareCompactStudyChat(protectedRequest)
  assert.strictEqual(fallback.request, protectedRequest)
  assert.deepEqual(fallback.prepared.messages, prepareStudyChatMessages(protectedRequest).messages)
})

test('resolved query scores passages while original question and reference exchange stay intact', () => {
  const original = request({ prompt: 'Why does this work?', retrievalQuery: 'Why is a quasar beacon stable?',
    conversationContextMode: 'contextual', referenceExchange: { question: 'What is a quasar beacon?', answer: 'A stable signal.' } })
  const compact = prepareCompactStudyChat(original, { evidenceTokenBudget: 1500 })
  assert.equal(compact.diagnostics.appliedMode, 'compact')
  assert.match(compact.prepared.messages.at(-1).content, /Question: Why does this work\?/)
  assert.strictEqual(compact.request.referenceExchange, original.referenceExchange)
})

test('normal mode is byte-for-byte the existing service path; compact alters only answer source content', async () => {
  const savedFetch = globalThis.fetch, bodies = []
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body))
    return { ok: true, json: async () => ({ done_reason: 'stop', message: { content: 'The quasar beacon is stable.' }, prompt_eval_count: 2000, eval_count: 20 }) }
  }
  try {
    const original = request()
    const production = await runOllamaStudyEngine(original)
    const normal = await runStudyChatWithEvidence(original)
    assert.deepEqual(normal, production)
    assert.deepEqual(bodies[0], bodies[1])
    let published
    const compact = await runStudyChatWithEvidence(original, { mode: 'compact', evidenceTokenBudget: 1500 }, { onAnswer: value => { published = value } })
    assert.equal(bodies.length, 3, 'no extra inference calls')
    const withoutMessages = body => Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'messages'))
    assert.deepEqual(withoutMessages(bodies[2]), withoutMessages(bodies[0]))
    assert.equal(bodies[2].messages[0].content, bodies[0].messages[0].content)
    assert.equal(compact.evidenceDiagnostics.appliedMode, 'compact')
    assert.equal(published.text, compact.text)
    assert.deepEqual(published.sources, compact.sources)
    assert.deepEqual(published.evidenceDiagnostics, compact.evidenceDiagnostics)
    assert.ok(compact.sources.every(s => original.retrievedSources.includes(s)), 'original records retained for navigation')
    const controller = new AbortController(); controller.abort()
    await assert.rejects(runStudyChatWithEvidence(original, { mode: 'compact' }, { signal: controller.signal }), /abort/i)
    assert.equal(bodies.length, 3)
  } finally { globalThis.fetch = savedFetch }
})

test('normal settings fixture preserves current model defaults and suggestion prompts', () => {
  const app = readFileSync('src/renderer/src/App.tsx', 'utf8')
  for (const [key, value] of Object.entries({ contextLength: 8192, maxLength: 1536, temperature: 0.7, topP: 0.4, topK: 40, minP: 0, repeatPenalty: 1.18 })) {
    assert.match(app, new RegExp(`${key}: ${value}`))
    assert.equal(settings.modelDefaults[key], value)
  }
  const defaults = requireTranspiledTs('src/shared/model-defaults.ts')
  assert.equal(settings.modelDefaults.suggestedFollowUpPrompt, defaults.defaultSuggestedFollowUpPrompt)
  assert.equal(settings.modelDefaults.starterQuestionPrompt, defaults.defaultStarterQuestionPrompt)
  assert.equal(settings.application.suggestionMode, 'on')
})
