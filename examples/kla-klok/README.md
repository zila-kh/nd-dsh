# Kla-Klok (ខ្លាឃ្លោក) - Khmer Traditional Dice Game

A modern, highly accessible, web-based implementation of Cambodia's classic festival dice game **Kla-Klok (ខ្លាឃ្លោក)** built with **React 19**, **TypeScript**, and **Tailwind CSS**.

## Project Architecture & Structure

```
kla-klok/
├── docs/                                # Specification & research documentation
│   └── kla-klok-rules-and-terminology.md # Game rules, payout formulas & bilingual glossary
├── public/
│   └── favicon.svg                      # Custom Tiger/Kla vector icon favicon
├── src/
│   ├── assets/                          # Dedicated SVG icons & traditional art
│   │   └── icons/                       # 6 traditional symbols (Tiger, Gourd, Shrimp, Fish, Crab, Rooster), Chips, Kbach
│   ├── components/                      # Modular UI components
│   │   ├── board/                       # 2x3 BettingBoard, SymbolTile, ChipSelector, BetControls
│   │   ├── dice/                        # 3D DiceArena, Die3D, ShakerCup
│   │   ├── wallet/                      # WalletBar, balance and net stats
│   │   ├── common/                      # Header, AriaLiveRegion
│   │   ├── rules/                       # Rules & Paytable Modal
│   │   └── history/                     # Round History Modal
│   ├── constants/                       # Symbol configs, chips, i18n dictionaries (Khmer & English)
│   ├── core/                            # Pure functional core game engine
│   │   ├── payout.ts                    # Exact 1:1, 2:1, 3:1 payouts & stake refund calculations
│   │   ├── dice.ts                      # Random uniform 3-dice simulation
│   │   ├── betting.ts                   # Bet validation, doubling, bounds checking
│   │   └── storage.ts                   # LocalStorage wallet and history persistence
│   ├── hooks/                           # React state management hooks
│   │   ├── useKlaKlokGame.ts            # Core game state reducer and round flow
│   │   ├── useLanguage.ts               # Bilingual (Khmer / English) localization hook
│   │   └── useAriaAnnouncer.ts          # WCAG 2.1 AA screen reader live region announcements
│   ├── types/                           # TypeScript interfaces & types
│   │   ├── symbol.ts                    # SymbolId, SymbolInfo, ColorPalette
│   │   ├── bet.ts                       # Bet, BetMap, Validation
│   │   ├── dice.ts                      # DiceTuple, DiceOutcome, RoundSettlement
│   │   ├── wallet.ts                    # WalletState, ChipConfig
│   │   ├── game.ts                      # GameState, GameAction, GamePhase
│   │   └── i18n.ts                      # Localization keys & dictionaries
│   ├── App.tsx                          # Root application component
│   ├── main.tsx                         # DOM mounting entry
│   └── index.css                        # Styling and typography imports
├── tests/                               # Comprehensive test suite
│   ├── core/                            # Payout, betting, dice, storage tests
│   ├── models/                          # State contract & typing verification
│   ├── hooks/                           # Reducer & game lifecycle tests
│   └── run-tests.mjs                    # End-to-end automated Node test runner
├── index.html                           # HTML template with Khmer Unicode fonts
├── package.json                         # Project dependencies and test scripts
├── tsconfig.json                        # TypeScript strict compiler config
└── vite.config.ts                       # Vite bundler configuration
```

## Game Rules & Payout Standards

- **Tiger (ខ្លា)**
- **Gourd (ឃ្លោក)**
- **Shrimp (បង្កង)**
- **Fish (ត្រី)**
- **Crab (ក្តាម)**
- **Rooster (មាន់)**

### Payout Multipliers:
- **0 Matches**: Stake forfeited (Loss)
- **1 Match**: 1:1 payout + original stake returned ($2\times$)
- **2 Matches**: 2:1 payout + original stake returned ($3\times$)
- **3 Matches**: 3:1 payout + original stake returned ($4\times$)

## Verification & Testing

Run all automated checks and tests:
```bash
# Typecheck
pnpm typecheck

# Automated Test Suite
pnpm test
```
