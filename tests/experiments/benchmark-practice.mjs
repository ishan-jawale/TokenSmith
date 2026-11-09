// Real Practice client + provider + isolated production Basic PDF import/search.
// This generates review material; it does not automatically grade question quality.
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { requireTranspiledTs } from '../unit/typescript/ts-module-loader.mjs'

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const { values } = parseArgs({ options: {
  book: { type: 'string' }, model: { type: 'string', default: 'gemma4:12b' },
  provider: { type: 'string', default: 'ollama' },
  'ollama-url': { type: 'string', default: 'http://127.0.0.1:11434' },
  embedder: { type: 'string', default: 'nomic-embed-text' },
  python: { type: 'string', default: 'app_runtime/python/bin/python' },
  out: { type: 'string' }, plan: { type: 'boolean' }, check: { type: 'boolean' },
  smoke: { type: 'boolean' }, help: { type: 'boolean' }
} })
if (values.help) {
  console.log(`Usage: node tests/experiments/benchmark-practice.mjs --book /path/to/book.pdf [options]
  --plan                 Print the frozen sampling plan; no model/network calls
  --check                Inspect extraction/dependencies and list installed models; no generation
  --smoke                One question from the first topic; separate output directory
  --model NAME           Installed model name (default gemma4:12b)
  --provider ollama|gemini  Gemini uses TOKENSMITH_BENCHMARK_API_KEY from your environment
  --ollama-url URL       Ollama/Ada endpoint for local generation and embeddings
  --embedder NAME        Installed Ollama embedder (default nomic-embed-text)
  --python PATH          Python with TokenSmith runtime dependencies
  --out NEW_DIRECTORY    Output must not exist; default tmp/practice-cp-<timestamp>
Full run: 6 topics x 1 continuous session x 10 attempts = 60 scheduled attempts.
Settings come from the application's shared built-in defaults; Practice applies its usual overrides.
Rejected generations are retained, never silently retried. Accepted questions need human review.
The full book is indexed. Topic retrieval and source rotation use the production Practice client.
No installed library, conversations, settings, or credentials are changed.`)
  process.exit(0)
}
const plan = JSON.parse(readFileSync('tests/experiments/practice-cp-cases.json', 'utf8'))
if (values.plan) { console.log(JSON.stringify(plan, null, 2)); process.exit(0) }
if (!values.book || !existsSync(values.book)) throw new Error('Supply --book with an existing PDF path. Use --help for options.')
if (!['ollama', 'gemini'].includes(values.provider)) throw new Error('--provider must be ollama or gemini.')
const book = resolve(values.book)
const python = resolve(values.python)
if (!existsSync(python)) throw new Error(`Python runtime missing at ${python}; supply --python.`)
const baseUrl = values['ollama-url'].replace(/\/+$/, '').replace(/\/api$/, '')
const apiKey = process.env.TOKENSMITH_BENCHMARK_API_KEY?.trim()
const safeError = error => String(error?.message ?? error).replaceAll(apiKey || '\u0000', '[redacted]')
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const json = (path, value) => {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n')
  renameSync(`${path}.tmp`, path)
}
function worker(script, directory) {
  const child = spawn(python, ['-E', '-s', '-B', script], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, TOKENSMITH_LOG_FILE: '', PYTHONUNBUFFERED: '1' }
  })
  const pending = new Map()
  let dead = false
  const fail = error => {
    dead = true
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error) }
    pending.clear()
  }
  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { fail(new Error('Unreadable Python worker response.')); child.kill(); return }
    if (message.progress) return
    const p = pending.get(message.id)
    if (!p) return
    pending.delete(message.id); clearTimeout(p.timer)
    message.ok ? p.resolve(message.result) : p.reject(new Error(message.error))
  })
  child.on('error', fail)
  child.stdin.on('error', fail)
  const closed = new Promise(done => child.on('close', code => {
    lines.close(); fail(new Error(`Python worker exited (${code}).`)); done()
  }))
  return {
    call(command, payload = {}, timeout = 60_000) {
      if (dead) return Promise.reject(new Error('Python worker is no longer running.'))
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { fail(new Error(`${command} timed out.`)); child.kill() }, timeout)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(JSON.stringify({ id, command, payload: { ...payload, userDataPath: directory } }) + '\n')
      })
    },
    async close() {
      child.stdin.end()
      const timer = setTimeout(() => child.kill(), 5000)
      await closed; clearTimeout(timer)
    }
  }
}
async function tags() {
  const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Ollama model listing: HTTP ${response.status}`)
  return (await response.json()).models ?? []
}
function installed(models, name) {
  return models.find(m => m.name === name || m.name === `${name}:latest`)
}
let models
try { models = await tags() } catch {
  throw new Error(`Cannot reach Ollama at ${baseUrl}. Start Ollama or your existing Ada tunnel, then run --check again.`)
}
if (!installed(models, values.embedder)) throw new Error(`Embedder ${values.embedder} is not installed. Available: ${models.map(m => m.name).join(', ')}`)
if (values.provider === 'ollama' && !installed(models, values.model)) throw new Error(`Chat model ${values.model} is not installed. Available: ${models.map(m => m.name).join(', ')}`)
if (values.check) {
  const w = worker(resolve('tests/experiments/practice-benchmark-worker.py'))
  try {
    const health = await w.call('health')
    if (!health.supports.includes('pdfium-pdf-extraction')) throw new Error('PDFium is missing from the selected Python runtime.')
    const inspection = await w.call('inspect_pdf', { path: book })
    if (inspection.pageCount !== plan.expectedPages || !inspection.samples[0].text.includes('Competitive Programmer')) {
      throw new Error('This is not the inspected 300-page handbook edition; revise the plan before running.')
    }
    console.log(JSON.stringify({ ready: true, generationStarted: false, provider: values.provider,
      model: values.model, installedModels: models.map(m => m.name), pageCount: inspection.pageCount,
      cloudKeyAvailable: values.provider === 'gemini' ? Boolean(apiKey) : undefined,
      extractionSample: inspection.samples.find(p => p.pdfPage === 14)?.text,
      note: 'Check mathematical notation in the prepared source previews too.' }, null, 2))
  } finally { await w.close() }
  process.exit(0)
}
if (values.provider === 'gemini' && !apiKey) throw new Error('Set TOKENSMITH_BENCHMARK_API_KEY in your terminal environment. Never put a key in a command argument or result file. Alternatively run this evaluation manually in Practice using your saved cloud connection.')
const directory = resolve(values.out || `tmp/practice-cp-${values.smoke ? 'smoke-' : ''}${new Date().toISOString().replaceAll(':', '-')}`)
mkdirSync(dirname(directory), { recursive: true })
mkdirSync(directory) // Refuse to overwrite previous results/reviews.
cpSync('src', resolve(directory, 'app/src'), { recursive: true })
cpSync('python_engine', resolve(directory, 'app/python_engine'), { recursive: true })
mkdirSync(resolve(directory, 'app/tests/experiments'), { recursive: true })
cpSync('tests/experiments/practice-benchmark-worker.py', resolve(directory, 'app/tests/experiments/practice-benchmark-worker.py'))
cpSync('tests/experiments/benchmark-practice.mjs', resolve(directory, 'runner.mjs'))
json(resolve(directory, 'plan.json'), plan)
const { createPracticeClient } = requireTranspiledTs(resolve(directory, 'app/src/renderer/src/practice-client.ts'))
const { runOllamaStudyEngine } = requireTranspiledTs(resolve(directory, 'app/src/main/engine/ollama-service.ts'))
const { runRemoteStudyEngine } = requireTranspiledTs(resolve(directory, 'app/src/main/engine/remote-chat-service.ts'))
const { defaultSettings } = requireTranspiledTs(resolve(directory, 'app/src/shared/default-settings.ts'))
const { defaultPreparation } = requireTranspiledTs(resolve(directory, 'app/src/shared/preparation.ts'))
const settings = structuredClone(defaultSettings)
const modelSettings = settings.modelDefaults
const application = settings.application
const preparationSettings = defaultPreparation()
const model = values.provider === 'ollama'
  ? { id: 'benchmark-generator', name: values.model, engine: 'ollama', source: 'ollama', status: 'ready',
      ollamaModelName: values.model, ollamaBaseUrl: baseUrl, contextLength: modelSettings.contextLength }
  : { id: 'benchmark-generator', name: values.model, engine: 'remote', source: 'remote', status: 'ready',
      providerId: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      remoteModelName: values.model, contextLength: modelSettings.contextLength, apiKey }
const embedder = { id: 'benchmark-embedder', name: values.embedder, engine: 'ollama', role: 'embedder',
  ollamaModelName: values.embedder, ollamaBaseUrl: baseUrl }
const suite = { createdAt: new Date().toISOString(), status: 'running', smoke: Boolean(values.smoke),
  method: 'Production Practice topic retrieval, source rotation, prompt, provider and parser; isolated Basic full-book import. No UI timing, no silent retries. Accepted means application validation only; semantic quality is ungraded.',
  book, bookSha256: hash(book), plan, model: { ...model, apiKey: undefined }, modelSettings,
  application, preparationSettings, settingsSource: 'Application built-in defaults from shared/default-settings.ts; existing Practice-specific overrides are applied by the production client/provider.',
  chatModelMetadata: values.provider === 'ollama' ? installed(models, values.model) : undefined,
  embedderMetadata: installed(models, values.embedder), reviewStatus: 'ungraded',
  codeHashes: Object.fromEntries(['src/renderer/src/practice-client.ts', 'src/shared/default-settings.ts', 'src/shared/model-defaults.ts', 'src/shared/preparation.ts', 'src/shared/quiz.ts', 'src/shared/practice-evidence.ts',
    'src/main/engine/study-chat-format.ts', 'src/main/engine/ollama-service.ts', 'src/main/engine/remote-chat-service.ts',
    'python_engine/tokensmith_engine.py', 'python_engine/tokensmith_store.py',
    'tests/experiments/benchmark-practice.mjs', 'tests/experiments/practice-benchmark-worker.py'].map(p => [p, hash(p)])),
  sessions: [], rows: [] }
const save = () => json(resolve(directory, 'results.json'), suite)
save()
console.log(`Output: ${directory}`)
const w = worker(resolve(directory, 'app/tests/experiments/practice-benchmark-worker.py'), resolve(directory, 'profile'))
let activeRow
const originalFetch = globalThis.fetch
globalThis.fetch = async (...args) => {
  const url = String(args[0])
  if (activeRow && /\/(chat|chat\/completions)$/.test(url) && args[1]?.body) {
    activeRow.httpRequests.push({ endpoint: url, body: JSON.parse(args[1].body) })
  }
  // Preserve caller cancellation while bounding a stalled network call.
  const init = { ...args[1] }
  init.signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000)
  const response = await originalFetch(args[0], init)
  if (activeRow && /\/(chat|chat\/completions)$/.test(url)) {
    try { activeRow.httpResponses.push(await response.clone().json()) } catch { /* provider error remains in the row */ }
  }
  return response
}
function render() {
  const accepted = suite.rows.filter(r => r.status === 'accepted')
  const duplicates = accepted.filter((r, i) => accepted.slice(0, i).some(p => p.question.text.trim().toLowerCase() === r.question.text.trim().toLowerCase()))
  const median = rows => {
    const times = rows.map(r => r.seconds).sort((a, b) => a - b)
    const middle = Math.floor(times.length / 2)
    return times.length ? (times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2).toFixed(2) : '-'
  }
  writeFileSync(resolve(directory, 'summary.md'), [
    '# Practice question baseline', '', `Status: ${suite.status}. Model: ${values.model}. Book: ${plan.book}.`, '',
    `${plan.topics.length} topics; ${plan.sessionsPerTopic} session per topic; ${plan.attemptsPerSession} scheduled attempts per session.`,
    'Application built-in defaults, with the usual Practice-specific behavior. Effective requests are saved in results.json.', '',
    `Scheduled slots recorded: ${suite.rows.length}. Application-accepted questions: ${accepted.length}. Exact repeats across accepted questions: ${duplicates.length}.`,
    `Generated keys among accepted questions: ${accepted.filter(r => r.question.correctAnswer).length} True; ${accepted.filter(r => !r.question.correctAnswer).length} False. These are generated labels, not verified answers.`,
    '**These are execution counts, not question-quality scores. All questions remain ungraded.**', '',
    '| Topic | Accepted | Generation errors | Blocked by retrieval | Median accepted generation (s) |', '|---|---:|---:|---:|---:|',
    ...plan.topics.map(t => {
      const rows = suite.rows.filter(r => r.topicId === t.id)
      return `| ${t.title} | ${rows.filter(r => r.status === 'accepted').length} | ${rows.filter(r => r.status === 'error').length} | ${rows.filter(r => r.status === 'blocked').length} | ${median(rows.filter(r => r.status === 'accepted'))} |`
    }), '', 'Topic preparation time is recorded once per session; per-question times include production preflight and generation.',
    'Review relevance, assumptions/clarity, key correctness, evidence sufficiency, novelty, and recall/understanding/application.',
    'Use pass / issue / uncertain. For False statements require evidence of contradiction, not merely absence.',
    'Do not infer that a rejected output was semantically invalid, or that an accepted output was correct.',
    ...(suite.error ? ['', `Run error: ${suite.error}`] : [])
  ].join('\n'))
  writeFileSync(resolve(directory, 'questions.md'), [
    '# Generated Practice questions - ungraded', '',
    ...suite.rows.flatMap(r => [
      `## ${r.id}`, '', `Topic: ${r.topic}. Status: ${r.status}. Time: ${(r.seconds ?? 0).toFixed(2)}s.`, '',
      ...(r.question ? [r.question.text, '', `**Generated key:** ${r.question.correctAnswer ? 'True' : 'False'}`, '',
        '**Generated explanation:**', '', r.question.referenceAnswer, '', '**Generated assumptions:**',
        ...r.question.rubric.assumptions.map(a => `- ${a}`), '', '**Generated criteria and quoted evidence:**',
        ...r.question.rubric.criteria.flatMap(c => [`- ${c.description}`, ...c.evidence.map(e => `  - ${e.sourceKey}: ${e.quote}`)]), '',
        '**Passages retained by the provider (also saved for rejected outputs):**'] : [r.error || 'No question generated.', '']),
      ...(r.reply?.sources ?? []).flatMap((s, i) => [`### Source ${i + 1}: ${s.locator || s.sectionHeader || s.documentTitle}`, '', s.context || s.excerpt, '']),
      ...(r.reply && !r.question ? ['**Rejected raw model response:**', '', '```json', r.reply.text, '```', ''] : [])
    ])
  ].join('\n'))
}
try {
  const inspect = await w.call('inspect_pdf', { path: book })
  json(resolve(directory, 'extraction-samples.json'), inspect)
  if (inspect.pageCount !== plan.expectedPages || !inspect.samples[0].text.includes('Competitive Programmer')) throw new Error('Book edition does not match the frozen plan.')
  const started = performance.now()
  console.log('Preparing a separate searchable copy of the book...')
  const indexed = await w.call('index_material', { path: book, title: plan.book, model: embedder,
    preparation: preparationSettings, embeddingGpuEnabled: application.embeddingGpuEnabled }, 1_800_000)
  suite.importSeconds = (performance.now() - started) / 1000
  if (indexed.material.status !== 'ready') throw new Error('Book import did not produce a ready collection.')
  suite.material = indexed.material
  const { documents } = await w.call('study_documents')
  if (!documents.length) throw new Error('No indexed documents were available.')
  const client = createPracticeClient({
    searchLibrary: (query, materials, limit, embeddingModels, searchMode, options) => w.call('search', { query, materials, limit, embeddingModels, searchMode, ...options }),
    sendChatMessage: async request => {
      // Keep credentials only in memory. Record actual effective request settings and supplied sources.
      activeRow.request = { ...request, model: { ...request.model, apiKey: undefined } }
      const reply = await (values.provider === 'ollama' ? runOllamaStudyEngine : runRemoteStudyEngine)(request, { signal: AbortSignal.timeout(300_000) })
      activeRow.reply = reply
      return reply
    }
  }, model, settings, { materials: [{ ...indexed.material, isActive: true }], embeddingModels: [embedder] })
  const topics = values.smoke ? plan.topics.slice(0, 1) : plan.topics
  for (const topic of topics) {
    for (let n = 1; n <= (values.smoke ? 1 : plan.sessionsPerTopic); n++) {
      let session = { id: `${topic.id}-${n}`, title: topic.title, createdAt: new Date().toISOString(),
        documents, modelId: model.id, modelSettings, questions: [], currentIndex: 0, topic: { title: topic.title } }
      const preparation = { id: session.id, topicId: topic.id, status: 'preparing' }
      suite.sessions.push(preparation)
      const started = performance.now()
      try {
        session = await client.prepareTopic(session, new AbortController().signal)
        preparation.status = 'ready'; preparation.sources = session.topic.sources
      } catch (error) { preparation.status = 'error'; preparation.error = safeError(error) }
      preparation.seconds = (performance.now() - started) / 1000
      save()
      for (let i = 1; i <= (values.smoke ? 1 : plan.attemptsPerSession); i++) {
        const row = { id: `${session.id}-${i}`, topicId: topic.id, topic: topic.title, session: n, slot: i,
          status: 'running', reviewStatus: 'ungraded', httpRequests: [], httpResponses: [] }
        suite.rows.push(row); activeRow = row
        const began = performance.now()
        try {
          if (preparation.error) { row.status = 'blocked'; row.error = preparation.error }
          else {
            const question = await client.question(session, randomUUID(), new AbortController().signal)
            if (!question) throw new Error('The session returned no question.')
            row.question = question; row.status = 'accepted'; session.questions.push(question)
          }
        } catch (error) { row.status = 'error'; row.error = safeError(error) }
        finally {
          row.seconds = (performance.now() - began) / 1000; activeRow = undefined
          save(); render(); console.log(`${suite.rows.length}: ${row.id} ${row.status} (${row.seconds.toFixed(1)}s)`)
        }
      }
    }
  }
  suite.status = 'complete'
} catch (error) {
  suite.status = 'failed'; suite.error = safeError(error); process.exitCode = 1
} finally {
  globalThis.fetch = originalFetch
  suite.finishedAt = new Date().toISOString(); save(); render()
  const review = { instructions: 'For each accepted question use pass/issue/uncertain for each criterion; cite the actual evidence. Leave unsupported judgments uncertain. Depth: recall/understanding/application. No quality scores have been assigned automatically.',
    rows: suite.rows.filter(r => r.question).map(r => ({ id: r.id, relevance: '', clarityAndAssumptions: '', keyCorrectness: '', evidenceSufficiency: '', novelty: '', depth: '', notes: '' })) }
  json(resolve(directory, 'review.json'), review)
  await w.close()
}
console.log(`Saved results, questions, summary and blank review form to ${directory}`)
