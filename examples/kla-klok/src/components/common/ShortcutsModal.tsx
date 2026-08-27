import React from 'react'
import { X, Keyboard, Sparkles, Eye } from 'lucide-react'
import type { Language } from '../../types/index.js'

interface ShortcutsModalProps {
  isOpen: boolean
  onClose: () => void
  language?: Language
  t: (key: any, params?: Record<string, string | number>) => string
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({
  isOpen,
  onClose,
  language: _language = 'km',
  t,
}) => {
  if (!isOpen) return null

  const shortcutGroups = [
    {
      title: 'Game & Betting Actions',
      titleKm: 'សកម្មភាពលេង & ការភ្នាល់',
      shortcuts: [
        { key: 'Space / R', desc: 'Roll Dice (Betting) or Start New Round (Settled)', descKm: 'ក្រឡុកគ្រាប់ឡុកឡាក់ ឬ ចាប់ផ្តើមជុំថ្មី' },
        { key: 'C', desc: 'Clear all active bets on the board', descKm: 'លុបការភ្នាល់ទាំងអស់លើក្ដារ' },
        { key: 'D', desc: 'Double all active bets (2x)', descKm: 'គុណប្រាក់ភ្នាល់ទាំងអស់នឹងពីរ (2x)' },
        { key: 'B', desc: 'Repeat previous round wager (Rebet)', descKm: 'ដាក់ប្រាក់ភ្នាល់ដូចជុំមុន' },
      ],
    },
    {
      title: 'Symbol Slots & Board Navigation',
      titleKm: 'ការរំកិល & ដាក់ភ្នាល់លើរូបសត្វ',
      shortcuts: [
        { key: '1 - 6', desc: 'Quick bet on Tiger (1), Gourd (2), Shrimp (3), Fish (4), Crab (5), Rooster (6)', descKm: 'ភ្នាល់រហ័សលើ ខ្លា (1), ឃ្លោក (2), បង្កង (3), ត្រី (4), ក្តាម (5), មាន់ (6)' },
        { key: 'Arrow Keys', desc: 'Navigate between symbol tiles in 2x3 board grid', descKm: 'រំកិលរវាងក្រឡារូបសត្វទាំង ៦' },
        { key: 'Enter / Space', desc: 'Place selected chip bet on focused symbol', descKm: 'ដាក់ប្រាក់ភ្នាល់លើរូបសត្វដែលកំពុងជ្រើស' },
        { key: 'Backspace / Del', desc: 'Remove / clear bet on focused symbol', descKm: 'ដកប្រាក់ភ្នាល់ចេញពីរូបសត្វដែលកំពុងជ្រើស' },
      ],
    },
    {
      title: 'Chip Selection & Cycling',
      titleKm: 'ការជ្រើសរើសកាក់ភ្នាល់',
      shortcuts: [
        { key: '[  /  ]', desc: 'Cycle previous / next chip denomination ($1 to $1000)', descKm: 'ផ្លាស់ប្តូរទំហំកាក់ភ្នាល់មុន / បន្ទាប់ ($1 ដល់ $1000)' },
        { key: '←  /  →', desc: 'Move focus & select chips in radiogroup', descKm: 'រំកិលជ្រើសរើសកាក់ភ្នាល់' },
      ],
    },
    {
      title: 'Accessibility & System',
      titleKm: 'ភាពងាយស្រួលប្រើប្រាស់ & ប្រព័ន្ធ',
      shortcuts: [
        { key: 'L', desc: 'Toggle Language (Khmer ភាសាខ្មែរ / English)', descKm: 'ប្តូរភាសាភ្លាមៗ (ភាសាខ្មែរ / English)' },
        { key: 'H', desc: 'Toggle High Contrast Mode (WCAG AAA)', descKm: 'បើក / បិទកម្រិតពណ៌ច្បាស់ខ្ពស់' },
        { key: '?', desc: 'Open Keyboard Shortcuts help modal', descKm: 'បើកផ្ទាំងជំនួយគ្រាប់ចុចផ្លូវកាត់' },
        { key: 'Esc', desc: 'Close any active modal dialog', descKm: 'បិទផ្ទាំងដែលកំពុងបើក' },
      ],
    },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/85 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
      data-testid="shortcuts-modal"
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-stone-900 border border-amber-500/40 rounded-3xl p-5 sm:p-6 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-800 pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h2 id="shortcuts-modal-title" className="text-lg sm:text-xl font-bold text-amber-400 font-khmer">
                {t('shortcuts.title')}
              </h2>
              <p className="text-xs text-stone-400 font-khmer mt-0.5">
                {t('shortcuts.subtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition cursor-pointer"
            aria-label={t('shortcuts.close')}
            data-testid="shortcuts-modal-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Groups */}
        <div className="space-y-5 text-sm text-stone-200">
          {shortcutGroups.map((group, gIdx) => (
            <div key={gIdx} className="bg-stone-950/60 border border-stone-800/90 rounded-2xl p-3.5 sm:p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-3 flex items-center gap-2 font-khmer">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>{group.title} ({group.titleKm})</span>
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {group.shortcuts.map((item, sIdx) => (
                  <div
                    key={sIdx}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-xl bg-stone-900/80 border border-stone-800/80"
                  >
                    <div className="flex items-center gap-2">
                      <kbd className="px-2.5 py-1 rounded-lg bg-stone-800 border border-amber-500/30 font-mono font-bold text-amber-300 text-xs shadow-sm whitespace-nowrap">
                        {item.key}
                      </kbd>
                    </div>
                    <div className="text-xs text-stone-300 sm:text-right font-khmer">
                      <span>{item.desc}</span>
                      <span className="block sm:inline text-stone-400 sm:ml-1 text-[11px]">
                        ({item.descKm})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Accessibility & Screen Reader Note */}
        <div className="mt-4 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
          <Eye className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-stone-300 leading-relaxed font-khmer">
            <strong>ARIA Live & High Contrast:</strong> Screen reader announcements are broadcast automatically for roll countdowns, resulting dice symbols, and round win/loss calculations. Toggle High Contrast mode (<kbd className="font-mono text-amber-300 font-bold">H</kbd>) for maximum color contrast and prominent focus outlines.
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 pt-3 border-t border-stone-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm transition cursor-pointer"
          >
            {t('shortcuts.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
export default ShortcutsModal
