import React from 'react'
import type { WalletState } from '../../types/index.js'
import { Coins, Flame, TrendingUp, PlusCircle } from 'lucide-react'

interface WalletBarProps {
  wallet: WalletState
  totalBet: number
  roundNumber: number
  onOpenRefill?: () => void
  t: (key: any, params?: Record<string, string | number>) => string
}

export const WalletBar: React.FC<WalletBarProps> = ({
  wallet,
  totalBet,
  roundNumber,
  onOpenRefill,
  t,
}) => {
  const isProfit = wallet.netEarnings >= 0

  return (
    <div className="w-full bg-stone-900/90 border border-amber-500/30 rounded-2xl p-3 sm:p-4 shadow-xl backdrop-blur">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center sm:text-left">
        {/* Balance */}
        <div className="bg-stone-950/60 border border-stone-800 rounded-xl p-2.5 sm:p-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Coins className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-stone-400 font-medium">
                {t('wallet.balance')}
              </div>
              <div
                className="text-lg sm:text-xl font-bold text-amber-400 tabular-nums"
                data-testid="wallet-balance"
              >
                ${wallet.balance.toLocaleString()}
              </div>
            </div>
          </div>

          {onOpenRefill && (
            <button
              type="button"
              onClick={onOpenRefill}
              className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 transition cursor-pointer shrink-0"
              title={t('wallet.refill')}
              aria-label={t('wallet.refill')}
              data-testid="wallet-refill-button"
            >
              <PlusCircle className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Total Bet this round */}
        <div className="bg-stone-950/60 border border-stone-800 rounded-xl p-2.5 sm:p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-stone-400 font-medium">
              {t('bet.total_bet')}
            </div>
            <div
              className="text-lg sm:text-xl font-bold text-stone-100 tabular-nums"
              data-testid="total-bet-amount"
            >
              ${totalBet.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Round Number */}
        <div className="bg-stone-950/60 border border-stone-800 rounded-xl p-2.5 sm:p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-sky-400">#</span>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-stone-400 font-medium">
              {t('history.round')}
            </div>
            <div
              className="text-lg sm:text-xl font-bold text-stone-100 tabular-nums"
              data-testid="current-round-number"
            >
              #{roundNumber}
            </div>
          </div>
        </div>

        {/* Net Profit / Lifetime stats */}
        <div className="bg-stone-950/60 border border-stone-800 rounded-xl p-2.5 sm:p-3 flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${
              isProfit
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-red-500/10 border-red-500/30'
            }`}
          >
            <TrendingUp
              className={`w-5 h-5 ${isProfit ? 'text-emerald-400' : 'text-red-400 rotate-180'}`}
            />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-stone-400 font-medium">
              {t('bet.profit')}
            </div>
            <div
              className={`text-lg sm:text-xl font-bold tabular-nums ${
                isProfit ? 'text-emerald-400' : 'text-red-400'
              }`}
              data-testid="net-earnings"
            >
              {isProfit ? '+' : ''}${wallet.netEarnings.toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
