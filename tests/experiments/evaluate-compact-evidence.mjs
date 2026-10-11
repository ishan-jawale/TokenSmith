// Opt-in benchmark. No app, settings, index, or production service is modified.
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { requireTranspiledTs } from '../unit/typescript/ts-module-loader.mjs'
import { writeComparisonArtifacts } from './compact-evidence-report.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (process.cwd() !== root) throw new Error('Run this script from the TokenSmith repository root.')
const args = process.argv.slice(2)
const flags = new Set(['--dry-run', '--help'])
const valued = new Set(['--budget', '--repeats', '--url', '--embedding-url', '--profile', '--settings', '--snapshot', '--out', '--summarize'])
const options = {}
for (let index = 0; index < args.length; index++) {
  const flag = args[index]
  if (flags.has(flag)) options[flag] = true
  else if (valued.has(flag) && args[index + 1] && !args[index + 1].startsWith('--')) options[flag] = args[++index]
  else throw new Error(`Unknown or missing argument: ${flag}`)
}
if (options['--help']) {
  console.log(`node tests/experiments/evaluate-compact-evidence.mjs [options]
  --budget 2000           Estimated evidence token target (default 2000; positive integer)
  --repeats 2             Pairs per question; 2 gives 40 timed answers
  --url URL               Existing Ada Ollama endpoint (default localhost:11434)
  --embedding-url URL     Nomic endpoint (defaults to the same endpoint)
  --profile PATH          Existing disposable BuzzDB profile to copy
  --settings PATH         Saved settings JSON or TokenSmith state JSON
  --snapshot PATH         Replay frozen sources from a previous report (no retrieval)
  --dry-run               Prepare/audit sources and prompts without model calls
  --out PATH              New results directory; existing runs are never overwritten
  --summarize PATH        Regenerate tables after editing PATH/review.json
  --help                 Show this help
No credentials, sampling overrides, model download, or serving changes are required.`)
  process.exit(0)
}
if (options['--summarize']) {
  const directory = resolve(options['--summarize'])
  const report = JSON.parse(readFileSync(join(directory, 'results.json'), 'utf8'))
  const review = JSON.parse(readFileSync(join(directory, 'review.json'), 'utf8'))
  writeComparisonArtifacts(directory, report, review)
  console.log(`Updated ${join(directory, 'comparison.md')}`)
  process.exit(0)
}
const positive = (name, fallback) => {
  const value = Number(options[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`)
  return value
}
const { defaultEvidenceTokenBudget } = requireTranspiledTs('src/shared/compact-evidence.ts')
const evidenceTokenBudget = positive('--budget', defaultEvidenceTokenBudget)
const repeats = positive('--repeats', 2)
const baseUrl = String(options['--url'] ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')
const embeddingUrl = String(options['--embedding-url'] ?? baseUrl).replace(/\/+$/, '')
for (const endpoint of [baseUrl, embeddingUrl]) {
  const url = new URL(endpoint)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) endpoint without embedded credentials, query parameters, or fragments.')
}
const dryRun = Boolean(options['--dry-run'])
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const output = resolve(options['--out'] ?? `tmp/compact-evidence-poc/${stamp}${dryRun ? '-dry-run' : ''}`)
if (existsSync(join(output, 'results.json'))) throw new Error('Results already exist here. Choose a new --out directory or use --summarize.')
const book = join(root, 'tests/fixtures/buzzdb/buzzdb-book.tokensmith.md')
const definitions = JSON.parse(readFileSync(join(root, 'tests/benchmarks/buzzdb_grounding_cases.json'), 'utf8'))
if (definitions.length !== 10) throw new Error('Expected the unchanged ten-question BuzzDB benchmark.')
const savedSettings = JSON.parse(readFileSync(resolve(options['--settings'] ?? 'tests/experiments/compact-evidence-settings.json'), 'utf8'))
const settings = savedSettings.settings ?? savedSettings
if (!settings.modelDefaults || !settings.application) throw new Error('Settings must include modelDefaults and application.')
const modelSettings = { ...settings.modelDefaults, ...(settings.modelSettingsById?.['ollama:gemma4:12b'] ?? {}) }
const { runStudyChatWithEvidence, prepareCompactStudyChat } = requireTranspiledTs('src/main/engine/compact-study-chat.ts')
const { prepareStudyChatMessages } = requireTranspiledTs('src/main/engine/study-chat-format.ts')
const { modelAwareRetrievalLimit } = requireTranspiledTs('src/shared/retrieval-budget.ts')
const { prepareRewrittenStudyChat } = requireTranspiledTs('src/shared/study-chat-pipeline.ts')
const report = {
  createdAt: new Date().toISOString(), appVersion: JSON.parse(readFileSync('package.json')).version,
  dryRun, evidenceTokenBudget, repeats, settings, modelSettings,
  bookSha256: createHash('sha256').update(readFileSync(book)).digest('hex'),
  questionSha256: createHash('sha256').update(readFileSync('tests/benchmarks/buzzdb_grounding_cases.json')).digest('hex'),
  cases: definitions, snapshots: [], runs: [], warmups: [], failures: [],
  method: 'Unmodified TokenSmith answer service and settings. Source evidence is the sole experimental request difference. Frozen retrieval shared across each pair. Normal follow-ups retained and timed separately.'
}
const review = {}
mkdirSync(output, { recursive: true })
function save() {
  writeFileSync(join(output, 'results.json.tmp'), JSON.stringify(report, null, 2) + '\n')
  renameSync(join(output, 'results.json.tmp'), join(output, 'results.json'))
  writeFileSync(join(output, 'review.json'), JSON.stringify(review, null, 2) + '\n')
  writeComparisonArtifacts(output, report, review)
}
const realFetch = globalThis.fetch
async function getJson(route, endpoint = baseUrl, init = {}) {
  const response = await realFetch(`${endpoint}/api/${route}`, { ...init, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`)
  return response.json()
}
let model = { id: 'ollama:gemma4:12b', name: 'Gemma 4 12B', engine: 'ollama', role: 'generator', status: 'ready',
  source: 'ollama', ollamaModelName: 'gemma4:12b', ollamaBaseUrl: baseUrl }
let worker
function startWorker(profile) {
  const python = join(root, 'app_runtime/python/bin/python')
  if (!existsSync(python)) throw new Error('TokenSmith Python runtime is missing; use --snapshot to replay existing retrieval instead.')
  const child = spawn(python, [join(root, 'python_engine/tokensmith_engine.py')], {
    cwd: root, env: { ...process.env, PYTHONUNBUFFERED: '1', TOKENSMITH_LOG_FILE: join(output, 'python-engine.log') }, stdio: ['pipe', 'pipe', 'inherit']
  })
  const pending = new Map(); let sequence = 0; let dead
  const fail = error => { dead = error; for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) } pending.clear() }
  child.on('error', fail)
  child.on('exit', code => fail(new Error(`Python worker exited (${code}).`)))
  createInterface({ input: child.stdout }).on('line', line => {
    let message; try { message = JSON.parse(line) } catch { return }
    const item = pending.get(message.id)
    if (!item || message.ok === undefined) return
    clearTimeout(item.timer); pending.delete(message.id)
    if (message.ok) item.resolve(message.result)
    else item.reject(new Error(message.error))
  })
  return {
    request(command, payload) {
      if (dead) return Promise.reject(dead)
      const id = String(++sequence)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Python ${command} timed out.`)) }, command === 'index_material' ? 3_600_000 : 120_000)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(JSON.stringify({ id, command, payload: { userDataPath: profile, ...payload } }) + '\n')
      })
    }, close() { fail(new Error('Worker closed.')); child.stdin.end(); child.kill() }
  }
}
let activeRun
// Observe the original requests without changing their bodies, options, timeout,
// cancellation, or response payload. Never record headers/credentials.
globalThis.fetch = async (input, init) => {
  if (!String(input).endsWith('/api/chat') || !activeRun) return realFetch(input, init)
  const body = JSON.parse(String(init.body))
  const entry = { stage: body.options?.num_predict === 1 ? 'preflight' : body.format ? 'follow-up' : 'answer', request: body }
  activeRun.calls.push(entry)
  const started = performance.now()
  try {
    const response = await realFetch(input, init)
    entry.httpStatus = response.status
    const originalJson = response.json.bind(response)
    response.json = async () => {
      try {
        const payload = await originalJson()
        const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
        const ms = value => count(value) === null ? null : value / 1_000_000
        Object.assign(entry, { doneReason: payload.done_reason, promptTokens: count(payload.prompt_eval_count),
          cachedPromptTokens: count(payload.prompt_eval_cached_count), outputTokens: count(payload.eval_count),
          totalMs: ms(payload.total_duration), loadMs: ms(payload.load_duration),
          promptEvalMs: ms(payload.prompt_eval_duration), evalMs: ms(payload.eval_duration), response: payload })
        return payload
      } finally { entry.wallMs = performance.now() - started }
    }
    if (!response.ok) entry.wallMs = performance.now() - started
    return response
  } catch (error) { entry.error = error.message; entry.wallMs = performance.now() - started; throw error }
}

async function main() {
  if (!dryRun) {
    const tags = (await getJson('tags')).models ?? []
    const tag = tags.find(item => item.name === 'gemma4:12b')
    if (!tag) throw new Error('gemma4:12b is not reachable. Open the existing Ada tunnel first. No model is downloaded or substituted.')
    const show = await getJson('show', baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: tag.name }) })
    const contextLength = Number(tag.details?.context_length ?? Object.entries(show.model_info ?? {}).find(([key]) => key.endsWith('.context_length'))?.[1])
    model = { ...model, contextLength: Number.isFinite(contextLength) ? contextLength : undefined, quant: tag.details?.quantization_level, parameters: tag.details?.parameter_size }
    report.modelPackage = { name: tag.name, digest: tag.digest, size: tag.size, details: tag.details }
    report.ollamaVersion = await getJson('version')
  }
  report.model = model
  if (options['--snapshot']) {
    const previous = JSON.parse(readFileSync(resolve(options['--snapshot']), 'utf8'))
    if (previous.bookSha256 !== report.bookSha256) throw new Error('Snapshot uses a different BuzzDB book.')
    report.retrievalMethod = 'Replay of saved production retrieval; no new retrieval measurements.'
    for (const definition of definitions) {
      const entry = (previous.snapshots ?? previous.cases).find(item =>
        (item.caseId === definition.id || item.key === `ollama:gemma4:12b/${definition.id}`) && item.retrievedSources?.length)
      if (!entry || (entry.question && entry.question !== definition.question)) throw new Error(`Matching retrieval snapshot missing: ${definition.id}`)
      report.snapshots.push({ caseId: definition.id, question: definition.question, retrievalQuery: entry.retrievalQuery ?? definition.question,
        retrievedSources: entry.retrievedSources, searchMs: null, rewriteMs: 0 })
    }
  } else {
    if (dryRun) throw new Error('--dry-run requires --snapshot; no network access is performed.')
    const profile = join(output, 'profile')
    const previousProfile = resolve(options['--profile'] ?? 'tmp/buzzdb-v014-batch-profile')
    const python = join(root, 'app_runtime/python/bin/python')
    mkdirSync(profile, { recursive: true })
    if (existsSync(join(previousProfile, 'tokensmith.sqlite'))) {
      // SQLite backup includes committed WAL data; raw file copies can miss it.
      execFileSync(python, ['-c', 'import sqlite3,sys,pathlib; a=sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri()+"?mode=ro",uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()', join(previousProfile, 'tokensmith.sqlite'), join(profile, 'tokensmith.sqlite')])
      if (existsSync(join(previousProfile, 'tokensmith.faiss'))) cpSync(join(previousProfile, 'tokensmith.faiss'), join(profile, 'tokensmith.faiss'))
      report.corpusSetup = { method: 'SQLite backup and FAISS copy of existing experiment profile', originalProfile: previousProfile, isolatedProfile: profile }
    } else report.corpusSetup = { method: 'New disposable Basic index', isolatedProfile: profile }
    worker = startWorker(profile)
    const embedder = { id: 'ollama:nomic-embed-text', name: 'Nomic', engine: 'ollama', role: 'embedder', status: 'ready', source: 'ollama', ollamaModelName: 'nomic-embed-text', ollamaBaseUrl: embeddingUrl }
    const nomic = ((await getJson('tags', embeddingUrl)).models ?? []).find(item => /^nomic-embed-text(?::latest)?$/.test(item.name))
    if (!nomic) throw new Error('Nomic is not reachable at the embedding endpoint.')
    // The reused index was built with this package in the existing experiment.
    if (report.corpusSetup.originalProfile && nomic.digest !== '0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f') throw new Error('Nomic package differs from the reused index; use a fresh --profile path to build a disposable index.')
    report.embeddingPackage = { name: nomic.name, digest: nomic.digest }
    const setupStarted = performance.now()
    let material = (await worker.request('list_materials', {})).materials?.find(item => item.path === book && item.status === 'ready')
    if (!material) material = (await worker.request('index_material', { path: book, model: embedder, embeddingGpuEnabled: settings.application.embeddingGpuEnabled })).material
    report.corpusSetup.setupMs = performance.now() - setupStarted
    report.material = material
    report.retrievalMethod = 'Fresh normal production Nomic retrieval, frozen once per question.'
    for (const definition of definitions) {
      const prepared = await prepareRewrittenStudyChat({ prompt: definition.question, messages: [], materials: [material], model,
        settings, modelSettings, applicationSettings: settings.application }, {
        resolve: async () => { throw new Error('These standalone questions must not require a rewrite.') },
        search: async query => (await worker.request('search', { query, materials: [material],
          limit: modelAwareRetrievalLimit(settings.maxSources, model, modelSettings), embeddingModels: [embedder],
          searchMode: settings.application.searchMode, embeddingGpuEnabled: settings.application.embeddingGpuEnabled })).sources
      })
      if (!prepared.request?.retrievedSources?.length) throw new Error(`No sources: ${definition.id}`)
      report.snapshots.push({ caseId: definition.id, question: definition.question, retrievalQuery: prepared.request.retrievalQuery,
        retrievedSources: prepared.request.retrievedSources, searchMs: prepared.searchMs, rewriteMs: prepared.rewriteMs })
      save()
    }
  }
  const makeRequest = snapshot => ({ prompt: snapshot.question, answerPrompt: snapshot.question, retrievalQuery: snapshot.retrievalQuery,
    conversationContextMode: 'standalone', messages: [], materials: report.material ? [report.material] : [], model,
    settings, modelSettings, applicationSettings: settings.application, retrievedSources: snapshot.retrievedSources })
  for (const snapshot of report.snapshots) {
    const request = makeRequest(snapshot)
    const baseline = prepareStudyChatMessages(request)
    const compact = prepareCompactStudyChat(request, { evidenceTokenBudget })
    snapshot.audit = { standardMessages: baseline.messages, compactMessages: compact.prepared.messages,
      standardBudget: baseline.budget, compactBudget: compact.prepared.budget, diagnostics: compact.diagnostics }
    console.log(`${snapshot.caseId}: ${compact.diagnostics.appliedMode}; ${baseline.budget.usedSourceTokens} → ${compact.prepared.budget.usedSourceTokens} estimated evidence tokens${compact.diagnostics.fallbackReason ? ` (${compact.diagnostics.fallbackReason})` : ''}`)
  }
  save()
  if (dryRun) { console.log(`Dry run saved to ${output}; latency and quality remain unmeasured.`); return }
  console.log('Warming the normal model path once; this answer is excluded from averages.')
  const warmup = { calls: [] }; activeRun = warmup
  try { await runStudyChatWithEvidence(makeRequest(report.snapshots[0])); report.warmups.push(warmup) }
  finally { activeRun = null; save() }
  // Complete one pair per question before repeats; reverse order per question/round.
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (let index = 0; index < report.snapshots.length; index++) {
      const snapshot = report.snapshots[index]
      const order = (repeat + index) % 2 ? ['compact', 'standard'] : ['standard', 'compact']
      for (const mode of order) {
        const run = { id: `${snapshot.caseId}/${repeat + 1}/${mode}`, caseId: snapshot.caseId, repeat, mode,
          status: 'running', calls: [], startedAt: new Date().toISOString(), order: order.indexOf(mode) }
        report.runs.push(run); review[run.id] = { verdict: 'pending', notes: '' }; activeRun = run
        const started = performance.now()
        try {
          const answer = await runStudyChatWithEvidence(makeRequest(snapshot), { mode, evidenceTokenBudget }, {
            onAnswer: value => { run.answerReadyMs = performance.now() - started; run.answer = value }
          })
          run.answerReadyMs ??= performance.now() - started
          run.answer = answer; run.evidenceDiagnostics = answer.evidenceDiagnostics
          run.selectionMs = answer.evidenceDiagnostics?.selectionMs ?? 0
          run.status = 'complete'
        } catch (error) {
          run.error = error.message; run.status = run.answer?.text ? 'complete' : 'failed'
          report.failures.push({ id: run.id, error: run.error })
        } finally {
          run.fullRunMs = performance.now() - started
          const answerCall = run.calls.find(call => call.stage === 'answer')
          const userText = answerCall?.request.messages.findLast(message => message.role === 'user')?.content ?? ''
          const questionSuffix = `\n\nQuestion: ${snapshot.question}`
          const start = userText.indexOf('### Context:\n')
          const end = userText.lastIndexOf(questionSuffix)
          // Save actual transmitted evidence, including any production clipping.
          // Returned navigation records can contain text absent from the prompt.
          run.evidenceText = start >= 0 && end >= start ? userText.slice(start, end) : ''
          run.selectionMs ??= run.answer?.evidenceDiagnostics?.selectionMs ?? 0
          run.evidenceDiagnostics ??= run.answer?.evidenceDiagnostics
          // For first-turn cases no rewrite runs. Provider timings are contained
          // within wall times and are never added to overlapping durations.
          run.followUpWallMs = run.calls.filter(call => call.stage === 'follow-up').reduce((sum, call) => sum + (call.wallMs ?? 0), 0)
          activeRun = null; save()
        }
        console.log(`${run.id}: ${run.status}; answer ${run.answerReadyMs ? (run.answerReadyMs / 1000).toFixed(2) + 's' : 'unavailable'}`)
      }
    }
  }
  console.log(`Saved ${join(output, 'comparison.md')} and answers.md. Quality review is pending.`)
}
try { await main() }
catch (error) { report.failures.push({ stage: 'setup-or-run', error: error.message }); save(); console.error(error.message); process.exitCode = 1 }
finally { activeRun = null; globalThis.fetch = realFetch; worker?.close() }
