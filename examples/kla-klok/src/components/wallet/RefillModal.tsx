import React from 'react'
import type { Language } from '../../types/index.js'
import { Coins, RotateCcw, PlusCircle, AlertCircle, X, Sparkles } from 'lucide-react'

interface RefillModalProps {
  isOpen: boolean
  onClose: () => void
  balance: number
  isBroke?: boolean
  onTopUp: (amount: number) => void
  onReset: () => void
  language: Language
  t: (key: any, params?: Record<string, string | number>) => string
}

const REFILL_PRESETS = [100, 500, 1000, 2500]

export const RefillModal: React.FC<RefillModalProps> = ({
  isOpen,
  onClose,
  balance,
  isBroke = false,
  onTopUp,
  onReset,
  language: _language,
  t,
}) => {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/85 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="refill-modal-title"
      data-testid="refill-modal"
    >
      <div className="relative w-full max-w-md bg-stone-900 border border-amber-500/30 rounded-3xl p-6 shadow-2xl shadow-amber-500/10">
        {/* Close Button (if not forced broke or user wants to dismiss) */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-lg text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition cursor-pointer"
          aria-label={t('rules.close')}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-lg shrink-0 ${
              isBroke
                ? 'bg-red-500/10 border-red-500/30 text-red-400 shadow-red-500/10'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-amber-500/10'
            }`}
          >
            {isBroke ? <AlertCircle className="w-6 h-6 animate-pulse" /> : <Coins className="w-6 h-6" />}
          </div>
          <div>
            <h2
              id="refill-modal-title"
              className="text-xl font-bold text-stone-100 font-khmer flex items-center gap-2"
            >
              {isBroke ? t('wallet.broke_title') : t('wallet.refill_title')}
            </h2>
            <p className="text-xs text-stone-400 font-khmer mt-0.5">
              {isBroke ? t('wallet.broke_desc') : t('wallet.refill_desc')}
            </p>
          </div>
        </div>

        {/* Current Balance Display */}
        <div className="bg-stone-950/70 border border-stone-800 rounded-2xl p-3.5 mb-5 flex items-center justify-between">
          <span className="text-xs font-medium text-stone-400 uppercase tracking-wider">
            {t('wallet.current_balance')}
          </span>
          <span
            className={`text-xl font-bold tabular-nums ${
              balance === 0 ? 'text-red-400' : 'text-amber-400'
            }`}
            data-testid="refill-current-balance"
          >
            ${balance.toLocaleString()}
          </span>
        </div>

        {/* Top-up Presets Grid */}
        <div className="mb-5">
          <div className="text-xs font-semibold text-stone-300 mb-2 flex items-center gap-1.5">
            <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span>Top-up / Refill Amount</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {REFILL_PRESETS.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => {
                  onTopUp(amt)
                  onClose()
                }}
                className="py-3 px-4 rounded-xl bg-stone-800/80 hover:bg-amber-600/20 text-stone-100 border border-stone-700 hover:border-amber-500/50 transition font-bold text-sm flex items-center justify-center gap-2 cursor-pointer group shadow-sm active:scale-95"
                data-testid={`topup-button-${amt}`}
              >
                <Sparkles className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                <span>+${amt.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Full Reset Option */}
        <div className="pt-4 border-t border-stone-800 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              onReset()
              onClose()
            }}
            className="w-full py-2.5 px-4 rounded-xl bg-stone-800/60 hover:bg-red-950/40 text-stone-300 hover:text-red-300 border border-stone-700 hover:border-red-800/60 text-xs font-medium transition cursor-pointer flex items-center justify-center gap-2"
            data-testid="refill-reset-button"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t('wallet.reset_stats')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
