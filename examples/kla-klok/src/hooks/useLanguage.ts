import { useState, useCallback, useMemo, useEffect } from 'react'
import type { Language, TranslationKey } from '../types/index.js'
import { TRANSLATIONS } from '../constants/index.js'
import { loadSettings, saveSettings } from '../core/storage.js'

export function useLanguage(initialLang?: Language) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (initialLang) return initialLang
    return loadSettings().language
  })

  // Sync if initialLang changes externally
  useEffect(() => {
    if (initialLang && initialLang !== language) {
      setLanguageState(initialLang)
    }
  }, [initialLang])

  // Update HTML document lang attribute
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language
    }
  }, [language])

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    const current = loadSettings()
    saveSettings({ ...current, language: lang })
  }, [])

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev: Language) => {
      const next: Language = prev === 'km' ? 'en' : 'km'
      const current = loadSettings()
      saveSettings({ ...current, language: next })
      return next
    })
  }, [])

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      const dict = TRANSLATIONS[language] || TRANSLATIONS.en
      let str = dict[key] || TRANSLATIONS.en[key] || key

      if (params) {
        for (const [paramKey, value] of Object.entries(params)) {
          str = str.replaceAll(`{${paramKey}}`, String(value))
          str = str.replaceAll(`\${${paramKey}}`, String(value))
        }
      }

      return str
    },
    [language],
  )

  return useMemo(
    () => ({
      language,
      setLanguage,
      toggleLanguage,
      t,
      isKhmer: language === 'km',
    }),
    [language, setLanguage, toggleLanguage, t],
  )
}
