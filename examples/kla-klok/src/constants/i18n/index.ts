import { km } from './km.js'
import { en } from './en.js'
import type { Language, TranslationDictionary } from '../../types/index.js'

export const TRANSLATIONS: Record<Language, TranslationDictionary> = {
  km,
  en,
}

export * from './km.js'
export * from './en.js'
