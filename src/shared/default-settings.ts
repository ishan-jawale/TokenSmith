import type { ApplicationSettings, ModelRuntimeSettings, TokenSmithSettings } from './app-state'
import { defaultFollowUpSuggestionCount, defaultStarterQuestionPrompt, defaultSuggestedFollowUpPrompt } from './model-defaults'

// Shared by the application and diagnostics so a benchmark cannot silently use
// a different runtime profile from a fresh application session.
export const defaultModelRuntimeSettings: ModelRuntimeSettings = {
  systemMessage: '',
  suggestedFollowUpPrompt: defaultSuggestedFollowUpPrompt,
  starterQuestionPrompt: defaultStarterQuestionPrompt,
  contextLength: 8192,
  contextLengthMode: 'auto',
  maxLength: 1536,
  reasoningMode: 'auto',
  temperature: 0.7,
  topP: 0.4,
  topK: 40,
  minP: 0,
  repeatPenalty: 1.18,
}

export const defaultApplicationSettings: ApplicationSettings = {
  theme: 'light',
  fontSize: 'normal',
  defaultModelId: '',
  suggestionMode: 'on',
  searchMode: 'hybrid',
  explanationDepthEnabled: false,
  explanationDepth: 'standard',
  followUpSuggestionCount: defaultFollowUpSuggestionCount,
  showSources: true,
  embeddingGpuEnabled: true
}

export const defaultSettings: TokenSmithSettings = {
  maxSources: 4,
  application: defaultApplicationSettings,
  modelDefaults: defaultModelRuntimeSettings,
  modelSettingsById: {}
}
