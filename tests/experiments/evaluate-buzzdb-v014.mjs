// Opt-in live evaluation of the v0.1.14 first-question study flow.
// Run from the repository root with GEMINI_API_KEY set. Importing this file runs it.
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { requireTranspiledTs } from '../unit/typescript/ts-module-loader.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (process.cwd() !== root) throw new Error(`Run this script from ${root}`)
const packageInfo = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (packageInfo.version !== '0.1.14') throw new Error(`Expected TokenSmith v0.1.14; found ${packageInfo.version}`)

const apiKey = process.env.GEMINI_API_KEY?.trim()
if (!apiKey) throw new Error('Set GEMINI_API_KEY before running. No models or questions were run.')
const profile = join(root, 'tmp/buzzdb-v014-batch-profile')
const output = join(root, 'tmp/buzzdb-v014-batch-results.json')
const book = join(root, 'tests/fixtures/buzzdb/buzzdb-book.tokensmith.md')
const questionsPath = join(root, 'tests/benchmarks/buzzdb_grounding_cases.json')
const ollama = 'http://127.0.0.1:11434'
const modelNames = ['gemma4:e4b', 'gemma4:12b', 'gemma4:26b']
const geminiModelName = 'gemini-3.8-flash'
const expectedDigests = {
  'gemma4:e4b': 'c6eb396dbd5992bbe3f5cdb947e8bbc0ee413d7c17e2beaae69f5d569cf982eb',
  'gemma4:12b': '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c',
  'gemma4:26b': '08ae7ec1744bd7f451c4a530afb39d2673ad9d07a8369b8a33a3613b41212a68'
}
const questions = JSON.parse(readFileSync(questionsPath, 'utf8'))
const bookSha256 = createHash('sha256').update(readFileSync(book)).digest('hex')
const { defaultSuggestedFollowUpPrompt, defaultStarterQuestionPrompt } =
  requireTranspiledTs('src/shared/model-defaults.ts')

// Copied from the fresh v0.1.14 profile. The production prompt, retrieval-limit,
// search, and answer implementations are imported below instead of reproduced.
const modelDefaults = {
  systemMessage: '', suggestedFollowUpPrompt: defaultSuggestedFollowUpPrompt,
  starterQuestionPrompt: defaultStarterQuestionPrompt,
  contextLength: 8192, maxLength: 1536, thinking: false,
  temperature: 0.7, topP: 0.4, topK: 40, minP: 0, repeatPenalty: 1.18
}
const application = {
  theme: 'light', fontSize: 'normal', defaultModelId: '',
  suggestionMode: 'on', followUpSuggestionCount: 4, searchMode: 'hybrid',
  explanationDepthEnabled: false, explanationDepth: 'standard',
  showSources: true, embeddingGpuEnabled: true
}
const settings = { maxSources: 4, application, modelDefaults, modelSettingsById: {} }
function modelSettingsFor(modelId) {
  // Mirrors the UI's default-plus-selected-model lookup. Fresh profiles have
  // no per-model overrides; all values here are already within the UI limits.
  return { ...settings.modelDefaults, ...(settings.modelSettingsById[modelId] ?? {}) }
}
const embedder = {
  id: 'ollama:nomic-embed-text', name: 'Ollama nomic-embed-text', engine: 'ollama',
  role: 'embedder', status: 'ready', source: 'ollama',
  ollamaModelName: 'nomic-embed-text', ollamaBaseUrl: ollama
}

const { modelAwareRetrievalLimit } = requireTranspiledTs('src/shared/retrieval-budget.ts')
const { prepareRewrittenStudyChat } = requireTranspiledTs('src/shared/study-chat-pipeline.ts')
const { sourceContextBudgetForRequest } = requireTranspiledTs('src/main/engine/study-chat-format.ts')
const { runOllamaStudyEngine } = requireTranspiledTs('src/main/engine/ollama-service.ts')
const { runRemoteStudyEngine } = requireTranspiledTs('src/main/engine/remote-chat-service.ts')

// Capture the actual model payloads made by the production service. The wrapper
// forwards requests unchanged and never records the Gemini Authorization header.
const realFetch = globalThis.fetch
let trace = null
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  const chat = url.endsWith('/api/chat') || url.endsWith('/chat/completions')
  const remoteChat = url.endsWith('/chat/completions')
  const body = chat && init?.body ? JSON.parse(String(init.body)) : undefined
  for (let attempt = 1; ; attempt += 1) {
    // The production request's timeout signal cannot be reused indefinitely.
    // Give each retry a fresh timeout while keeping the request body unchanged.
    const attemptInit = attempt === 1 ? init : { ...init, signal: AbortSignal.timeout(180_000) }
    const response = await realFetch(input, attemptInit)
    if (chat && trace) {
      let usage
      try {
        const payload = await response.clone().json()
        usage = url.endsWith('/api/chat')
          ? { doneReason: payload.done_reason, promptTokens: payload.prompt_eval_count,
              outputTokens: payload.eval_count, totalDurationNs: payload.total_duration }
          : { finishReason: payload.choices?.[0]?.finish_reason, ...payload.usage }
      } catch { usage = { responseStatus: response.status } }
      const sourceUnitCount = (body?.messages ?? []).reduce((count, message) =>
        count + (String(message.content ?? '').match(/### Source unit\n/g) ?? []).length, 0)
      trace.push({ url, ...(attempt === 1 ? { request: body } : {}),
        sourceUnitCount, attempt, responseStatus: response.status, usage })
    }
    if (!remoteChat || ![429, 503].includes(response.status)) return response
    if (response.status === 429 && attempt === 1) {
      const detail = (await response.clone().text()).replaceAll(apiKey, '[redacted]').slice(0, 800)
      console.log(`Gemini returned 429 (rate or quota limit): ${detail}`)
    }
    const delayMs = response.status === 429
      ? Math.min(60_000 * 2 ** Math.min(attempt - 1, 3), 300_000)
      : Math.min(5_000 * 2 ** Math.min(attempt - 1, 4), 60_000)
    console.log(`Gemini returned ${response.status}; retrying the same request in ${delayMs / 1000}s (attempt ${attempt})...`)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}

function save(report) {
  mkdirSync(dirname(output), { recursive: true })
  const temporary = `${output}.tmp`
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`)
  renameSync(temporary, output)
}

// This is the same worker and commands that the desktop Python bridge uses.
function startWorker() {
  const python = join(root, 'app_runtime/python/bin/python')
  if (!existsSync(python)) throw new Error(`Python runtime missing: ${python}`)
  mkdirSync(profile, { recursive: true })
  const child = spawn(python, [join(root, 'python_engine/tokensmith_engine.py')], {
    cwd: root, env: { ...process.env, PYTHONUNBUFFERED: '1',
      TOKENSMITH_LOG_FILE: join(profile, 'python-engine.log') },
    stdio: ['pipe', 'pipe', 'inherit']
  })
  const pending = new Map()
  let nextId = 0
  child.on('error', (error) => {
    for (const item of pending.values()) item.reject(error)
    pending.clear()
  })
  child.on('exit', (code) => {
    for (const item of pending.values()) item.reject(new Error(`Python worker exited: ${code}`))
    pending.clear()
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message
    try { message = JSON.parse(line) } catch { return }
    const item = pending.get(message.id)
    if (!item) return
    if (message.progress) {
      if (message.progress.phase === 'embedding' && message.progress.processedEmbeddings % 100 === 0)
        console.log(`Index: ${message.progress.processedEmbeddings}/${message.progress.totalEmbeddings} embeddings`)
      return
    }
    if (message.ok === undefined) return
    pending.delete(message.id)
    if (message.ok) item.resolve(message.result)
    else item.reject(new Error(message.error))
  })
  return {
    request(command, payload) {
      const id = String(++nextId)
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        child.stdin.write(`${JSON.stringify({ id, command, payload })}\n`)
      })
    },
    close() { child.stdin.end() }
  }
}

function modelFromTag(name, tag) {
  return {
    id: `ollama:${name}`, name: `Ollama ${name}`, engine: 'ollama',
    role: 'generator', status: 'ready', source: 'ollama',
    ollamaModelName: name, ollamaBaseUrl: ollama,
    contextLength: tag.details?.context_length,
    parameters: tag.details?.parameter_size,
    quant: tag.details?.quantization_level
  }
}

async function main() {
  const tagsResponse = await realFetch(`${ollama}/api/tags`, { signal: AbortSignal.timeout(10_000) })
  if (!tagsResponse.ok) throw new Error(`Ollama tags: HTTP ${tagsResponse.status}`)
  const tags = (await tagsResponse.json()).models ?? []
  const models = modelNames.map((name) => {
    const tag = tags.find((item) => item.name === name)
    if (!tag) throw new Error(`Ollama model missing: ${name}`)
    if (tag.digest !== expectedDigests[name]) throw new Error(`Ollama tag changed: ${name}; review before running`)
    return modelFromTag(name, tag)
  })
  const nomic = tags.find((item) => item.name === 'nomic-embed-text:latest')
  if (!nomic) throw new Error('Nomic embedding model is missing from Ollama')
  if (nomic.digest !== '0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f')
    throw new Error('Nomic embedding tag changed; review before indexing')
  const geminiModelsResponse = await realFetch('https://generativelanguage.googleapis.com/v1beta/openai/models', {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000)
  })
  if (!geminiModelsResponse.ok)
    throw new Error(`Gemini model-list check failed with HTTP ${geminiModelsResponse.status}; no book or answers were run`)
  const geminiModels = (await geminiModelsResponse.json()).data ?? []
  if (!geminiModels.some((item) => item.id === geminiModelName || item.id === `models/${geminiModelName}`))
    throw new Error(`${geminiModelName} is not listed for this key; no book or answers were run`)
  const savedReport = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null
  if (savedReport && (savedReport.bookSha256 !== bookSha256 || savedReport.appVersion !== packageInfo.version))
    throw new Error('Existing results use a different book or app version; move them aside before a new run')
  const hasSavedGeminiAnswer = savedReport?.cases?.some((item) =>
    item.modelId === `gemini:${geminiModelName}` && item.answer)
  // A listed model may still be unavailable to this account (as 2.5 Flash was).
  // A saved Gemini answer already proves connectivity; avoid an extra API call on resume.
  if (!hasSavedGeminiAnswer) {
    const geminiCheck = await globalThis.fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model: geminiModelName,
        messages: [{ role: 'user', content: 'Reply with the word OK.' }], max_tokens: 512 }),
      signal: AbortSignal.timeout(30_000)
    })
    if (!geminiCheck.ok)
      throw new Error(`${geminiModelName} connection check failed with HTTP ${geminiCheck.status}: ${
        (await geminiCheck.text()).replaceAll(apiKey, '[redacted]').slice(0, 800)}`)
    const geminiCheckBody = await geminiCheck.json()
    if (!geminiCheckBody.choices?.[0]?.message?.content?.trim())
      throw new Error(`${geminiModelName} returned no text during connection check; no answers were run`)
  }

  const report = savedReport ?? {
    createdAt: new Date().toISOString(), appVersion: packageInfo.version,
    method: 'Fresh-profile Basic preparation; production Python hybrid search, model-aware retrieval limit, first-turn prompt and generation services; no GUI or prior conversation.',
    book, bookSha256, questionsPath, settings,
    embeddingModel: { name: nomic.name, digest: nomic.digest },
    ollamaModels: Object.fromEntries(models.map((model) => [model.ollamaModelName,
      { digest: expectedDigests[model.ollamaModelName], contextLength: model.contextLength }])),
    cases: []
  }
  // Preserve the unavailable recommended-model attempt without counting it as
  // one of the four evaluated model conditions.
  const unavailableGemini = report.cases.filter((item) => item.modelId === 'gemini:gemini-2.5-flash' && !item.answer)
  if (unavailableGemini.length) {
    report.excludedAttempts = [...(report.excludedAttempts ?? []), ...unavailableGemini]
    report.cases = report.cases.filter((item) => !unavailableGemini.includes(item))
  }
  const failedAttempts = report.cases.filter((item) => item.error && !item.answer)
  if (failedAttempts.length) {
    report.failedAttempts = [...(report.failedAttempts ?? []), ...failedAttempts]
    report.cases = report.cases.filter((item) => !failedAttempts.includes(item))
  }
  report.geminiSubstitution = {
    unavailableRecommendation: 'gemini-2.5-flash',
    evaluatedModel: geminiModelName,
    reason: 'Gemini API returned HTTP 404 for 2.5 Flash to this account.'
  }
  save(report)

  const worker = startWorker()
  try {
    const listed = await worker.request('list_materials', { userDataPath: profile })
    let material = listed.materials?.find((item) => item.path === book && item.status === 'ready')
    if (!material) {
      console.log('Preparing BuzzDB with the default Basic method and Nomic embedder...')
      const indexed = await worker.request('index_material', {
        userDataPath: profile, path: book, model: embedder, embeddingGpuEnabled: true
      })
      material = indexed.material
    }
    if (material.status !== 'ready' || material.chunkCount !== 1574)
      throw new Error(`Unexpected book preparation: ${material.status}, ${material.chunkCount} chunks; review before answers`)
    report.material = material
    save(report)

    const gemini = {
      id: `gemini:${geminiModelName}`, name: 'Gemini 3.8 Flash (Google)',
      engine: 'remote', role: 'generator', status: 'ready', source: 'remote',
      providerId: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      remoteModelName: geminiModelName, apiKey
      // The fresh UI does not discover a cloud context length.
    }
    for (const model of [...models, gemini]) {
      const activeModelSettings = modelSettingsFor(model.id)
      for (const definition of questions) {
        const key = `${model.id}/${definition.id}`
        if (report.cases.some((item) => item.key === key && item.answer)) continue
        const started = performance.now()
        const candidateLimit = modelAwareRetrievalLimit(settings.maxSources, model, activeModelSettings)
        let searchResult
        const prepared = await prepareRewrittenStudyChat({
          prompt: definition.question, messages: [], materials: [material], model,
          settings, applicationSettings: application, modelSettings: activeModelSettings
        }, {
          resolve: async () => { throw new Error('A fresh first question must not require a rewrite') },
          search: async (query) => {
            searchResult = await worker.request('search', {
              userDataPath: profile, query, materials: [material],
              limit: candidateLimit, embeddingModels: [embedder],
              searchMode: application.searchMode, embeddingGpuEnabled: true
            })
            return searchResult.sources
          }
        })
        if (!prepared.request || !searchResult?.sources?.length)
          throw new Error(`No retrieved sources for ${key}`)

        const request = prepared.request
        const entry = {
          key, question: definition.question, modelId: model.id,
          modelSettings: activeModelSettings,
          candidateLimit, retrievalQuery: request.retrievalQuery,
          retrievedSources: request.retrievedSources,
          estimatedBudget: sourceContextBudgetForRequest(request),
          rewriteMs: prepared.rewriteMs, searchMs: prepared.searchMs
        }
        // Save retrieval before a model call, then save each answer immediately.
        report.cases = report.cases.filter((item) => item.key !== key)
        report.cases.push(entry)
        save(report)
        trace = []
        try {
          const answer = model.engine === 'ollama'
            ? await runOllamaStudyEngine(request)
            : await runRemoteStudyEngine(request)
          entry.answer = answer
          entry.seconds = (performance.now() - started) / 1000
          entry.modelRequests = trace
          console.log(`${key}: ${entry.seconds.toFixed(1)}s; ${request.retrievedSources.length} retrieved; ${answer.sources.length} shown`)
        } catch (error) {
          entry.error = error instanceof Error ? error.message : String(error)
          entry.modelRequests = trace
          save(report)
          throw error
        } finally {
          trace = null
          save(report)
        }
      }
    }
  } finally {
    worker.close()
  }
  console.log(`Saved ${report.cases.filter((item) => item.answer).length} answers to ${output}`)
  console.log('Gemini web answers must be collected separately in the Gemini web interface.')
}

await main()
