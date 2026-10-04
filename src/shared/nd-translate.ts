export const ND_TRANSLATE_ID = 'nd.translate'
export const ND_TRANSLATE_MAX_TEXT = 5_000
export type NdTranslateProvider = 'google' | 'chatgpt' | 'gemini'

export const ND_TRANSLATE_LANGUAGES = [
  { code: 'auto', label: 'Detect language' }, { code: 'en', label: 'English' },
  { code: 'km', label: 'Khmer' }, { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' }, { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' }, { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' }, { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' }, { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' }, { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' }, { code: 'vi', label: 'Vietnamese' },
  { code: 'id', label: 'Indonesian' }, { code: 'nl', label: 'Dutch' },
  { code: 'tr', label: 'Turkish' }, { code: 'uk', label: 'Ukrainian' },
] as const

export interface NdTranslateRequest {
  text: string
  sourceLanguage: string
  targetLanguage: string
  provider: NdTranslateProvider
}

export interface NdTranslateResult extends NdTranslateRequest {
  status: 'idle' | 'translated' | 'login-required' | 'challenge' | 'error' | 'busy'
  translatedText?: string
  message?: string
  browserTabId?: string
  url?: string
}

/** Trusted, provider-specific DOM observation; never a generic renderer script. */
export interface NdTranslatePage {
  url: string
  text?: string
  loginRequired?: boolean
  challenge?: boolean
  pending?: boolean
  complete?: boolean
  error?: string
}
