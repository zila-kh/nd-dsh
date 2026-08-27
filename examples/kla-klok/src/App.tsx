import { useState, useCallback, useEffect } from 'react'
import {
  Header,
  AriaLiveRegion,
  WalletBar,
  RecentRollHistory,
  DiceArena,
  ChipSelector,
  BettingBoard,
  BetControls,
  RulesModal,
  HistoryModal,
  RefillModal,
  ShortcutsModal,
} from './components/index.js'
import { useKlaKlokGame, useLanguage } from './hooks/index.js'
import { calculateTotalBet } from './core/betting.js'
import { GAME_CONFIG, CHIP_VALUES, SYMBOLS_LIST } from './constants/index.js'

export function App() {
  const {
    state,
    selectChip,
    placeBet,
    removeBet,
    clearBets,
    doubleBets,
    rebetLast,
    roll,
    nextRound,
    resetGame,
    topUpWallet,
    toggleSound,
    setLanguage,
    toggleHighContrast,
    clearHistory,
  } = useKlaKlokGame()

  const { language, setLanguage: updateLanguage, t } = useLanguage(state.language)

  const [isRulesOpen, setIsRulesOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isRefillOpen, setIsRefillOpen] = useState(false)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)

  // Instant UI Language Toggle preserving all game state
  const handleLanguageChange = useCallback(
    (newLang: 'km' | 'en') => {
      updateLanguage(newLang)
      setLanguage(newLang)
    },
    [updateLanguage, setLanguage],
  )

  const totalBet = calculateTotalBet(state.currentBets)
  const isBroke = state.wallet.balance < GAME_CONFIG.MIN_BET && totalBet === 0 && state.phase === 'betting'

  // Auto-open refill modal if balance drops below minimum bet during betting phase
  useEffect(() => {
    if (isBroke) {
      setIsRefillOpen(true)
    }
  }, [isBroke])

  // Global Keyboard Navigation & Accessibility Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isAnyModalOpen = isRulesOpen || isHistoryOpen || isRefillOpen || isShortcutsOpen

      // Allow Escape key to close open dialogs
      if (e.key === 'Escape' && isAnyModalOpen) {
        e.preventDefault()
        setIsRulesOpen(false)
        setIsHistoryOpen(false)
        setIsRefillOpen(false)
        setIsShortcutsOpen(false)
        return
      }

      // Ignore game shortcuts if modal is open or user is typing in form inputs
      if (isAnyModalOpen) return
      if (['input', 'textarea', 'select'].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) return

      // Space or R: Roll Dice (during betting) or Next Round (during settled)
      if (e.key === 'r' || e.key === 'R' || e.key === ' ') {
        if (state.phase === 'betting' && calculateTotalBet(state.currentBets) > 0) {
          e.preventDefault()
          roll()
        } else if (state.phase === 'settled') {
          e.preventDefault()
          nextRound()
        }
      }
      // C: Clear active bets
      else if (e.key === 'c' || e.key === 'C') {
        if (state.phase === 'betting') {
          e.preventDefault()
          clearBets()
        }
      }
      // D: Double active bets
      else if (e.key === 'd' || e.key === 'D') {
        if (state.phase === 'betting') {
          e.preventDefault()
          doubleBets()
        }
      }
      // B: Rebet last round
      else if (e.key === 'b' || e.key === 'B') {
        if (state.phase === 'betting') {
          e.preventDefault()
          rebetLast()
        }
      }
      // 1 - 6: Quick bet on symbols (1: Tiger, 2: Gourd, 3: Shrimp, 4: Fish, 5: Crab, 6: Rooster)
      else if (['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        if (state.phase === 'betting') {
          e.preventDefault()
          const index = parseInt(e.key, 10) - 1
          const symbol = SYMBOLS_LIST[index]
          if (symbol) {
            placeBet(symbol.id)
          }
        }
      }
      // [ and ]: Cycle previous/next chip denomination
      else if (e.key === '[') {
        if (state.phase === 'betting') {
          e.preventDefault()
          const currIdx = CHIP_VALUES.indexOf(state.selectedChip)
          const prevIdx = (currIdx - 1 + CHIP_VALUES.length) % CHIP_VALUES.length
          selectChip(CHIP_VALUES[prevIdx])
        }
      } else if (e.key === ']') {
        if (state.phase === 'betting') {
          e.preventDefault()
          const currIdx = CHIP_VALUES.indexOf(state.selectedChip)
          const nextIdx = (currIdx + 1) % CHIP_VALUES.length
          selectChip(CHIP_VALUES[nextIdx])
        }
      }
      // L: Toggle language (instant UI language switch preserving game state)
      else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        handleLanguageChange(language === 'km' ? 'en' : 'km')
      }
      // H: Toggle high contrast mode
      else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault()
        toggleHighContrast()
      }
      // ? or /: Open shortcuts modal
      else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        setIsShortcutsOpen((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    state.phase,
    state.currentBets,
    state.selectedChip,
    language,
    isRulesOpen,
    isHistoryOpen,
    isRefillOpen,
    isShortcutsOpen,
    roll,
    nextRound,
    clearBets,
    doubleBets,
    rebetLast,
    placeBet,
    selectChip,
    handleLanguageChange,
    toggleHighContrast,
  ])

  const canDouble = totalBet > 0 && state.wallet.balance >= totalBet
  const canRebet =
    !!state.lastBets &&
    calculateTotalBet(state.lastBets) > 0 &&
    state.wallet.balance >= calculateTotalBet(state.lastBets)

  return (
    <div
      className={`min-h-screen bg-stone-950 text-stone-100 flex flex-col justify-between selection:bg-amber-500 selection:text-stone-950 ${
        state.highContrast ? 'high-contrast' : ''
      }`}
      data-high-contrast={state.highContrast ? 'true' : 'false'}
    >
      {/* Screen Reader ARIA Live Region */}
      <AriaLiveRegion announcement={state.announcement} />

      {/* Main Navigation Header */}
      <Header
        language={language}
        onLanguageChange={handleLanguageChange}
        soundEnabled={state.soundEnabled}
        onToggleSound={toggleSound}
        highContrast={state.highContrast}
        onToggleHighContrast={toggleHighContrast}
        onOpenRules={() => setIsRulesOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        onResetGame={() => setIsRefillOpen(true)}
        t={t}
      />

      {/* Main Game Container */}
      <main
        className="flex-1 max-w-6xl w-full mx-auto px-4 py-4 sm:py-6 flex flex-col gap-4 sm:gap-6"
        id="main-content"
      >
        {/* Wallet Balance & Round Stats */}
        <WalletBar
          wallet={state.wallet}
          totalBet={totalBet}
          roundNumber={state.roundNumber}
          onOpenRefill={() => setIsRefillOpen(true)}
          t={t}
        />

        {/* Recent Roll History Strip */}
        <RecentRollHistory
          history={state.history}
          onOpenFullHistory={() => setIsHistoryOpen(true)}
          language={language}
          t={t}
        />

        {/* Dice Arena (Shaker cup or 3 Dice roll with multipliers) */}
        <DiceArena
          phase={state.phase}
          lastOutcome={state.lastOutcome}
          settlement={state.lastSettlement}
          language={language}
          canRoll={totalBet > 0 && state.phase === 'betting'}
          onRoll={() => roll()}
          t={t}
        />

        {/* Betting Chip Selector */}
        <ChipSelector
          selectedChip={state.selectedChip}
          onSelectChip={selectChip}
          walletBalance={state.wallet.balance}
          disabled={state.phase !== 'betting'}
          t={t}
        />

        {/* 2x3 Betting Board with 6 Traditional Khmer Symbols */}
        <BettingBoard
          currentBets={state.currentBets}
          settlement={state.lastSettlement}
          phase={state.phase}
          language={language}
          onPlaceBet={(sym) => placeBet(sym)}
          onRemoveBet={(sym) => removeBet(sym)}
          onClearBets={clearBets}
          disabled={state.phase !== 'betting'}
        />

        {/* Action Controls (Clear, Double, Rebet, Roll / Next Round) */}
        <BetControls
          phase={state.phase}
          hasBets={totalBet > 0}
          canDouble={canDouble}
          canRebet={canRebet}
          onRoll={() => roll()}
          onClear={clearBets}
          onDouble={doubleBets}
          onRebet={rebetLast}
          onNextRound={nextRound}
          t={t}
        />
      </main>

      {/* Wallet Refill / Reset Modal */}
      <RefillModal
        isOpen={isRefillOpen}
        onClose={() => setIsRefillOpen(false)}
        balance={state.wallet.balance}
        isBroke={isBroke}
        onTopUp={topUpWallet}
        onReset={() => resetGame()}
        language={language}
        t={t}
      />

      {/* Rules and Payout Modal */}
      <RulesModal
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
        t={t}
      />

      {/* Game History Modal */}
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={state.history}
        onClearHistory={clearHistory}
        language={language}
        t={t}
      />

      {/* Keyboard Shortcuts & Accessibility Help Modal */}
      <ShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
        language={language}
        t={t}
      />

      {/* Footer */}
      <footer className="w-full text-center py-4 border-t border-stone-900 text-stone-400 text-xs font-khmer">
        <p>
          {t('app.title')} ({t('app.subtitle')}) &copy; {new Date().getFullYear()} - Traditional Khmer Dice Game
        </p>
      </footer>
    </div>
  )
}
export default App
