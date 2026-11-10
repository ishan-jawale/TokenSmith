import assert from 'node:assert/strict'
import test from 'node:test'
import { requireTranspiledTs } from './ts-module-loader.mjs'
const { labelPracticeSources, practiceEvidenceUnits, practiceEvidenceText } = requireTranspiledTs('src/shared/practice-evidence-citations.ts')
const { parsePracticeQuestionFromEvidenceIds, practiceResponseSchema, practiceSystemPrompt } = requireTranspiledTs('src/shared/quiz.ts')
const { prepareStudyChatMessages, packSourceContext } = requireTranspiledTs('src/main/engine/study-chat-format.ts')
const { createPracticeClient } = requireTranspiledTs('src/renderer/src/practice-client.ts')
const { runOllamaStudyEngine } = requireTranspiledTs('src/main/engine/ollama-service.ts')
const { runRemoteStudyEngine } = requireTranspiledTs('src/main/engine/remote-chat-service.ts')
const original = { materialId: 'book', documentId: 1, chunkId: 'first', title: 'Algorithms', locator: 'Chapter 2',
  excerpt: 'An algorithm with consecutive phases has a total time complexity determined by the slowest phase in the algorithm.\n\nA recursive function can make many calls, and the number of calls and work per call must be considered together.' }
const sources = labelPracticeSources([original, { ...original, chunkId: 'second' }])
const data = { statement: 'Sequential phases are dominated by the slowest phase.', objective: 'Compare phase complexity.', assumptions: [],
  criteria: [{ id: 'c1', description: 'Identify the dominating phase.', evidenceIds: ['P1-E1'] }],
  correctAnswer: true, explanation: 'The total is dominated by the slowest phase.', hint: 'Consider the largest term.', questionAssessment: 'Supported by the first unit.', questionIssue: '' }
const parse = (value = data, supplied = sources) => parsePracticeQuestionFromEvidenceIds(JSON.stringify(value), supplied)
const request = { practiceTask: 'true_false_question', prompt: '{"questionNumber":1}', messages: [], materials: [], settings: {},
  retrievedSources: sources, model: { engine: 'ollama', name: 'Test', contextLength: 8192 },
  modelSettings: { contextLength: 8192, maxLength: 1024 } }

test('prompt renders the real splitter units and schema asks for IDs, not copied quotes', () => {
  const prepared = prepareStudyChatMessages(request)
  const prompt = prepared.messages.map(m => m.content).join('\n')
  for (const source of sources) assert.ok(prompt.includes(practiceEvidenceText(source)))
  assert.match(prompt, /Evidence ID: P1-E1/)
  assert.match(prompt, /Evidence ID: P1-E2/)
  assert.match(prompt, /Evidence ID: P2-E1/)
  assert.match(prompt, /evidenceIds/)
  assert.doesNotMatch(practiceSystemPrompt('true_false_question'), /short exact quote|Copy a continuous span/)
  const criteria = practiceResponseSchema('true_false_question').properties.criteria.items.properties
  assert.deepEqual(Object.keys(criteria), ['id', 'description', 'evidenceIds'])
  assert.equal(criteria.evidenceIds.maxItems, 6)
})
test('ID lookup saves original source references and text, without temporary labels', () => {
  const result = parse()
  assert.deepEqual(result.sources, [original])
  assert.equal(result.rubric.criteria[0].evidence[0].quote, practiceEvidenceUnits(sources[0])[0].text.trim())
  assert.equal(result.rubric.criteria[0].evidence[0].sourceKey, 'book:1:first')
  assert.ok(!JSON.stringify(result).includes('practiceEvidenceLabel'))
})
test('multiple evidence units and multiple passages resolve in the requested order', () => {
  const result = parse({ ...data, criteria: [{ ...data.criteria[0], evidenceIds: ['P2-E1', 'P1-E2', 'P1-E1'] }] })
  assert.equal(result.rubric.criteria[0].evidence.length, 3)
  assert.equal(result.rubric.criteria[0].evidence[0].sourceKey, 'book:1:second')
  assert.equal(result.sources.length, 2)
})
test('identical passage text resolves to the selected source, even after source reordering', () => {
  const reordered = labelPracticeSources([...sources].reverse())
  assert.deepEqual(reordered.map(source => source.practiceEvidenceLabel), ['P2', 'P1'])
  const result = parse({ ...data, criteria: [{ ...data.criteria[0], evidenceIds: ['P2-E1'] }] }, reordered)
  assert.deepEqual(result.sources, [{ ...original, chunkId: 'second' }])
  assert.equal(result.rubric.criteria[0].evidence[0].sourceKey, 'book:1:second')
})
test('lookup preserves the selected unit rather than substituting a different supporting unit', () => {
  const result = parse({ ...data, criteria: [{ ...data.criteria[0], evidenceIds: ['P1-E2'] }] })
  assert.equal(result.rubric.criteria[0].evidence[0].quote, practiceEvidenceUnits(sources[0])[1].text.trim())
})
test('six selected units are accepted and seven are rejected, matching the schema', () => {
  const supplied = labelPracticeSources(Array.from({ length: 4 }, (_, i) => ({ ...original, chunkId: `source-${i}` })))
  const ids = supplied.flatMap(source => practiceEvidenceUnits(source).map(unit => unit.id))
  assert.equal(parse({ ...data, criteria: [{ ...data.criteria[0], evidenceIds: ids.slice(0, 6) }] }, supplied).rubric.criteria[0].evidence.length, 6)
  assert.throws(() => parse({ ...data, criteria: [{ ...data.criteria[0], evidenceIds: ids.slice(0, 7) }] }, supplied))
})
for (const ids of [['P1-E999'], ['P1-E1', 'P1-E1'], [], ['invented']]) {
  test(`invalid or duplicate evidence selection rejects ${JSON.stringify(ids)}`, () => {
    assert.throws(() => parse({ ...data, criteria: [{ ...data.criteria[0], evidenceIds: ids }] }))
  })
}
test('real ID does not bypass existing question-issue and answer-type validation', () => {
  assert.throws(() => parse({ ...data, questionIssue: 'Missing assumptions.' }))
  assert.throws(() => parse({ ...data, correctAnswer: 'true' }))
  assert.throws(() => parse({ ...data, statement: 'Why is that true?' }))
})
test('labels remain stable after packing; IDs from dropped passages are rejected', () => {
  const supplied = labelPracticeSources([{ ...original, excerpt: 'A long sentence. '.repeat(12000) }, { ...original, chunkId: 'second' }])
  const prepared = prepareStudyChatMessages({ ...request, retrievedSources: supplied })
  assert.deepEqual(prepared.sources.map(s => s.practiceEvidenceLabel), ['P2'])
  assert.match(prepared.messages[1].content, /Evidence ID: P2-E1/)
  assert.doesNotMatch(prepared.messages[1].content, /Evidence ID: P1-E/)
  assert.throws(() => parse(data, prepared.sources), error => /P1-E1/.test(error.cause))
  assert.equal(parse({ ...data, criteria: [{ ...data.criteria[0], evidenceIds: ['P2-E1'] }] }, prepared.sources).sources[0].chunkId, 'second')
})
test('label overhead is included in context budgeting', () => {
  const options = { model: request.model, modelSettings: request.modelSettings, includeBudget: true, wholeSources: true }
  const plain = packSourceContext(sources, options)
  const labeled = packSourceContext(sources, { ...options, evidenceUnitIds: true })
  assert.ok(labeled.budget.usedSourceTokens > plain.budget.usedSourceTokens)
  assert.ok(labeled.budget.usedSourceTokens <= labeled.budget.sourceBudgetTokens)
})
test('duplicate passage labels fail rather than ambiguously resolving citations', () => {
  assert.throws(() => labelPracticeSources([sources[0], sources[0]]), /Duplicate/)
  assert.throws(() => parse(data, [sources[0], sources[0]]), error => /Duplicate/.test(error.cause))
})
test('distinct temporary labels cannot disguise a duplicate saved source identity', () => {
  const ambiguous = [sources[0], { ...sources[0], practiceEvidenceLabel: 'P2', excerpt: 'Different text for the same stored source.' }]
  assert.throws(() => labelPracticeSources(ambiguous), /Duplicate practice source/)
  assert.throws(() => parse(data, ambiguous), error => /Duplicate practice source/.test(error.cause))
})
test('evidence-ID packing never clips units, including when called without wholeSources', () => {
  const supplied = labelPracticeSources([{ ...original, excerpt: 'A long sentence. '.repeat(12000) }, sources[1]])
  const packed = packSourceContext(supplied, { model: { ...request.model, engine: 'remote' },
    modelSettings: request.modelSettings, includeBudget: true, evidenceUnitIds: true })
  assert.deepEqual(packed.sources.map(source => source.practiceEvidenceLabel), ['P2'])
  assert.ok(packed.context.includes(practiceEvidenceText(supplied[1])))
  assert.equal(packed.budget.truncatedSourceCount, 0)
})

async function mockedProvider(handler, run) {
  const saved = globalThis.fetch
  globalThis.fetch = async (url, options) => ({ ok: true, json: async () => handler(String(url), JSON.parse(options.body)) })
  try { return await run() } finally { globalThis.fetch = saved }
}

test('Ollama completion and resolver share stable IDs after estimation and measured-token dropping', async () => {
  const supplied = labelPracticeSources([{ ...original, excerpt: 'A long sentence. '.repeat(12000) },
    sources[1], { ...original, chunkId: 'third' }])
  const response = { ...data, criteria: [{ ...data.criteria[0], evidenceIds: ['P2-E1'] }] }
  let probes = 0, completions = 0
  const result = await mockedProvider((url, body) => {
    if (url.endsWith('/show')) return { capabilities: ['thinking'] }
    if (body.options.num_predict === 1) return { prompt_eval_count: ++probes === 1 ? 8000 : 2000 }
    completions++
    const prompt = body.messages.map(message => message.content).join('\n')
    assert.ok(prompt.includes(practiceEvidenceText(supplied[1])))
    assert.doesNotMatch(prompt, /Evidence ID: P[13]-E/)
    assert.deepEqual(body.format, practiceResponseSchema('true_false_question'))
    return { done_reason: 'stop', message: { content: JSON.stringify(response) } }
  }, () => runOllamaStudyEngine({ ...request, retrievedSources: supplied,
    model: { ...request.model, ollamaModelName: 'id-mapping-review' },
    modelSettings: { ...request.modelSettings, contextLengthMode: 'manual', reasoningMode: 'off', thinking: false } }))
  assert.equal(probes, 2)
  assert.equal(completions, 1)
  assert.deepEqual(result.sources.map(source => source.practiceEvidenceLabel), ['P2'])
  assert.equal(parsePracticeQuestionFromEvidenceIds(result.text, result.sources).rubric.criteria[0].evidence[0].sourceKey, 'book:1:second')
  assert.throws(() => parse(data, result.sources), error => /P1-E1/.test(error.cause))
  assert.throws(() => parse({ ...data, criteria: [{ ...data.criteria[0], evidenceIds: ['P3-E1'] }] }, result.sources), error => /P3-E1/.test(error.cause))
})

test('remote completion and resolver use exactly the retained labeled passages', async () => {
  const supplied = labelPracticeSources([{ ...original, excerpt: 'A long sentence. '.repeat(12000) }, sources[1]])
  const response = { ...data, criteria: [{ ...data.criteria[0], evidenceIds: ['P2-E2', 'P2-E1'] }] }
  let completions = 0
  const result = await mockedProvider((_url, body) => {
    completions++
    assert.equal(body.messages[0].content, practiceSystemPrompt('true_false_question'))
    assert.ok(body.messages[1].content.includes(practiceEvidenceText(supplied[1])))
    assert.doesNotMatch(body.messages[1].content, /Evidence ID: P1-E/)
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }] }
  }, () => runRemoteStudyEngine({ ...request, retrievedSources: supplied,
    model: { ...request.model, engine: 'remote', baseUrl: 'https://provider.example/v1', remoteModelName: 'test', apiKey: 'test' } }))
  assert.equal(completions, 1)
  assert.deepEqual(result.sources.map(source => source.practiceEvidenceLabel), ['P2'])
  assert.deepEqual(parsePracticeQuestionFromEvidenceIds(result.text, result.sources).rubric.criteria[0].evidence,
    [1, 0].map(i => ({ sourceKey: 'book:1:second', quote: practiceEvidenceUnits(supplied[1])[i].text.trim() })))
})
test('client retries an unknown ID with feedback and the same evidence labels', async () => {
  const calls = [], rejections = []
  const model = { id: 'm', status: 'ready' }
  const client = createPracticeClient({ practiceSources: async () => [original],
    sendChatMessage: async req => { calls.push(req); return { sources: req.retrievedSources,
      text: JSON.stringify(calls.length === 1 ? { ...data, criteria: [{ ...data.criteria[0], evidenceIds: ['P9-E9'] }] } : data) } },
    logPracticeQuestionRejected: async reason => { rejections.push(reason) }
  }, model, { application: {} })
  const result = await client.question({ modelId: 'm', documents: [], questions: [], modelSettings: { maxLength: 1536 } }, 'test', new AbortController().signal)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].retrievedSources, calls[1].retrievedSources)
  assert.match(calls[1].prompt, /P9-E9/)
  assert.equal(rejections.length, 1)
  assert.deepEqual(result.sources, [original])
})
