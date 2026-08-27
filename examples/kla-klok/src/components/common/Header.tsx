import React from 'react'
import type { Language } from '../../types/index.js'
import { Volume2, VolumeX, HelpCircle, History, RotateCcw, Globe, Eye, Keyboard } from 'lucide-react'
import { KbachBorder } from '../../assets/icons/index.js'

interface HeaderProps {
  language: Language
  onLanguageChange: (lang: Language) => void
  soundEnabled: boolean
  onToggleSound: () => void
  highContrast?: boolean
  onToggleHighContrast?: () => void
  onOpenRules: () => void
  onOpenHistory: () => void
  onOpenShortcuts?: () => void
  onResetGame: () => void
  t: (key: any, params?: Record<string, string | number>) => string
}

export const Header: React.FC<HeaderProps> = ({
  language,
  onLanguageChange,
  soundEnabled,
  onToggleSound,
  highContrast = false,
  onToggleHighContrast,
  onOpenRules,
  onOpenHistory,
  onOpenShortcuts,
  onResetGame,
  t,
}) => {
  return (
    <header className="w-full bg-stone-900/90 backdrop-blur border-b border-amber-500/20 px-3 sm:px-4 py-3 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Title and Branding */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md shadow-amber-500/20 border border-amber-400/40">
            <span className="text-stone-950 font-black text-xl leading-none">ខ្លា</span>
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-amber-400 flex items-center gap-2 font-khmer">
              <span>{t('app.title')}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-sans font-normal">
                Khmer Dice
              </span>
            </h1>
            <p className="text-xs text-stone-400 hidden sm:block font-khmer">
              {t('app.subtitle')}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          {/* Language Toggle (Khmer / English) */}
          <button
            type="button"
            onClick={() => onLanguageChange(language === 'km' ? 'en' : 'km')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-100 border border-stone-700 hover:border-amber-500/50 text-xs font-semibold transition cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            aria-label={`${t('action.language')}: ${language === 'km' ? 'Switch to English' : 'ប្តូរទៅភាសាខ្មែរ'}`}
            title={`Switch to ${language === 'km' ? 'English (L)' : 'ភាសាខ្មែរ (L)'}`}
            data-testid="language-toggle-button"
          >
            <Globe className="w-3.5 h-3.5 text-amber-400" />
            <span>{language === 'km' ? 'EN' : 'ខ្មែរ'}</span>
            <kbd className="hidden md:inline text-[9px] font-mono bg-stone-900 px-1 rounded text-stone-400 border border-stone-700">
              L
            </kbd>
          </button>

          {/* High Contrast Mode Toggle */}
          {onToggleHighContrast && (
            <button
              type="button"
              onClick={onToggleHighContrast}
              className={`p-2 rounded-xl border text-xs transition cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 ${
                highContrast
                  ? 'bg-amber-500 text-stone-950 border-amber-300 shadow-md ring-2 ring-amber-400'
                  : 'bg-stone-800/90 hover:bg-stone-700 text-stone-200 border-stone-700'
              }`}
              aria-label={highContrast ? t('action.high_contrast_off') : t('action.high_contrast_on')}
              aria-pressed={highContrast}
              title={`High Contrast (H)`}
              data-testid="high-contrast-toggle-button"
            >
              <Eye className="w-4 h-4" />
            </button>
          )}

          {/* Keyboard Shortcuts Dialog Trigger */}
          {onOpenShortcuts && (
            <button
              type="button"
              onClick={onOpenShortcuts}
              className="p-2 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-200 border border-stone-700 text-xs transition cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
              aria-label={t('action.shortcuts')}
              title={`${t('action.shortcuts')} (?)`}
              data-testid="shortcuts-modal-button"
            >
              <Keyboard className="w-4 h-4 text-amber-400" />
            </button>
          )}

          {/* Sound Toggle */}
          <button
            type="button"
            onClick={onToggleSound}
            className="p-2 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-200 border border-stone-700 text-xs transition cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            aria-label={soundEnabled ? t('action.sound_off') : t('action.sound_on')}
            title={soundEnabled ? t('action.sound_off') : t('action.sound_on')}
            data-testid="sound-toggle-button"
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <VolumeX className="w-4 h-4 text-stone-400" />
            )}
          </button>

          {/* Rules / Paytable Modal */}
          <button
            type="button"
            onClick={onOpenRules}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-200 border border-stone-700 text-xs font-medium transition cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            aria-label={t('action.rules')}
            data-testid="rules-modal-button"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline">{t('action.rules')}</span>
          </button>

          {/* History Modal */}
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-200 border border-stone-700 text-xs font-medium transition cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            aria-label={t('action.history')}
            data-testid="history-modal-button"
          >
            <History className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden md:inline">{t('action.history')}</span>
          </button>

          {/* Reset Game */}
          <button
            type="button"
            onClick={onResetGame}
            className="p-2 rounded-xl bg-stone-800/90 hover:bg-red-950/40 hover:text-red-300 text-stone-300 border border-stone-700 hover:border-red-800 text-xs transition cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-red-400"
            aria-label={t('action.reset_game')}
            title={t('action.reset_game')}
            data-testid="header-reset-button"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
      <KbachBorder className="w-full h-2 mt-1 opacity-25" />
    </header>
  )
}
