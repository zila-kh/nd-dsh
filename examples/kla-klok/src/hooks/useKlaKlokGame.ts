import { useReducer, useEffect, useCallback, useRef } from 'react'
import type {
  GameState,
  GameAction,
  SymbolId,
  ChipValue,
  DiceTuple,
  Language,
} from '../types/index.js'
import { EMPTY_BET_MAP, GAME_CONFIG, SYMBOLS_MAP } from '../constants/index.js'
import {
  calculateTotalBet,
  validateBetPlacement,
  placeBet as addBetToMap,
  doubleBets as doubleBetsUtil,
  hasActiveBets,
} from '../core/betting.js'
import { createDiceOutcome } from '../core/dice.js'
import { calculateRoundSettlement } from '../core/payout.js'
import {
  loadWalletState,
  saveWalletState,
  loadHistory,
  saveHistory,
  loadSettings,
  saveSettings,
  DEFAULT_WALLET_STATE,
} from '../core/storage.js'

function createInitialState(): GameState {
  const savedSettings = loadSettings()
  const savedWallet = loadWalletState()
  const savedHistory = loadHistory()

  return {
    phase: 'betting',
    roundNumber: savedHistory.length + 1,
    currentBets: { ...EMPTY_BET_MAP },
    selectedChip: 10,
    lastBets: null,
    lastOutcome: null,
    lastSettlement: null,
    wallet: savedWallet,
    history: savedHistory,
    soundEnabled: savedSettings.soundEnabled,
    language: savedSettings.language,
    highContrast: savedSettings.highContrast ?? false,
    announcement: null,
  }
}

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SELECT_CHIP':
      return {
        ...state,
        selectedChip: action.chip,
      }

    case 'PLACE_BET': {
      if (state.phase !== 'betting') return state
      const validation = validateBetPlacement(
        state.currentBets,
        action.symbolId,
        action.amount,
        state.wallet.balance,
      )
      if (!validation.isValid) {
        return {
          ...state,
          announcement: {
            id: `${Date.now()}-err`,
            message: validation.errorMessage || 'Invalid bet',
            politeness: 'assertive',
          },
        }
      }

      const updatedBets = addBetToMap(state.currentBets, action.symbolId, action.amount)
      const updatedBalance = state.wallet.balance - action.amount
      const symbolInfo = SYMBOLS_MAP[action.symbolId]
      const symbolName = state.language === 'km' ? symbolInfo.khmerName : symbolInfo.englishName

      return {
        ...state,
        currentBets: updatedBets,
        wallet: {
          ...state.wallet,
          balance: updatedBalance,
        },
        announcement: {
          id: `${Date.now()}-bet`,
          message:
            state.language === 'km'
              ? `បានដាក់ប្រាក់ $${action.amount} លើ ${symbolName}។ សរុបលើ ${symbolName} គឺ $${updatedBets[action.symbolId]}។`
              : `Placed $${action.amount} on ${symbolName}. Total on ${symbolName}: $${updatedBets[action.symbolId]}.`,
          politeness: 'polite',
        },
      }
    }

    case 'REMOVE_BET': {
      if (state.phase !== 'betting') return state
      const currentAmt = state.currentBets[action.symbolId] || 0
      if (currentAmt <= 0) return state

      const removeAmt = action.amount === undefined ? currentAmt : Math.min(action.amount, currentAmt)
      const updatedBets = {
        ...state.currentBets,
        [action.symbolId]: currentAmt - removeAmt,
      }

      const symbolInfo = SYMBOLS_MAP[action.symbolId]
      const symbolName = state.language === 'km' ? symbolInfo.khmerName : symbolInfo.englishName

      return {
        ...state,
        currentBets: updatedBets,
        wallet: {
          ...state.wallet,
          balance: state.wallet.balance + removeAmt,
        },
        announcement: {
          id: `${Date.now()}-remove-bet`,
          message:
            state.language === 'km'
              ? `បានដកប្រាក់ភ្នាល់ចេញពី ${symbolName}។ ប្រាក់ភ្នាល់សរុបលើ ${symbolName} គឺ $${updatedBets[action.symbolId]}។`
              : `Removed bet from ${symbolName}. Total on ${symbolName}: $${updatedBets[action.symbolId]}.`,
          politeness: 'polite',
        },
      }
    }

    case 'CLEAR_BETS': {
      if (state.phase !== 'betting') return state
      const totalRefund = calculateTotalBet(state.currentBets)
      if (totalRefund === 0) return state

      const newBalance = state.wallet.balance + totalRefund

      return {
        ...state,
        currentBets: { ...EMPTY_BET_MAP },
        wallet: {
          ...state.wallet,
          balance: newBalance,
        },
        announcement: {
          id: `${Date.now()}-clear`,
          message:
            state.language === 'km'
              ? `បានលុបការភ្នាល់ទាំងអស់។ សមតុល្យបច្ចុប្បន្ន៖ $${newBalance.toLocaleString()}។`
              : `Cleared all bets. Balance restored to $${newBalance.toLocaleString()}.`,
          politeness: 'polite',
        },
      }
    }

    case 'DOUBLE_BETS': {
      if (state.phase !== 'betting') return state
      const result = doubleBetsUtil(state.currentBets, state.wallet.balance)
      if (!result) return state

      const newTotal = calculateTotalBet(result.newBets)

      return {
        ...state,
        currentBets: result.newBets,
        wallet: {
          ...state.wallet,
          balance: state.wallet.balance - result.totalCost,
        },
        announcement: {
          id: `${Date.now()}-double`,
          message:
            state.language === 'km'
              ? `បានគុណប្រាក់ភ្នាល់ទាំងអស់នឹងពីរ (2x)។ ប្រាក់ភ្នាល់សរុបថ្មី៖ $${newTotal.toLocaleString()}។`
              : `Doubled all active bets. New total bet: $${newTotal.toLocaleString()}.`,
          politeness: 'polite',
        },
      }
    }

    case 'REBET_LAST': {
      if (state.phase !== 'betting' || !state.lastBets) return state
      const requiredAmount = calculateTotalBet(state.lastBets)
      if (requiredAmount === 0 || state.wallet.balance < requiredAmount) {
        return {
          ...state,
          announcement: {
            id: `${Date.now()}-rebet-err`,
            message:
              state.language === 'km'
                ? `សមតុល្យមិនគ្រប់គ្រាន់ដើម្បីភ្នាល់ដូចមុន ($${requiredAmount.toLocaleString()}) ទេ។`
                : `Insufficient balance to rebet last round ($${requiredAmount.toLocaleString()}).`,
            politeness: 'assertive',
          },
        }
      }

      // First return any currently placed bets
      const currentActive = calculateTotalBet(state.currentBets)
      const adjustedBalance = state.wallet.balance + currentActive - requiredAmount

      return {
        ...state,
        currentBets: { ...state.lastBets },
        wallet: {
          ...state.wallet,
          balance: adjustedBalance,
        },
        announcement: {
          id: `${Date.now()}-rebet`,
          message:
            state.language === 'km'
              ? `បានដាក់ប្រាក់ភ្នាល់ដូចជុំមុន (សរុប $${requiredAmount.toLocaleString()})។`
              : `Replaced bets with previous round wager ($${requiredAmount.toLocaleString()}).`,
          politeness: 'polite',
        },
      }
    }

    case 'START_ROLL': {
      if (state.phase !== 'betting' || !hasActiveBets(state.currentBets)) return state
      return {
        ...state,
        phase: 'rolling',
        announcement: {
          id: `${Date.now()}-rolling`,
          message:
            state.language === 'km'
              ? 'គ្រាប់ឡុកឡាក់កំពុងត្រូវបានក្រឡុកក្នុងគម្រប... ៣, ២, ១!'
              : 'Dice are rolling in the shaker cup... Shaking 3, 2, 1!',
          politeness: 'polite',
        },
      }
    }

    case 'REVEAL_DICE': {
      const dNames = action.outcome.dice.map((d) =>
        state.language === 'km' ? SYMBOLS_MAP[d].khmerName : SYMBOLS_MAP[d].englishName,
      )
      return {
        ...state,
        phase: 'revealing',
        lastOutcome: action.outcome,
        announcement: {
          id: `${Date.now()}-reveal`,
          message:
            state.language === 'km'
              ? `លទ្ធផលគ្រាប់ឡុកឡាក់៖ គ្រាប់ទី១ គឺ ${dNames[0]}, គ្រាប់ទី២ គឺ ${dNames[1]}, គ្រាប់ទី៣ គឺ ${dNames[2]}។`
              : `Dice roll result: Die 1 is ${dNames[0]}, Die 2 is ${dNames[1]}, Die 3 is ${dNames[2]}.`,
          politeness: 'polite',
        },
      }
    }

    case 'SETTLE_ROUND': {
      if (!state.lastOutcome) return state

      const settlement = calculateRoundSettlement(
        state.roundNumber,
        state.currentBets,
        state.lastOutcome.dice,
      )

      const totalStake = settlement.totalStake
      const totalReturn = settlement.totalReturn
      const netProfit = settlement.netProfit

      const newBalance = state.wallet.balance + totalReturn
      const newTotalWagered = state.wallet.totalWagered + totalStake
      const newTotalWon = state.wallet.totalWon + (netProfit > 0 ? netProfit : 0)
      const newTotalLost = state.wallet.totalLost + (netProfit < 0 ? Math.abs(netProfit) : 0)
      const newNetEarnings = state.wallet.netEarnings + netProfit

      const updatedWallet = {
        ...state.wallet,
        balance: newBalance,
        totalWagered: newTotalWagered,
        totalWon: newTotalWon,
        totalLost: newTotalLost,
        netEarnings: newNetEarnings,
      }

      const updatedHistory = [settlement, ...state.history].slice(
        0,
        GAME_CONFIG.MAX_HISTORY_ENTRIES,
      )

      const dNames = settlement.dice.map((d) =>
        state.language === 'km' ? SYMBOLS_MAP[d].khmerName : SYMBOLS_MAP[d].englishName,
      )

      let announcementText = ''
      if (settlement.totalReturn > 0) {
        announcementText =
          state.language === 'km'
            ? `លទ្ធផល៖ ${dNames.join(', ')}។ សូមអបអរសាទរ! អ្នកបានឈ្នះ $${settlement.totalReturn.toLocaleString()} (ចំណេញសុទ្ធ $${settlement.netProfit.toLocaleString()})។ សមតុល្យថ្មី៖ $${newBalance.toLocaleString()}។`
            : `Outcome: ${dNames.join(', ')}. Congratulations! You won $${settlement.totalReturn.toLocaleString()} with a net profit of $${settlement.netProfit.toLocaleString()}. Your new balance is $${newBalance.toLocaleString()}.`
      } else {
        announcementText =
          state.language === 'km'
            ? `លទ្ធផល៖ ${dNames.join(', ')}។ គ្មានការភ្នាល់ណាដែលត្រូវទេក្នុងជុំនេះ។ អ្នកបានបាត់បង់ $${settlement.totalStake.toLocaleString()}។ សមតុល្យថ្មីរបស់អ្នកគឺ $${newBalance.toLocaleString()}។`
            : `Outcome: ${dNames.join(', ')}. No winning bets this round. You lost $${settlement.totalStake.toLocaleString()}. Your new balance is $${newBalance.toLocaleString()}.`
      }

      return {
        ...state,
        phase: 'settled',
        lastBets: { ...state.currentBets },
        lastSettlement: settlement,
        wallet: updatedWallet,
        history: updatedHistory,
        announcement: {
          id: `${Date.now()}-settled`,
          message: announcementText,
          politeness: 'polite',
        },
      }
    }

    case 'NEXT_ROUND': {
      return {
        ...state,
        phase: 'betting',
        roundNumber: state.roundNumber + 1,
        currentBets: { ...EMPTY_BET_MAP },
        announcement: {
          id: `${Date.now()}-new-round`,
          message:
            state.language === 'km'
              ? `ចាប់ផ្តើមជុំទី #${state.roundNumber + 1}។ សូមដាក់ប្រាក់ភ្នាល់របស់អ្នក។`
              : `Round #${state.roundNumber + 1} started. Please place your bets.`,
          politeness: 'polite',
        },
      }
    }

    case 'RESET_GAME': {
      const balance = action.initialBalance ?? GAME_CONFIG.INITIAL_WALLET_BALANCE
      const resetWallet = {
        ...DEFAULT_WALLET_STATE,
        balance,
        startingBalance: balance,
      }
      return {
        ...state,
        phase: 'betting',
        roundNumber: 1,
        currentBets: { ...EMPTY_BET_MAP },
        lastBets: null,
        lastOutcome: null,
        lastSettlement: null,
        wallet: resetWallet,
        history: [],
        announcement: {
          id: `${Date.now()}-reset`,
          message:
            state.language === 'km'
              ? `ល្បែងត្រូវបានកំណត់ឡើងវិញ។ សមតុល្យដើម៖ $${balance.toLocaleString()}។`
              : `Game reset. Initial balance: $${balance.toLocaleString()}.`,
          politeness: 'polite',
        },
      }
    }

    case 'TOP_UP_WALLET': {
      const topUpAmount = Math.max(0, action.amount)
      const updatedBalance = state.wallet.balance + topUpAmount
      const updatedWallet = {
        ...state.wallet,
        balance: updatedBalance,
      }
      return {
        ...state,
        wallet: updatedWallet,
        announcement: {
          id: `${Date.now()}-topup`,
          message:
            state.language === 'km'
              ? `បានបញ្ចូលប្រាក់បន្ថែម $${topUpAmount.toLocaleString()}។ សមតុល្យថ្មី៖ $${updatedBalance.toLocaleString()}។`
              : `Added $${topUpAmount.toLocaleString()} to wallet. New balance: $${updatedBalance.toLocaleString()}.`,
          politeness: 'polite',
        },
      }
    }

    case 'TOGGLE_SOUND': {
      const nextSound = !state.soundEnabled
      saveSettings({ soundEnabled: nextSound, language: state.language, highContrast: state.highContrast })
      return {
        ...state,
        soundEnabled: nextSound,
      }
    }

    case 'SET_LANGUAGE': {
      saveSettings({ soundEnabled: state.soundEnabled, language: action.language, highContrast: state.highContrast })
      return {
        ...state,
        language: action.language,
        announcement: {
          id: `${Date.now()}-lang`,
          message:
            action.language === 'km'
              ? 'បានប្តូរភាសាទៅជាភាសាខ្មែរ។'
              : 'Language switched to English.',
          politeness: 'polite',
        },
      }
    }

    case 'TOGGLE_HIGH_CONTRAST': {
      const nextContrast = !state.highContrast
      saveSettings({ soundEnabled: state.soundEnabled, language: state.language, highContrast: nextContrast })
      return {
        ...state,
        highContrast: nextContrast,
        announcement: {
          id: `${Date.now()}-contrast`,
          message: nextContrast
            ? state.language === 'km'
              ? 'បានបើកកម្រិតពណ៌ច្បាស់ខ្ពស់។'
              : 'High contrast mode enabled.'
            : state.language === 'km'
              ? 'បានបិទកម្រិតពណ៌ច្បាស់ខ្ពស់។'
              : 'High contrast mode disabled.',
          politeness: 'polite',
        },
      }
    }

    case 'SET_HIGH_CONTRAST': {
      saveSettings({ soundEnabled: state.soundEnabled, language: state.language, highContrast: action.enabled })
      return {
        ...state,
        highContrast: action.enabled,
        announcement: {
          id: `${Date.now()}-contrast`,
          message: action.enabled
            ? state.language === 'km'
              ? 'បានបើកកម្រិតពណ៌ច្បាស់ខ្ពស់។'
              : 'High contrast mode enabled.'
            : state.language === 'km'
              ? 'បានបិទកម្រិតពណ៌ច្បាស់ខ្ពស់។'
              : 'High contrast mode disabled.',
          politeness: 'polite',
        },
      }
    }

    case 'SET_ANNOUNCEMENT': {
      return {
        ...state,
        announcement: {
          id: `${Date.now()}`,
          message: action.message,
          politeness: action.politeness || 'polite',
        },
      }
    }

    case 'CLEAR_HISTORY': {
      saveHistory([])
      return {
        ...state,
        history: [],
      }
    }

    default:
      return state
  }
}

export function useKlaKlokGame() {
  const [state, dispatch] = useReducer(gameReducer, undefined, createInitialState)
  const rollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync wallet state to localStorage on changes
  useEffect(() => {
    saveWalletState(state.wallet)
  }, [state.wallet])

  // Sync history to localStorage on changes
  useEffect(() => {
    saveHistory(state.history)
  }, [state.history])

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      if (rollTimeoutRef.current) clearTimeout(rollTimeoutRef.current)
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current)
    }
  }, [])

  const selectChip = useCallback((chip: ChipValue) => {
    dispatch({ type: 'SELECT_CHIP', chip })
  }, [])

  const placeBet = useCallback(
    (symbolId: SymbolId, amount?: number) => {
      const betAmount = amount ?? state.selectedChip
      dispatch({ type: 'PLACE_BET', symbolId, amount: betAmount })
    },
    [state.selectedChip],
  )

  const removeBet = useCallback((symbolId: SymbolId, amount?: number) => {
    dispatch({ type: 'REMOVE_BET', symbolId, amount })
  }, [])

  const clearBets = useCallback(() => {
    dispatch({ type: 'CLEAR_BETS' })
  }, [])

  const doubleBets = useCallback(() => {
    dispatch({ type: 'DOUBLE_BETS' })
  }, [])

  const rebetLast = useCallback(() => {
    dispatch({ type: 'REBET_LAST' })
  }, [])

  const nextRound = useCallback(() => {
    dispatch({ type: 'NEXT_ROUND' })
  }, [])

  const roll = useCallback(
    (predeterminedDice?: DiceTuple) => {
      if (state.phase !== 'betting' || !hasActiveBets(state.currentBets)) return

      dispatch({ type: 'START_ROLL' })

      const outcome = createDiceOutcome(predeterminedDice)

      rollTimeoutRef.current = setTimeout(() => {
        dispatch({ type: 'REVEAL_DICE', outcome })

        revealTimeoutRef.current = setTimeout(() => {
          dispatch({ type: 'SETTLE_ROUND' })
        }, GAME_CONFIG.REVEAL_ANIMATION_DURATION_MS)
      }, GAME_CONFIG.ROLL_ANIMATION_DURATION_MS)
    },
    [state.phase, state.currentBets],
  )

  const resetGame = useCallback((initialBalance?: number) => {
    dispatch({ type: 'RESET_GAME', initialBalance })
  }, [])

  const topUpWallet = useCallback((amount: number) => {
    dispatch({ type: 'TOP_UP_WALLET', amount })
  }, [])

  const toggleSound = useCallback(() => {
    dispatch({ type: 'TOGGLE_SOUND' })
  }, [])

  const setLanguage = useCallback((language: Language) => {
    dispatch({ type: 'SET_LANGUAGE', language })
  }, [])

  const toggleHighContrast = useCallback(() => {
    dispatch({ type: 'TOGGLE_HIGH_CONTRAST' })
  }, [])

  const setHighContrast = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_HIGH_CONTRAST', enabled })
  }, [])

  const clearHistory = useCallback(() => {
    dispatch({ type: 'CLEAR_HISTORY' })
  }, [])

  return {
    state,
    dispatch,
    totalBet: calculateTotalBet(state.currentBets),
    hasBets: hasActiveBets(state.currentBets),
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
    setHighContrast,
    clearHistory,
  }
}
