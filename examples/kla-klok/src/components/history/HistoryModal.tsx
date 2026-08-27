import React from 'react'
import type { RoundSettlement, Language } from '../../types/index.js'
import { X, History, Trash2 } from 'lucide-react'
import { renderSymbolIcon } from '../../assets/icons/index.js'

interface HistoryModalProps {
  isOpen: boolean
  onClose: () => void
  history: RoundSettlement[]
  onClearHistory: () => void
  language: Language
  t: (key: any, params?: Record<string, string | number>) => string
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  history,
  onClearHistory,
  language: _language,
  t,
}) => {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/80 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-modal-title"
      data-testid="history-modal"
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-stone-900 border border-stone-800 rounded-3xl p-5 sm:p-6 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-800 pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
              <History className="w-5 h-5" />
            </div>
            <h2 id="history-modal-title" className="text-lg sm:text-xl font-bold text-stone-100 font-khmer">
              {t('history.title')}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                type="button"
                onClick={onClearHistory}
                className="p-2 rounded-lg text-red-400 hover:bg-red-950/40 border border-red-900/40 text-xs transition cursor-pointer flex items-center gap-1"
                aria-label={t('history.clear')}
                title={t('history.clear')}
                data-testid="clear-history-button"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('history.clear')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition cursor-pointer"
              aria-label={t('rules.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        {history.length === 0 ? (
          <div className="py-12 text-center text-stone-400 font-khmer" data-testid="history-empty">
            {t('history.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((entry) => (
              <div
                key={`${entry.roundNumber}-${entry.timestamp}`}
                className="bg-stone-950/60 border border-stone-800 rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                data-testid={`history-card-${entry.roundNumber}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-stone-800 text-stone-300">
                    #{entry.roundNumber}
                  </span>

                  {/* 3 Dice icons */}
                  <div className="flex items-center gap-1.5">
                    {entry.dice.map((d, i) => (
                      <div
                        key={i}
                        className="w-8 h-8 rounded-lg bg-stone-800 border border-stone-700 p-1 flex items-center justify-center"
                      >
                        {renderSymbolIcon(d, { className: 'w-full h-full' })}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Return and Profit / Loss */}
                <div className="flex items-center justify-between sm:justify-end gap-4 text-xs sm:text-sm">
                  <div className="text-stone-400">
                    Stake: ${entry.totalStake}
                  </div>
                  <div
                    className={`font-bold tabular-nums ${
                      entry.netProfit > 0
                        ? 'text-emerald-400'
                        : entry.netProfit < 0
                          ? 'text-red-400'
                          : 'text-stone-300'
                    }`}
                  >
                    {entry.netProfit > 0 ? `+$${entry.netProfit}` : `-$${Math.abs(entry.netProfit)}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
