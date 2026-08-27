import React from 'react'
import { X, BookOpen, Sparkles } from 'lucide-react'
import { SYMBOLS_LIST } from '../../constants/index.js'
import { renderSymbolIcon } from '../../assets/icons/index.js'

interface RulesModalProps {
  isOpen: boolean
  onClose: () => void
  t: (key: any, params?: Record<string, string | number>) => string
}

export const RulesModal: React.FC<RulesModalProps> = ({ isOpen, onClose, t }) => {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/80 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-modal-title"
      data-testid="rules-modal"
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-stone-900 border border-amber-500/40 rounded-3xl p-5 sm:p-6 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-800 pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <h2 id="rules-modal-title" className="text-lg sm:text-xl font-bold text-amber-400 font-khmer">
              {t('rules.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition cursor-pointer"
            aria-label={t('rules.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6 text-sm text-stone-300">
          <div>
            <p className="leading-relaxed font-khmer">
              {t('rules.description')}
            </p>
          </div>

          {/* 6 Symbols Grid */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-amber-400 font-bold mb-3">
              Six Traditional Symbols (រូបសត្វទាំង ៦)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {SYMBOLS_LIST.map((symbol) => (
                <div
                  key={symbol.id}
                  className="bg-stone-950/60 border border-stone-800 rounded-xl p-2.5 flex items-center gap-3"
                >
                  <div className="w-10 h-10 shrink-0">
                    {renderSymbolIcon(symbol.id, { className: 'w-full h-full' })}
                  </div>
                  <div>
                    <div className="font-bold text-stone-100 font-khmer">{symbol.khmerName}</div>
                    <div className="text-xs text-stone-400">{symbol.englishName}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Payout Table */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-amber-400 font-bold mb-3 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              <span>{t('rules.payout_table')}</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-800 text-stone-400 text-xs uppercase">
                    <th className="py-2 px-3">Matches</th>
                    <th className="py-2 px-3">Payout Ratio</th>
                    <th className="py-2 px-3">Example ($100 Bet)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/60 text-xs sm:text-sm">
                  <tr>
                    <td className="py-2.5 px-3 font-semibold text-emerald-400">1 Match (ត្រូវ ១)</td>
                    <td className="py-2.5 px-3">1:1 (+ stake return)</td>
                    <td className="py-2.5 px-3 text-stone-200">Returns $200 (Profit $100)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold text-amber-400">2 Matches (ត្រូវ ២)</td>
                    <td className="py-2.5 px-3">2:1 (+ stake return)</td>
                    <td className="py-2.5 px-3 text-stone-200">Returns $300 (Profit $200)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold text-rose-400">3 Matches (ត្រូវ ៣)</td>
                    <td className="py-2.5 px-3">3:1 (+ stake return)</td>
                    <td className="py-2.5 px-3 text-stone-200">Returns $400 (Profit $300)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold text-stone-500">0 Matches (មិនត្រូវ)</td>
                    <td className="py-2.5 px-3">Stake Forfeited</td>
                    <td className="py-2.5 px-3 text-stone-400">Returns $0 (Loss -$100)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-stone-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm transition cursor-pointer"
          >
            {t('rules.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
