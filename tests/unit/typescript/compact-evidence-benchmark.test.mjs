import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pairedSummary } from '../../experiments/compact-evidence-report.mjs'

test('averages compare matching successful pairs and never treat missing tokens as zero', () => {
  const definitions = [{ id: 'one', question: 'One?' }, { id: 'two', question: 'Two?' }]
  const run = (caseId, repeat, mode, ms, status = 'complete') => ({ id: `${caseId}/${repeat}/${mode}`, caseId, repeat, mode,
    answerReadyMs: ms, status, calls: [{ stage: 'answer', promptTokens: null, outputTokens: null }],
    evidenceDiagnostics: { appliedMode: mode }, selectionMs: mode === 'compact' ? 2 : 0 })
  const report = { cases: definitions, repeats: 2, runs: [run('one', 0, 'standard', 100), run('one', 0, 'compact', 70),
    run('one', 1, 'standard', 120), run('one', 1, 'compact', null, 'failed'), run('two', 0, 'standard', 200), run('two', 0, 'compact', 150)] }
  const summary = pairedSummary(report)
  assert.equal(summary.standardMs, 150)
  assert.equal(summary.compactMs, 110)
  assert.equal(summary.pairCount, 2)
  assert.equal(summary.rows[0].standardPromptTokens, null)
  assert.equal(summary.rows[0].quality, 'Review pending')
  assert.equal(summary.rows[0].failures, 1)
  assert.equal(summary.completeTenCaseComparison, false)
  const review = Object.fromEntries(report.runs.map(r => [r.id, { verdict: 'pass' }]))
  review['two/0/compact'].verdict = 'incomplete'
  assert.equal(pairedSummary(report, review).rows[1].quality, 'Quality issue recorded')
})

test('runner executes ten questions, preserves settings and follow-ups, alternates pairs, and saves actual evidence', () => {
  const directory = mkdtempSync(join(process.cwd(), 'tmp/compact-benchmark-test-'))
  const definitions = JSON.parse(readFileSync('tests/benchmarks/buzzdb_grounding_cases.json'))
  const irrelevant = 'Additional unrelated history describes storage systems and implementation choices. '.repeat(20)
  const source = (title, text) => ({ title, locator: title, context: text, excerpt: text, sourceId: title })
  const sources = [source('Alpha', [irrelevant, irrelevant, 'Pinning introduces the buffer manager condition.',
    'Page pinning protects in-use memory from eviction in a buffer manager.', 'A valid pointer prevents corruption and crashes.', irrelevant, irrelevant].join('\n\n')),
    source('Beta', [irrelevant, irrelevant, 'Page pinning requires a buffer manager to preserve in-use memory.',
      'The buffer manager retains a pinned page until release.', 'The condition makes replacement safe.', irrelevant].join('\n\n'))]
  const snapshot = join(directory, 'snapshot.json')
  writeFileSync(snapshot, JSON.stringify({ bookSha256: createHash('sha256').update(readFileSync('tests/fixtures/buzzdb/buzzdb-book.tokensmith.md')).digest('hex'),
    snapshots: definitions.map(d => ({ caseId: d.id, question: d.question, retrievedSources: sources, retrievalQuery: d.question })) }))
  const mock = join(directory, 'mock-fetch.mjs')
  writeFileSync(mock, `globalThis.fetch = async (input, init) => {
    const url = String(input);
    let payload;
    if (url.endsWith('/api/tags')) payload = {models:[{name:'gemma4:12b',digest:'fixture-only',details:{context_length:8192}}]};
    else if (url.endsWith('/api/show')) payload = {model_info:{'gemma.context_length':8192}};
    else if (url.endsWith('/api/version')) payload = {version:'mock-only'};
    else if (url.endsWith('/api/chat')) {
      const body = JSON.parse(init.body);
      if (body.options.temperature !== 0.7 || body.options.num_ctx !== 8192) throw new Error('Normal options changed');
      payload = {done_reason:'stop',message:{content: body.format ? JSON.stringify(['Why does pinning protect memory?', 'How does page replacement work?']) : 'Page pinning protects an in-use page from eviction.'},eval_count:42};
    } else throw new Error('Unexpected network call: '+url);
    return new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});
  }`)
  const output = join(directory, 'results')
  execFileSync(process.execPath, ['--import', mock, 'tests/experiments/evaluate-compact-evidence.mjs', '--snapshot', snapshot, '--out', output], { encoding: 'utf8', timeout: 30_000 })
  const report = JSON.parse(readFileSync(join(output, 'results.json')))
  assert.equal(report.evidenceTokenBudget, 2000)
  assert.equal(report.runs.length, 40)
  assert.equal(report.warmups.length, 1)
  assert.equal(report.warmups[0].calls.length, 2)
  assert.ok(report.runs.every(r => r.status === 'complete' && r.calls.length === 2))
  assert.ok(report.runs.every(r => r.calls[0].stage === 'answer' && r.calls[1].stage === 'follow-up'))
  assert.ok(report.runs.some(r => r.evidenceDiagnostics?.appliedMode === 'compact'))
  const summary = JSON.parse(readFileSync(join(output, 'summary.json')))
  assert.equal(summary.pairCount, 20)
  assert.equal(summary.completeTenCaseComparison, true)
  assert.ok(summary.rows.every(row => row.standardPromptTokens === null && row.compactPromptTokens === null))
  assert.ok(summary.rows.every(row => row.quality === 'Review pending'))
  for (const definition of definitions) {
    const runs = report.runs.filter(r => r.caseId === definition.id)
    assert.notEqual(runs[0].mode, runs[2].mode)
    const [first, second] = runs
    const withoutEvidence = body => ({ ...body, messages: body.messages.map(m => ({ ...m,
      content: m.content.replace(/### Context:[\s\S]*?(?=\n\nQuestion:)/, '[EVIDENCE]') })) })
    assert.deepEqual(withoutEvidence(first.calls[0].request), withoutEvidence(second.calls[0].request))
    assert.ok(first.evidenceText.startsWith('### Context:'))
  }
  assert.ok(readFileSync(join(output, 'answers.md'), 'utf8').includes(report.runs[0].evidenceText))
  assert.throws(() => execFileSync(process.execPath, ['tests/experiments/evaluate-compact-evidence.mjs', '--budget', '0'], { stdio: 'pipe' }), /positive integer/)
})
