import React from 'react'
import type { RoundSettlement, Language } from '../../types/index.js'
import { History, ChevronRight } from 'lucide-react'
import { renderSymbolIcon } from '../../assets/icons/index.js'

interface RecentRollHistoryProps {
  history: RoundSettlement[]
  onOpenFullHistory: () => void
  language: Language
  t: (key: any, params?: Record<string, string | number>) => string
}

export const RecentRollHistory: React.FC<RecentRollHistoryProps> = ({
  history,
  onOpenFullHistory,
  language: _language,
  t,
}) => {
  // Show up to the last 8 recent rolls
  const recentEntries = history.slice(0, 8)

  return (
    <div
      className="w-full bg-stone-900/70 border border-stone-800/90 rounded-2xl p-3 shadow-lg backdrop-blur"
      data-testid="recent-roll-history"
    >
      <div className="flex items-center justify-between gap-2 mb-2 px-1">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-stone-300 font-khmer">
            {t('history.recent_title')}
          </span>
          <span className="text-[10px] text-stone-500 font-mono">({history.length})</span>
        </div>
        {history.length > 0 && (
          <button
            type="button"
            onClick={onOpenFullHistory}
            className="text-xs text-amber-400/90 hover:text-amber-300 transition flex items-center gap-1 font-medium cursor-pointer hover:underline"
            data-testid="view-full-history-button"
          >
            <span>{t('history.view_all')}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {recentEntries.length === 0 ? (
        <div
          className="py-3 px-2 text-center text-stone-400 text-xs font-khmer bg-stone-950/40 rounded-xl border border-stone-800/40"
          data-testid="recent-history-empty"
        >
          {t('history.no_rolls')}
        </div>
      ) : (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-stone-700">
          {recentEntries.map((entry, idx) => {
            const isProfit = entry.netProfit > 0
            const isLoss = entry.netProfit < 0

            return (
              <div
                key={`${entry.roundNumber}-${entry.timestamp}-${idx}`}
                className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition-all ${
                  isProfit
                    ? 'bg-emerald-950/30 border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                    : isLoss
                      ? 'bg-red-950/20 border-red-500/30'
                      : 'bg-stone-950/60 border-stone-800'
                }`}
                data-testid={`recent-entry-${entry.roundNumber}`}
                title={`Round #${entry.roundNumber} - Net: ${
                  isProfit ? `+$${entry.netProfit}` : isLoss ? `-$${Math.abs(entry.netProfit)}` : '$0'
                }`}
              >
                {/* Round Badge */}
                <span className="text-[10px] font-mono font-bold text-stone-400">
                  #{entry.roundNumber}
                </span>

                {/* 3 Dice Icons */}
                <div className="flex items-center gap-1">
                  {entry.dice.map((d, i) => (
                    <div
                      key={i}
                      className="w-5 h-5 rounded-md bg-stone-800/90 border border-stone-700/80 p-0.5 flex items-center justify-center"
                    >
                      {renderSymbolIcon(d, { className: 'w-full h-full' })}
                    </div>
                  ))}
                </div>

                {/* Outcome badge / amount */}
                {entry.totalStake > 0 && (
                  <span
                    className={`text-[11px] font-bold font-mono pl-1 ${
                      isProfit
                        ? 'text-emerald-400'
                        : isLoss
                          ? 'text-red-400'
                          : 'text-stone-400'
                    }`}
                  >
                    {isProfit ? `+$${entry.netProfit}` : isLoss ? `-$${Math.abs(entry.netProfit)}` : '$0'}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
