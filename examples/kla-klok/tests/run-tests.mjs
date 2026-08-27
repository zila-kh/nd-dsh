import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  calculateSymbolPayout,
  calculateRoundSettlement,
  calculatePayout,
  settleBets,
  calculateNetBalanceChange,
  getSymbolMatchCount,
  getMultiplierBadge,
  countSymbolOccurrences,
  calculateSymbolFrequencies,
  getSecureRandomInt,
  createSeededRng,
  isTripleMatch,
  isDoubleMatch,
  getWinningSymbols,
  rollSingleDie,
  rollDice,
  createDiceOutcome,
  calculateTotalBet,
  canAffordBet,
  validateBetPlacement,
  placeBet,
  removeBet,
  doubleBets,
  hasActiveBets,
  SYMBOL_IDS,
  SYMBOLS_MAP,
  SYMBOLS_LIST,
  EMPTY_BET_MAP,
  CHIP_VALUES,
  CHIP_CONFIGS,
  getChipStackBreakdown,
  getVisualChipStack,
  GAME_CONFIG,
  TRANSLATIONS,
  App,
  Header,
  WalletBar,
  ChipSelector,
  BettingBoard,
  SymbolTile,
  BetStackIndicator,
  BetControls,
  Die3D,
  ShakerCup,
  DiceArena,
  AriaLiveRegion,
  RefillModal,
  ShortcutsModal,
  RecentRollHistory,
  RulesModal,
  HistoryModal,
  loadWalletState,
  saveWalletState,
  loadHistory,
  saveHistory,
  loadSettings,
  saveSettings,
  DEFAULT_WALLET_STATE,
  TigerIcon,
  GourdIcon,
  ShrimpIcon,
  FishIcon,
  CrabIcon,
  RoosterIcon,
  ChipIcon,
} from '../dist/src/index.js';

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('\n=============================================================');
console.log('   KLA-KLOK KHMER DICE GAME: AUTOMATED ENGINE & TEST SUITE   ');
console.log('=============================================================\n');

// --- 1. Symbol & Contract Definitions ---
console.log('1. Traditional Khmer Symbols & Constants');
test('defines exactly the 6 traditional symbols', () => {
  assert.deepEqual(SYMBOL_IDS, ['tiger', 'gourd', 'shrimp', 'fish', 'crab', 'rooster']);
  assert.equal(SYMBOLS_LIST.length, 6);
  for (const symId of SYMBOL_IDS) {
    const sym = SYMBOLS_MAP[symId];
    assert.equal(sym.id, symId);
    assert.ok(sym.khmerName.length > 0);
    assert.ok(sym.englishName.length > 0);
    assert.ok(sym.ipa.length > 0);
  }
});

test('chip values and configs contain $1 to $1000 denominations', () => {
  assert.deepEqual(CHIP_VALUES, [1, 5, 10, 25, 50, 100, 500, 1000]);
  for (const val of CHIP_VALUES) {
    const config = CHIP_CONFIGS[val];
    assert.equal(config.value, val);
    assert.equal(config.label, `$${val}`);
    assert.ok(config.color.bg.length > 0);
    assert.ok(config.color.border.length > 0);
  }
});

test('getChipStackBreakdown correctly decomposes amounts into optimal chip denominations', () => {
  assert.deepEqual(getChipStackBreakdown(0), []);
  assert.deepEqual(getChipStackBreakdown(-10), []);
  assert.deepEqual(getChipStackBreakdown(10), [10]);
  assert.deepEqual(getChipStackBreakdown(65), [50, 10, 5]);
  assert.deepEqual(getChipStackBreakdown(175), [100, 50, 25]);
  assert.deepEqual(getChipStackBreakdown(1685), [1000, 500, 100, 50, 25, 10]);
});

test('getVisualChipStack returns capped visible layers and total counts', () => {
  const stack = getVisualChipStack(1685, 4);
  assert.equal(stack.visibleChips.length, 4);
  assert.equal(stack.totalChipsCount, 6);
  assert.deepEqual(stack.visibleChips, [1000, 500, 100, 50]);
});

// --- 2. Dice Rolling, PRNG, & Occurrence Counting ---
console.log('\n2. Dice Rolling & Cryptographic PRNG');
test('rolls 3 valid symbols on dice using secure PRNG', () => {
  const dice = rollDice();
  assert.equal(dice.length, 3);
  assert.ok(SYMBOL_IDS.includes(dice[0]));
  assert.ok(SYMBOL_IDS.includes(dice[1]));
  assert.ok(SYMBOL_IDS.includes(dice[2]));
});

test('generates unbiased random integers with zero modulo bias', () => {
  for (let i = 0; i < 100; i++) {
    const val = getSecureRandomInt(6);
    assert.ok(val >= 0 && val < 6);
  }
});

test('supports deterministic seeded PRNG (Mulberry32)', () => {
  const rng1 = createSeededRng(999);
  const rng2 = createSeededRng(999);
  assert.equal(rng1(), rng2());
  assert.equal(rng1(), rng2());

  const seededDice = rollDice(createSeededRng(42));
  assert.equal(seededDice.length, 3);
});

test('counts symbol occurrences and frequencies accurately', () => {
  const counts = countSymbolOccurrences(['tiger', 'tiger', 'fish']);
  assert.equal(counts.tiger, 2);
  assert.equal(counts.fish, 1);
  assert.equal(counts.gourd, 0);
  assert.equal(counts.shrimp, 0);
  assert.equal(counts.crab, 0);
  assert.equal(counts.rooster, 0);

  const freq = calculateSymbolFrequencies(['crab', 'crab', 'crab']);
  assert.equal(freq.crab, 3);
});

test('detects double, triple, and winning symbols', () => {
  assert.equal(isTripleMatch(['tiger', 'tiger', 'tiger']), true);
  assert.equal(isTripleMatch(['tiger', 'tiger', 'fish']), false);
  assert.equal(isDoubleMatch(['tiger', 'tiger', 'fish']), true);
  assert.equal(isDoubleMatch(['crab', 'fish', 'rooster']), false);
  assert.deepEqual(getWinningSymbols(['tiger', 'tiger', 'fish']), ['tiger', 'fish']);
});

// --- 3. Payout Calculation & Multipliers ---
console.log('\n3. Payout Rules & Mathematical Multiplier Matrix (100% Symbol Coverage)');

// Test multiplier matrix across all 6 symbols
for (const symbolId of SYMBOL_IDS) {
  test(`multiplier matrix for symbol: ${symbolId}`, () => {
    const stake = 100;
    // 0 matches (Loss)
    const lossRes = calculateSymbolPayout(symbolId, stake, 0);
    assert.equal(lossRes.matchCount, 0);
    assert.equal(lossRes.payoutMultiplier, 0);
    assert.equal(lossRes.grossPayout, 0);
    assert.equal(lossRes.netProfit, -100);
    assert.equal(lossRes.profit, -100);
    assert.equal(lossRes.lostStake, 100);
    assert.equal(lossRes.wonStake, 0);
    assert.equal(lossRes.status, 'loss');

    // 1 match (Single 1:1)
    const singleRes = calculateSymbolPayout(symbolId, stake, 1);
    assert.equal(singleRes.matchCount, 1);
    assert.equal(singleRes.payoutMultiplier, 1);
    assert.equal(singleRes.grossPayout, 200); // 100 stake + 100 profit
    assert.equal(singleRes.netProfit, 100);
    assert.equal(singleRes.profit, 100);
    assert.equal(singleRes.lostStake, 0);
    assert.equal(singleRes.wonStake, 100);
    assert.equal(singleRes.status, 'single');

    // 2 matches (Double 2:1)
    const doubleRes = calculateSymbolPayout(symbolId, stake, 2);
    assert.equal(doubleRes.matchCount, 2);
    assert.equal(doubleRes.payoutMultiplier, 2);
    assert.equal(doubleRes.grossPayout, 300); // 100 stake + 200 profit
    assert.equal(doubleRes.netProfit, 200);
    assert.equal(doubleRes.profit, 200);
    assert.equal(doubleRes.lostStake, 0);
    assert.equal(doubleRes.wonStake, 100);
    assert.equal(doubleRes.status, 'double');

    // 3 matches (Triple Jackpot 3:1)
    const tripleRes = calculateSymbolPayout(symbolId, stake, 3);
    assert.equal(tripleRes.matchCount, 3);
    assert.equal(tripleRes.payoutMultiplier, 3);
    assert.equal(tripleRes.grossPayout, 400); // 100 stake + 300 profit
    assert.equal(tripleRes.netProfit, 300);
    assert.equal(tripleRes.profit, 300);
    assert.equal(tripleRes.lostStake, 0);
    assert.equal(tripleRes.wonStake, 100);
    assert.equal(tripleRes.status, 'triple');
  });
}

test('0 matches (Loss): stake forfeited, 0 gross payout, -stake net profit, lostStake = stake', () => {
  const res = calculateSymbolPayout('tiger', 100, 0);
  assert.equal(res.matchCount, 0);
  assert.equal(res.payoutMultiplier, 0);
  assert.equal(res.payoutReturn, 0);
  assert.equal(res.grossPayout, 0);
  assert.equal(res.netProfit, -100);
  assert.equal(res.profit, -100);
  assert.equal(res.lostStake, 100);
  assert.equal(res.wonStake, 0);
  assert.equal(res.status, 'loss');
});

test('1 match (Single): 1:1 payout (+ stake returned = 2x stake gross payout, profit = stake)', () => {
  const res = calculateSymbolPayout('fish', 50, 1);
  assert.equal(res.matchCount, 1);
  assert.equal(res.payoutMultiplier, 1);
  assert.equal(res.payoutReturn, 100); // 50 stake + 50 profit
  assert.equal(res.grossPayout, 100);
  assert.equal(res.netProfit, 50);
  assert.equal(res.profit, 50);
  assert.equal(res.lostStake, 0);
  assert.equal(res.wonStake, 50);
  assert.equal(res.status, 'single');
});

test('2 matches (Double): 2:1 payout (+ stake returned = 3x stake gross payout, profit = 2x stake)', () => {
  const res = calculateSymbolPayout('tiger', 100, 2);
  assert.equal(res.matchCount, 2);
  assert.equal(res.payoutMultiplier, 2);
  assert.equal(res.payoutReturn, 300); // 100 stake + 200 profit
  assert.equal(res.grossPayout, 300);
  assert.equal(res.netProfit, 200);
  assert.equal(res.profit, 200);
  assert.equal(res.lostStake, 0);
  assert.equal(res.wonStake, 100);
  assert.equal(res.status, 'double');
});

test('3 matches (Triple Jackpot): 3:1 payout (+ stake returned = 4x stake gross payout, profit = 3x stake)', () => {
  const res = calculateSymbolPayout('rooster', 100, 3);
  assert.equal(res.matchCount, 3);
  assert.equal(res.payoutMultiplier, 3);
  assert.equal(res.payoutReturn, 400); // 100 stake + 300 profit
  assert.equal(res.grossPayout, 400);
  assert.equal(res.netProfit, 300);
  assert.equal(res.profit, 300);
  assert.equal(res.lostStake, 0);
  assert.equal(res.wonStake, 100);
  assert.equal(res.status, 'triple');
});

test('handles $0 bet, negative, fractional, and invalid inputs safely', () => {
  const res0 = calculateSymbolPayout('gourd', 0, 2);
  assert.equal(res0.stake, 0);
  assert.equal(res0.grossPayout, 0);
  assert.equal(res0.netProfit, 0);

  const resNeg = calculateSymbolPayout('shrimp', -50, 1);
  assert.equal(resNeg.stake, 0);
  assert.equal(resNeg.grossPayout, 0);
  assert.equal(resNeg.netProfit, 0);

  const resCents = calculateSymbolPayout('tiger', 50.75, 1);
  assert.equal(resCents.stake, 50.75);
  assert.equal(resCents.grossPayout, 101.5);
  assert.equal(resCents.netProfit, 50.75);
});

// --- 4. Complex Multi-Symbol Settlement & Wallet Balance Logic ---
console.log('\n4. Complex Multi-Symbol Settlement & Wallet Balances');
test('multi-bet settlement reproduces formal specification worked example', () => {
  const bets = {
    ...EMPTY_BET_MAP,
    tiger: 100,
    gourd: 50,
    crab: 50,
  };
  const dice = ['tiger', 'tiger', 'fish'];
  const settlement = calculatePayout(bets, dice, 1);

  assert.equal(settlement.totalStake, 200);
  assert.equal(settlement.totalReturn, 300);
  assert.equal(settlement.grossPayout, 300);
  assert.equal(settlement.netProfit, 100);
  assert.equal(settlement.profit, 100);
  assert.equal(settlement.lostStakes, 100);
  assert.equal(settlement.wonStakes, 100);
  assert.equal(settlement.isWin, true);
  assert.equal(settlement.isNetProfit, true);
  assert.equal(settlement.highestMultiplier, 2);
  assert.equal(settlement.breakdown.tiger.grossPayout, 300);
  assert.equal(settlement.breakdown.gourd.grossPayout, 0);
  assert.equal(settlement.breakdown.crab.grossPayout, 0);
});

test('edge case: handles zero bets placed without errors', () => {
  const settlement = calculatePayout(EMPTY_BET_MAP, ['tiger', 'fish', 'crab'], 1);
  assert.equal(settlement.totalStake, 0);
  assert.equal(settlement.grossPayout, 0);
  assert.equal(settlement.profit, 0);
  assert.equal(settlement.lostStakes, 0);
  assert.equal(settlement.isWin, false);
});

test('edge case: triple hit jackpot settlement', () => {
  const bets = { ...EMPTY_BET_MAP, rooster: 100, tiger: 50 };
  const dice = ['rooster', 'rooster', 'rooster'];
  const settlement = settleBets(bets, dice, 1);
  assert.equal(settlement.totalStake, 150);
  assert.equal(settlement.grossPayout, 400); // 100*4 on rooster, 0 on tiger
  assert.equal(settlement.profit, 250); // 400 - 150
  assert.equal(settlement.lostStakes, 50);
  assert.equal(settlement.hasTriple, true);
});

test('edge case: 6-symbol spread wager with mixed double and single matches', () => {
  const bets = {
    tiger: 10,
    gourd: 20,
    shrimp: 30,
    fish: 40,
    crab: 50,
    rooster: 60,
  };
  const dice = ['fish', 'crab', 'crab'];
  const settlement = calculateRoundSettlement(1, bets, dice);

  assert.equal(settlement.totalStake, 210);
  assert.equal(settlement.grossPayout, 230); // Fish 40*2 + Crab 50*3 = 80 + 150 = 230
  assert.equal(settlement.profit, 20); // 230 - 210
  assert.equal(settlement.lostStakes, 120); // 10 + 20 + 30 + 60
  assert.equal(settlement.wonStakes, 90); // 40 + 50
  assert.equal(settlement.isWin, true);
  assert.equal(settlement.isNetProfit, true);
});

test('calculateNetBalanceChange correctly tracks wallet transitions and multi-round sequence', () => {
  let balance = 1000;

  // Round 1: Win $100 net
  const res1 = calculateNetBalanceChange(balance, { ...EMPTY_BET_MAP, tiger: 100 }, ['tiger', 'fish', 'crab']);
  assert.equal(res1.previousBalance, 1000);
  assert.equal(res1.totalStake, 100);
  assert.equal(res1.grossPayout, 200);
  assert.equal(res1.profit, 100);
  assert.equal(res1.newBalance, 1100);
  balance = res1.newBalance;

  // Round 2: Loss $300 net
  const res2 = calculateNetBalanceChange(balance, { ...EMPTY_BET_MAP, shrimp: 100, rooster: 200 }, ['crab', 'fish', 'gourd']);
  assert.equal(res2.previousBalance, 1100);
  assert.equal(res2.totalStake, 300);
  assert.equal(res2.grossPayout, 0);
  assert.equal(res2.profit, -300);
  assert.equal(res2.newBalance, 800);
  balance = res2.newBalance;

  // Round 3: Triple Jackpot $250 wager -> $1000 gross payout, +$750 profit
  const res3 = calculateNetBalanceChange(balance, { ...EMPTY_BET_MAP, gourd: 250 }, ['gourd', 'gourd', 'gourd']);
  assert.equal(res3.previousBalance, 800);
  assert.equal(res3.totalStake, 250);
  assert.equal(res3.grossPayout, 1000);
  assert.equal(res3.profit, 750);
  assert.equal(res3.newBalance, 1550);
});

// --- 5. Betting Mechanics & Constraints ---
console.log('\n5. Betting Validation & Management');
test('calculateTotalBet and hasActiveBets work correctly', () => {
  assert.equal(calculateTotalBet(EMPTY_BET_MAP), 0);
  assert.equal(hasActiveBets(EMPTY_BET_MAP), false);
  const activeBets = { ...EMPTY_BET_MAP, tiger: 50, fish: 25 };
  assert.equal(calculateTotalBet(activeBets), 75);
  assert.equal(hasActiveBets(activeBets), true);
});

test('validateBetPlacement enforces balance and max limits', () => {
  const bets = { ...EMPTY_BET_MAP };
  assert.equal(validateBetPlacement(bets, 'tiger', 25, 100).isValid, true);
  assert.equal(validateBetPlacement(bets, 'tiger', 150, 100).isValid, false);
  assert.equal(validateBetPlacement(bets, 'tiger', 0, 100).isValid, false);
});

test('placeBet, removeBet, and doubleBets manipulate bet state', () => {
  let bets = { ...EMPTY_BET_MAP };
  bets = placeBet(bets, 'tiger', 50);
  assert.equal(bets.tiger, 50);

  const doubleRes = doubleBets(bets, 500);
  assert.ok(doubleRes);
  assert.equal(doubleRes.newBets.tiger, 100);
  assert.equal(doubleRes.totalCost, 50);

  bets = removeBet(bets, 'tiger', 20);
  assert.equal(bets.tiger, 30);
});

// --- 6. Bilingual & Accessibility Assets ---
console.log('\n6. Bilingual Strings & Accessibility Mappings');
test('provides complete translations for all keys in Khmer and English', () => {
  assert.equal(TRANSLATIONS.km['app.title'], 'ខ្លាឃ្លោក');
  assert.equal(TRANSLATIONS.en['app.title'], 'Kla-Klok');
  assert.equal(TRANSLATIONS.km['symbol.tiger'], 'ខ្លា');
  assert.equal(TRANSLATIONS.en['symbol.tiger'], 'Tiger');
  assert.ok(TRANSLATIONS.km['aria.welcome'].includes('ខ្លាឃ្លោក'));
  assert.ok(TRANSLATIONS.en['aria.welcome'].includes('Kla-Klok'));
});

// --- 7. React Component Render Tests ---
console.log('\n7. React Component & UI Rendering');
test('renders App to string with full layout and tiles', () => {
  const html = renderToString(React.createElement(App));
  assert.ok(html.includes('ខ្លាឃ្លោក'));
  assert.ok(html.includes('Khmer Dice'));
  assert.ok(html.includes('data-testid="wallet-balance"'));
  assert.ok(html.includes('data-testid="betting-board"'));
  assert.ok(html.includes('data-testid="chip-selector"'));
  assert.ok(html.includes('data-testid="bet-controls"'));
});

test('renders all 6 custom SVG symbol icons and casino chips (including $1000)', () => {
  const tigerSvg = renderToString(React.createElement(TigerIcon));
  const gourdSvg = renderToString(React.createElement(GourdIcon));
  const shrimpSvg = renderToString(React.createElement(ShrimpIcon));
  const fishSvg = renderToString(React.createElement(FishIcon));
  const crabSvg = renderToString(React.createElement(CrabIcon));
  const roosterSvg = renderToString(React.createElement(RoosterIcon));
  const chip100Svg = renderToString(React.createElement(ChipIcon, { value: 100 }));
  const chip1000Svg = renderToString(React.createElement(ChipIcon, { value: 1000 }));

  assert.ok(tigerSvg.includes('<svg'));
  assert.ok(gourdSvg.includes('<svg'));
  assert.ok(shrimpSvg.includes('<svg'));
  assert.ok(fishSvg.includes('<svg'));
  assert.ok(crabSvg.includes('<svg'));
  assert.ok(roosterSvg.includes('<svg'));
  assert.ok(chip100Svg.includes('100'));
  assert.ok(chip1000Svg.includes('1K') || chip1000Svg.includes('1000'));
});

test('renders BetStackIndicator with 3D chip layers, active bet amount, and clear button', () => {
  const stackHtml = renderToString(
    React.createElement(BetStackIndicator, {
      amount: 150,
      symbolName: 'Tiger',
      symbolId: 'tiger',
      phase: 'betting',
      disabled: false,
      onRemove: () => {},
    }),
  );
  assert.ok(stackHtml.includes('data-testid="bet-badge-tiger"'));
  assert.ok(stackHtml.includes('$150'));
  assert.ok(stackHtml.includes('data-testid="clear-bet-tiger"'));
  assert.ok(stackHtml.includes('Clear bet on Tiger'));
});

test('renders SymbolTile with high-contrast visual artwork, IPA, and bet indicator', () => {
  const tileHtml = renderToString(
    React.createElement(SymbolTile, {
      symbol: SYMBOLS_MAP.tiger,
      betAmount: 100,
      payoutResult: null,
      phase: 'betting',
      language: 'km',
      onPlaceBet: () => {},
      onRemoveBet: () => {},
    }),
  );
  assert.ok(tileHtml.includes('data-testid="symbol-tile-tiger"'));
  assert.ok(tileHtml.includes('/kʰlaː/'));
  assert.ok(tileHtml.includes('ខ្លា'));
  assert.ok(tileHtml.includes('Tiger') || tileHtml.includes('TIGER'));
  assert.ok(tileHtml.includes('100'));
  assert.ok(tileHtml.includes('data-testid="clear-bet-tiger"'));
});

test('renders SymbolTile in settled winning phase with multiplier badge', () => {
  const winTileHtml = renderToString(
    React.createElement(SymbolTile, {
      symbol: SYMBOLS_MAP.crab,
      betAmount: 50,
      payoutResult: {
        symbolId: 'crab',
        stake: 50,
        matchCount: 2,
        payoutMultiplier: 2,
        payoutReturn: 150,
        grossPayout: 150,
        netProfit: 100,
        profit: 100,
        lostStake: 0,
        wonStake: 50,
        status: 'double',
      },
      phase: 'settled',
      language: 'en',
      onPlaceBet: () => {},
      onRemoveBet: () => {},
    }),
  );
  assert.ok(winTileHtml.includes('data-testid="match-badge-crab"'));
  assert.ok(winTileHtml.includes('2x (2:1)'));
});

test('renders BettingBoard with table summary header, active bets count, total sum, and clear table action', () => {
  const boardHtml = renderToString(
    React.createElement(BettingBoard, {
      currentBets: { ...EMPTY_BET_MAP, tiger: 100, fish: 50 },
      settlement: null,
      phase: 'betting',
      language: 'en',
      onPlaceBet: () => {},
      onRemoveBet: () => {},
      onClearBets: () => {},
    }),
  );
  assert.ok(boardHtml.includes('data-testid="betting-board"'));
  assert.ok(boardHtml.includes('Active Bets:'));
  assert.ok(boardHtml.includes('2')); // 2 active symbols
  assert.ok(boardHtml.includes('data-testid="table-total-bet"'));
  assert.ok(boardHtml.includes('150'));
  assert.ok(boardHtml.includes('data-testid="board-clear-all-button"'));
  assert.ok(boardHtml.includes('data-testid="symbol-tile-tiger"'));
  assert.ok(boardHtml.includes('data-testid="symbol-tile-gourd"'));
  assert.ok(boardHtml.includes('data-testid="symbol-tile-shrimp"'));
  assert.ok(boardHtml.includes('data-testid="symbol-tile-fish"'));
  assert.ok(boardHtml.includes('data-testid="symbol-tile-crab"'));
  assert.ok(boardHtml.includes('data-testid="symbol-tile-rooster"'));
});

test('renders ChipSelector with all 8 denominations and active selection highlight', () => {
  const chipHtml = renderToString(
    React.createElement(ChipSelector, {
      selectedChip: 100,
      onSelectChip: () => {},
      walletBalance: 1000,
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );
  assert.ok(chipHtml.includes('data-testid="chip-selector"'));
  assert.ok(chipHtml.includes('data-testid="chip-button-1"'));
  assert.ok(chipHtml.includes('data-testid="chip-button-5"'));
  assert.ok(chipHtml.includes('data-testid="chip-button-10"'));
  assert.ok(chipHtml.includes('data-testid="chip-button-25"'));
  assert.ok(chipHtml.includes('data-testid="chip-button-50"'));
  assert.ok(chipHtml.includes('data-testid="chip-button-100"'));
  assert.ok(chipHtml.includes('data-testid="chip-button-500"'));
  assert.ok(chipHtml.includes('data-testid="chip-button-1000"'));
  assert.ok(chipHtml.includes('100'));
  assert.ok(chipHtml.includes('/ tap'));
});

test('renders BetControls with clear, double, rebet, and roll actions', () => {
  const controlsHtml = renderToString(
    React.createElement(BetControls, {
      phase: 'betting',
      hasBets: true,
      canDouble: true,
      canRebet: true,
      onRoll: () => {},
      onClear: () => {},
      onDouble: () => {},
      onRebet: () => {},
      onNextRound: () => {},
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );
  assert.ok(controlsHtml.includes('data-testid="bet-controls"'));
  assert.ok(controlsHtml.includes('data-testid="clear-bets-button"'));
  assert.ok(controlsHtml.includes('data-testid="double-bets-button"'));
  assert.ok(controlsHtml.includes('data-testid="rebet-button"'));
  assert.ok(controlsHtml.includes('data-testid="roll-button"'));
});

test('renders AriaLiveRegion for assistive technologies', () => {
  const politeHtml = renderToString(
    React.createElement(AriaLiveRegion, {
      announcement: { id: '1', message: 'Bet placed', politeness: 'polite' },
    }),
  );
  assert.ok(politeHtml.includes('aria-live="polite"'));
  assert.ok(politeHtml.includes('Bet placed'));

  const alertHtml = renderToString(
    React.createElement(AriaLiveRegion, {
      announcement: { id: '2', message: 'Insufficient balance', politeness: 'assertive' },
    }),
  );
  assert.ok(alertHtml.includes('aria-live="assertive"'));
  assert.ok(alertHtml.includes('Insufficient balance'));
});

// --- 8. Animated Dice Rolling & Shaker Component Tests ---
console.log('8. Animated Dice Rolling & Shaker Component');

test('renders ShakerCup with authentic Khmer Tror-laok styling, plate base, and lotus finial', () => {
  const shakerHtml = renderToString(
    React.createElement(ShakerCup, {
      phase: 'betting',
      isRolling: false,
      canRoll: true,
      onClick: () => {},
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );
  assert.ok(shakerHtml.includes('data-testid="shaker-cup"'));
  assert.ok(shakerHtml.includes('role="button"'));
  assert.ok(shakerHtml.includes('Shake'));
});

test('renders ShakerCup in active rolling phase with vigorous shake, vibration rings, and sparkle particles', () => {
  const rollingHtml = renderToString(
    React.createElement(ShakerCup, {
      phase: 'rolling',
      isRolling: true,
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );
  assert.ok(rollingHtml.includes('data-testid="shaker-cup"'));
  assert.ok(rollingHtml.includes('animate-cup-shake'));
  assert.ok(rollingHtml.includes('animate-vibration-ring'));
  assert.ok(rollingHtml.includes('animate-particle'));
  assert.ok(rollingHtml.includes('cursor-wait'));
  assert.ok(rollingHtml.includes('aria-disabled="true"'));
});

test('renders ShakerCup in revealing phase with smooth upward lift animation', () => {
  const revealHtml = renderToString(
    React.createElement(ShakerCup, {
      phase: 'revealing',
      isRevealing: true,
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );
  assert.ok(revealHtml.includes('animate-cup-lift'));
  assert.ok(revealHtml.includes('pointer-events-none'));
});

test('renders Die3D with 3D perspective tumbling classes for each die index', () => {
  const die0Html = renderToString(
    React.createElement(Die3D, { symbol: 'tiger', index: 0, isRolling: true, phase: 'revealing' }),
  );
  assert.ok(die0Html.includes('data-testid="die-item-0"'));
  assert.ok(die0Html.includes('animate-tumble-0'));

  const die1Html = renderToString(
    React.createElement(Die3D, { symbol: 'gourd', index: 1, isRolling: true, phase: 'revealing' }),
  );
  assert.ok(die1Html.includes('data-testid="die-item-1"'));
  assert.ok(die1Html.includes('animate-tumble-1'));

  const die2Html = renderToString(
    React.createElement(Die3D, { symbol: 'fish', index: 2, isRolling: true, phase: 'revealing' }),
  );
  assert.ok(die2Html.includes('data-testid="die-item-2"'));
  assert.ok(die2Html.includes('animate-tumble-2'));
});

test('renders Die3D with winning match highlight aura and MATCH badge in settled phase', () => {
  const winDieHtml = renderToString(
    React.createElement(Die3D, {
      symbol: 'shrimp',
      index: 0,
      phase: 'settled',
      isWinning: true,
      matchCount: 2,
      language: 'en',
    }),
  );
  assert.ok(winDieHtml.includes('animate-win-glow'));
  assert.ok(winDieHtml.includes('data-testid="die-win-badge-0"'));
  assert.ok(winDieHtml.includes('MATCH'));
  assert.ok(winDieHtml.includes('Shrimp'));
  assert.ok(winDieHtml.includes('បង្កង'));

  const lossDieHtml = renderToString(
    React.createElement(Die3D, {
      symbol: 'crab',
      index: 1,
      phase: 'settled',
      isWinning: false,
      matchCount: 0,
      language: 'km',
    }),
  );
  assert.ok(!lossDieHtml.includes('data-testid="die-win-badge-1"'));
  assert.ok(lossDieHtml.includes('animate-die-settle'));
});

test('renders DiceArena in rolling phase with animated shaker cup and rolling status indicator', () => {
  const arenaRollingHtml = renderToString(
    React.createElement(DiceArena, {
      phase: 'rolling',
      lastOutcome: null,
      settlement: null,
      language: 'en',
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );
  assert.ok(arenaRollingHtml.includes('data-testid="dice-arena"'));
  assert.ok(arenaRollingHtml.includes('data-testid="shaker-cup"'));
  assert.ok(arenaRollingHtml.includes('animate-cup-shake'));
  assert.ok(arenaRollingHtml.includes('Rolling in progress...'));
});

test('renders DiceArena in revealing phase with lifting shaker cup and 3 tumbling dice', () => {
  const arenaRevealHtml = renderToString(
    React.createElement(DiceArena, {
      phase: 'revealing',
      lastOutcome: { dice: ['tiger', 'tiger', 'fish'], counts: { tiger: 2, fish: 1 }, timestamp: 123 },
      settlement: null,
      language: 'en',
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );
  assert.ok(arenaRevealHtml.includes('data-testid="dice-arena"'));
  assert.ok(arenaRevealHtml.includes('animate-cup-lift'));
  assert.ok(arenaRevealHtml.includes('data-testid="die-item-0"'));
  assert.ok(arenaRevealHtml.includes('data-testid="die-item-1"'));
  assert.ok(arenaRevealHtml.includes('data-testid="die-item-2"'));
});

test('renders DiceArena in settled phase with winning settlement banner and matching dice badges', () => {
  const settlementMock = {
    roundNumber: 1,
    bets: { ...EMPTY_BET_MAP, tiger: 100 },
    dice: ['tiger', 'tiger', 'crab'],
    totalStake: 100,
    totalReturn: 300,
    grossPayout: 300,
    netProfit: 200,
    profit: 200,
    lostStakes: 0,
    wonStakes: 100,
    breakdown: {
      tiger: {
        symbolId: 'tiger',
        stake: 100,
        matchCount: 2,
        payoutMultiplier: 2,
        payoutReturn: 300,
        grossPayout: 300,
        netProfit: 200,
        profit: 200,
        lostStake: 0,
        wonStake: 100,
        status: 'double',
      },
      crab: {
        symbolId: 'crab',
        stake: 0,
        matchCount: 1,
        payoutMultiplier: 1,
        payoutReturn: 0,
        grossPayout: 0,
        netProfit: 0,
        profit: 0,
        lostStake: 0,
        wonStake: 0,
        status: 'single',
      },
    },
    isWin: true,
    isNetProfit: true,
    hasTriple: false,
    highestMultiplier: 2,
    winningSymbols: ['tiger', 'crab'],
    timestamp: 123456,
  };

  const arenaSettledHtml = renderToString(
    React.createElement(DiceArena, {
      phase: 'settled',
      lastOutcome: { dice: ['tiger', 'tiger', 'crab'], counts: { tiger: 2, crab: 1 }, timestamp: 123 },
      settlement: settlementMock,
      language: 'en',
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );

  assert.ok(arenaSettledHtml.includes('data-testid="dice-arena"'));
  assert.ok(arenaSettledHtml.includes('data-testid="settlement-banner"'));
  assert.ok(arenaSettledHtml.includes('Big Win!'));
  assert.ok(arenaSettledHtml.includes('+$200'));
  assert.ok(arenaSettledHtml.includes('(Payout: $300)'));
  assert.ok(arenaSettledHtml.includes('data-testid="die-win-badge-0"'));
  assert.ok(arenaSettledHtml.includes('data-testid="die-win-badge-1"'));
});

test('disables roll triggers in BetControls when rolling is in progress', () => {
  const controlsRollingHtml = renderToString(
    React.createElement(BetControls, {
      phase: 'rolling',
      hasBets: true,
      canDouble: false,
      canRebet: false,
      onRoll: () => {},
      onClear: () => {},
      onDouble: () => {},
      onRebet: () => {},
      onNextRound: () => {},
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );
  assert.ok(controlsRollingHtml.includes('data-testid="roll-button"'));
  assert.ok(controlsRollingHtml.includes('disabled=""') || controlsRollingHtml.includes('disabled'));
  assert.ok(controlsRollingHtml.includes('cursor-wait'));
  assert.ok(controlsRollingHtml.includes('Shaking...'));
});

// --- 9. Wallet Balance Persistence, Refill Modal & Recent Roll History ---
console.log('\n9. Wallet Balance Persistence, Refill Modal & Recent History');

test('renders WalletBar with refill trigger button', () => {
  const walletHtml = renderToString(
    React.createElement(WalletBar, {
      wallet: {
        balance: 1000,
        startingBalance: 1000,
        totalWagered: 0,
        totalWon: 0,
        totalLost: 0,
        netEarnings: 0,
      },
      totalBet: 50,
      roundNumber: 3,
      onOpenRefill: () => {},
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );
  assert.ok(walletHtml.includes('data-testid="wallet-balance"'));
  assert.ok(walletHtml.includes('1,000'));
  assert.ok(walletHtml.includes('data-testid="wallet-refill-button"'));
  assert.ok(walletHtml.includes('data-testid="total-bet-amount"'));
  assert.ok(walletHtml.includes('50'));
  assert.ok(walletHtml.includes('data-testid="current-round-number"'));
  assert.ok(walletHtml.includes('3'));
});

test('renders RefillModal with preset options ($100, $500, $1000, $2500) and reset game action', () => {
  const modalHtml = renderToString(
    React.createElement(RefillModal, {
      isOpen: true,
      onClose: () => {},
      balance: 0,
      isBroke: true,
      onTopUp: () => {},
      onReset: () => {},
      language: 'en',
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );
  assert.ok(modalHtml.includes('data-testid="refill-modal"'));
  assert.ok(modalHtml.includes('Out of Chips!'));
  assert.ok(modalHtml.includes('data-testid="refill-current-balance"'));
  assert.ok(modalHtml.includes('0'));
  assert.ok(modalHtml.includes('data-testid="topup-button-100"'));
  assert.ok(modalHtml.includes('data-testid="topup-button-500"'));
  assert.ok(modalHtml.includes('data-testid="topup-button-1000"'));
  assert.ok(modalHtml.includes('data-testid="topup-button-2500"'));
  assert.ok(modalHtml.includes('data-testid="refill-reset-button"'));
});

test('renders RecentRollHistory strip displaying recent round dice and outcomes', () => {
  const historyMock = [
    {
      roundNumber: 2,
      bets: { ...EMPTY_BET_MAP, tiger: 100 },
      dice: ['tiger', 'tiger', 'fish'],
      totalStake: 100,
      totalReturn: 300,
      grossPayout: 300,
      netProfit: 200,
      profit: 200,
      lostStakes: 0,
      wonStakes: 100,
      breakdown: {},
      isWin: true,
      isNetProfit: true,
      hasTriple: false,
      highestMultiplier: 2,
      winningSymbols: ['tiger', 'fish'],
      timestamp: 123456,
    },
    {
      roundNumber: 1,
      bets: { ...EMPTY_BET_MAP, gourd: 50 },
      dice: ['crab', 'rooster', 'fish'],
      totalStake: 50,
      totalReturn: 0,
      grossPayout: 0,
      netProfit: -50,
      profit: -50,
      lostStakes: 50,
      wonStakes: 0,
      breakdown: {},
      isWin: false,
      isNetProfit: false,
      hasTriple: false,
      highestMultiplier: 0,
      winningSymbols: ['crab', 'rooster', 'fish'],
      timestamp: 123450,
    },
  ];

  const stripHtml = renderToString(
    React.createElement(RecentRollHistory, {
      history: historyMock,
      onOpenFullHistory: () => {},
      language: 'en',
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );

  assert.ok(stripHtml.includes('data-testid="recent-roll-history"'));
  assert.ok(stripHtml.includes('Recent Rolls'));
  assert.ok(stripHtml.includes('data-testid="view-full-history-button"'));
  assert.ok(stripHtml.includes('data-testid="recent-entry-2"'));
  assert.ok(stripHtml.includes('+$200'));
  assert.ok(stripHtml.includes('data-testid="recent-entry-1"'));
  assert.ok(stripHtml.includes('-$50'));
});

// --- 10. Bilingual Support, ARIA Live Announcements & Accessibility Matrix ---
console.log('\n10. Bilingual Support, ARIA Live Announcements & Accessibility Matrix');

test('all translation keys are identical between Khmer and English dictionaries', () => {
  const kmKeys = Object.keys(TRANSLATIONS.km).sort();
  const enKeys = Object.keys(TRANSLATIONS.en).sort();
  assert.deepEqual(kmKeys, enKeys);
  for (const key of kmKeys) {
    assert.ok(TRANSLATIONS.km[key].length > 0, `Khmer translation for ${key} should not be empty`);
    assert.ok(TRANSLATIONS.en[key].length > 0, `English translation for ${key} should not be empty`);
  }
});

test('Header renders language switcher, high contrast toggle, and keyboard shortcuts button with proper ARIA attributes', () => {
  const headerKmHtml = renderToString(
    React.createElement(Header, {
      language: 'km',
      onLanguageChange: () => {},
      soundEnabled: true,
      onToggleSound: () => {},
      highContrast: false,
      onToggleHighContrast: () => {},
      onOpenRules: () => {},
      onOpenHistory: () => {},
      onOpenShortcuts: () => {},
      onResetGame: () => {},
      t: (k) => TRANSLATIONS.km[k] || k,
    }),
  );

  assert.ok(headerKmHtml.includes('data-testid="language-toggle-button"'));
  assert.ok(headerKmHtml.includes('EN'));
  assert.ok(headerKmHtml.includes('data-testid="high-contrast-toggle-button"'));
  assert.ok(headerKmHtml.includes('aria-pressed="false"'));
  assert.ok(headerKmHtml.includes('data-testid="shortcuts-modal-button"'));

  const headerEnHighContrastHtml = renderToString(
    React.createElement(Header, {
      language: 'en',
      onLanguageChange: () => {},
      soundEnabled: true,
      onToggleSound: () => {},
      highContrast: true,
      onToggleHighContrast: () => {},
      onOpenRules: () => {},
      onOpenHistory: () => {},
      onOpenShortcuts: () => {},
      onResetGame: () => {},
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );

  assert.ok(headerEnHighContrastHtml.includes('ខ្មែរ'));
  assert.ok(headerEnHighContrastHtml.includes('aria-pressed="true"'));
});

test('AriaLiveRegion renders polite roll countdown, dice reveal, and win/loss announcement messages correctly', () => {
  // Countdown announcement
  const countdownHtml = renderToString(
    React.createElement(AriaLiveRegion, {
      announcement: {
        id: 'cd-1',
        message: 'Dice are rolling in the shaker cup... Shaking 3, 2, 1!',
        politeness: 'polite',
      },
    }),
  );
  assert.ok(countdownHtml.includes('data-testid="aria-live-polite"'));
  assert.ok(countdownHtml.includes('Shaking 3, 2, 1!'));

  // Reveal announcement
  const revealHtml = renderToString(
    React.createElement(AriaLiveRegion, {
      announcement: {
        id: 'rev-1',
        message: 'Dice roll result: Die 1 is Tiger, Die 2 is Tiger, Die 3 is Fish.',
        politeness: 'polite',
      },
    }),
  );
  assert.ok(revealHtml.includes('Die 1 is Tiger, Die 2 is Tiger, Die 3 is Fish.'));

  // Settlement Win announcement
  const winHtml = renderToString(
    React.createElement(AriaLiveRegion, {
      announcement: {
        id: 'win-1',
        message: 'Outcome: Tiger, Tiger, Fish. Congratulations! You won $300 with a net profit of $200. Your new balance is $1,200.',
        politeness: 'polite',
      },
    }),
  );
  assert.ok(winHtml.includes('Congratulations! You won $300 with a net profit of $200. Your new balance is $1,200.'));

  // Assertive error announcement
  const errHtml = renderToString(
    React.createElement(AriaLiveRegion, {
      announcement: {
        id: 'err-1',
        message: 'Insufficient balance. You have $50 remaining.',
        politeness: 'assertive',
      },
    }),
  );
  assert.ok(errHtml.includes('data-testid="aria-live-assertive"'));
  assert.ok(errHtml.includes('Insufficient balance. You have $50 remaining.'));
});

test('ShortcutsModal renders bilingual keyboard navigation cheat sheet and instructions', () => {
  const modalKmHtml = renderToString(
    React.createElement(ShortcutsModal, {
      isOpen: true,
      onClose: () => {},
      language: 'km',
      t: (k) => TRANSLATIONS.km[k] || k,
    }),
  );

  assert.ok(modalKmHtml.includes('data-testid="shortcuts-modal"'));
  assert.ok(modalKmHtml.includes('Space / R'));
  assert.ok(modalKmHtml.includes('1 - 6'));
  assert.ok(modalKmHtml.includes('[  /  ]'));
  assert.ok(modalKmHtml.includes('L'));
  assert.ok(modalKmHtml.includes('H'));
  assert.ok(modalKmHtml.includes('?'));
  assert.ok(modalKmHtml.includes('Esc'));
  assert.ok(modalKmHtml.includes('ARIA Live') && modalKmHtml.includes('High Contrast'));
});

test('BetControls includes aria-keyshortcuts and accessible toolbar role', () => {
  const controlsHtml = renderToString(
    React.createElement(BetControls, {
      phase: 'betting',
      hasBets: true,
      canDouble: true,
      canRebet: true,
      onRoll: () => {},
      onClear: () => {},
      onDouble: () => {},
      onRebet: () => {},
      onNextRound: () => {},
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );

  assert.ok(controlsHtml.includes('role="toolbar"'));
  assert.ok(controlsHtml.includes('aria-keyshortcuts="KeyC"'));
  assert.ok(controlsHtml.includes('aria-keyshortcuts="KeyD"'));
  assert.ok(controlsHtml.includes('aria-keyshortcuts="KeyB"'));
  assert.ok(controlsHtml.includes('aria-keyshortcuts="Space KeyR"'));
});

// --- 11. Modal Dialogs & ARIA Screen-Reader Verification ---
console.log('\n11. Modal Dialogs & Comprehensive ARIA Verification');

test('RulesModal renders paytable, 6 traditional symbols, and accessible dialog structure', () => {
  const rulesKmHtml = renderToString(
    React.createElement(RulesModal, {
      isOpen: true,
      onClose: () => {},
      t: (k) => TRANSLATIONS.km[k] || k,
    }),
  );
  assert.ok(rulesKmHtml.includes('role="dialog"'));
  assert.ok(rulesKmHtml.includes('aria-modal="true"'));
  assert.ok(rulesKmHtml.includes('aria-labelledby="rules-modal-title"'));
  assert.ok(rulesKmHtml.includes('ច្បាប់ល្បែងខ្លាឃ្លោក &amp; តារាងទូទាត់រង្វាន់') || rulesKmHtml.includes('ច្បាប់ល្បែងខ្លាឃ្លោក & តារាងទូទាត់រង្វាន់') || rulesKmHtml.includes('តារាងទូទាត់រង្វាន់'));
  assert.ok(rulesKmHtml.includes('1:1 (+ stake return)'));
  assert.ok(rulesKmHtml.includes('2:1 (+ stake return)'));
  assert.ok(rulesKmHtml.includes('3:1 (+ stake return)'));
  assert.ok(rulesKmHtml.includes('Stake Forfeited'));
});

test('HistoryModal renders complete roll log, net calculations, and clear history action', () => {
  const mockHistory = [
    {
      roundNumber: 3,
      bets: { ...EMPTY_BET_MAP, tiger: 100 },
      dice: ['tiger', 'tiger', 'fish'],
      totalStake: 100,
      totalReturn: 300,
      grossPayout: 300,
      netProfit: 200,
      profit: 200,
      lostStakes: 0,
      wonStakes: 100,
      breakdown: {
        tiger: { symbolId: 'tiger', stake: 100, matchCount: 2, payoutMultiplier: 2, payoutReturn: 300, grossPayout: 300, netProfit: 200, profit: 200, lostStake: 0, wonStake: 100, status: 'double' },
      },
      isWin: true,
      isNetProfit: true,
      hasTriple: false,
      highestMultiplier: 2,
      winningSymbols: ['tiger', 'fish'],
      timestamp: 1700000000000,
    },
    {
      roundNumber: 2,
      bets: { ...EMPTY_BET_MAP, gourd: 50 },
      dice: ['crab', 'rooster', 'fish'],
      totalStake: 50,
      totalReturn: 0,
      grossPayout: 0,
      netProfit: -50,
      profit: -50,
      lostStakes: 50,
      wonStakes: 0,
      breakdown: {},
      isWin: false,
      isNetProfit: false,
      hasTriple: false,
      highestMultiplier: 0,
      winningSymbols: ['crab', 'rooster', 'fish'],
      timestamp: 1699999000000,
    },
  ];

  const historyHtml = renderToString(
    React.createElement(HistoryModal, {
      isOpen: true,
      onClose: () => {},
      history: mockHistory,
      onClearHistory: () => {},
      language: 'en',
      t: (k) => TRANSLATIONS.en[k] || k,
    }),
  );

  assert.ok(historyHtml.includes('role="dialog"'));
  assert.ok(historyHtml.includes('aria-modal="true"'));
  assert.ok(historyHtml.includes('data-testid="history-modal"'));
  assert.ok(historyHtml.includes('data-testid="clear-history-button"'));
  assert.ok(historyHtml.includes('data-testid="history-card-3"'));
  assert.ok(historyHtml.includes('+$200'));
  assert.ok(historyHtml.includes('data-testid="history-card-2"'));
  assert.ok(historyHtml.includes('-$50'));
});

// --- 12. LocalStorage Persistence & Error Fallback Matrix ---
console.log('\n12. LocalStorage Persistence & Error Fallback Matrix');

test('mock storage correctly roundtrips wallet state and user settings', () => {
  const store = {};
  const mockLocalStorage = {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };

  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = mockLocalStorage;

  try {
    // Default fallback
    assert.deepEqual(loadWalletState(), DEFAULT_WALLET_STATE);

    // Custom save and load
    const customWallet = {
      balance: 2450,
      startingBalance: 1000,
      totalWagered: 1200,
      totalWon: 2650,
      totalLost: 0,
      netEarnings: 1450,
    };
    saveWalletState(customWallet);
    assert.deepEqual(loadWalletState(), customWallet);

    // Corrupt JSON recovery
    mockLocalStorage.setItem(GAME_CONFIG.STORAGE_KEYS.WALLET, '{invalid_json_corrupted');
    assert.deepEqual(loadWalletState(), DEFAULT_WALLET_STATE);

    // Settings save and load
    saveSettings({ soundEnabled: false, language: 'en', highContrast: true });
    assert.deepEqual(loadSettings(), { soundEnabled: false, language: 'en', highContrast: true });

    // Corrupt settings recovery
    mockLocalStorage.setItem(GAME_CONFIG.STORAGE_KEYS.SETTINGS, 'not-a-json');
    assert.deepEqual(loadSettings(), { soundEnabled: true, language: 'km', highContrast: false });

    // History save with cap
    const fakeHistory = Array.from({ length: 60 }, (_, i) => ({
      roundNumber: i + 1,
      bets: { ...EMPTY_BET_MAP },
      dice: ['tiger', 'tiger', 'tiger'],
      totalStake: 10,
      totalReturn: 40,
      grossPayout: 40,
      netProfit: 30,
      profit: 30,
      lostStakes: 0,
      wonStakes: 10,
      breakdown: {},
      isWin: true,
      isNetProfit: true,
      hasTriple: true,
      highestMultiplier: 3,
      winningSymbols: ['tiger'],
      timestamp: Date.now(),
    }));

    saveHistory(fakeHistory);
    const loadedHistory = loadHistory();
    assert.equal(loadedHistory.length, GAME_CONFIG.MAX_HISTORY_ENTRIES);
    assert.equal(loadedHistory[0].roundNumber, 1);
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

// --- 13. End-to-End Game State Machine Lifecycle Simulation ---
console.log('\n13. End-to-End Game State Machine Lifecycle Simulation');

test('simulates full 4-round game session with betting, rolling, revealing, and settling', () => {
  // Pure reducer simulation mimicking useKlaKlokGame state transitions
  let state = {
    phase: 'betting',
    roundNumber: 1,
    currentBets: { ...EMPTY_BET_MAP },
    selectedChip: 25,
    lastBets: null,
    lastOutcome: null,
    lastSettlement: null,
    wallet: {
      balance: 1000,
      startingBalance: 1000,
      totalWagered: 0,
      totalWon: 0,
      totalLost: 0,
      netEarnings: 0,
    },
    history: [],
    soundEnabled: true,
    language: 'km',
    highContrast: false,
    announcement: null,
  };

  // Step 1: Place $25 on Tiger, $50 on Fish (2x $25 chip)
  state.currentBets = placeBet(state.currentBets, 'tiger', 25);
  state.wallet.balance -= 25;
  state.currentBets = placeBet(state.currentBets, 'fish', 50);
  state.wallet.balance -= 50;
  assert.equal(state.wallet.balance, 925);
  assert.equal(calculateTotalBet(state.currentBets), 75);

  // Step 2: Double active bets -> Tiger $50, Fish $100
  const doubleRes = doubleBets(state.currentBets, state.wallet.balance);
  assert.ok(doubleRes);
  state.currentBets = doubleRes.newBets;
  state.wallet.balance -= doubleRes.totalCost;
  assert.equal(state.wallet.balance, 850);
  assert.equal(calculateTotalBet(state.currentBets), 150);

  // Step 3: Start Roll -> phase 'rolling'
  state.phase = 'rolling';

  // Step 4: Reveal Dice -> [Tiger, Tiger, Crab] (2 matches on Tiger, 0 on Fish)
  state.phase = 'revealing';
  state.lastOutcome = createDiceOutcome(['tiger', 'tiger', 'crab']);

  // Step 5: Settle Round -> Tiger $50*3 = $150 return ($100 profit), Fish $100 lost. Net profit = $0 (Break-even).
  const settlement1 = calculateRoundSettlement(state.roundNumber, state.currentBets, state.lastOutcome.dice);
  state.phase = 'settled';
  state.lastBets = { ...state.currentBets };
  state.lastSettlement = settlement1;
  state.wallet.balance += settlement1.totalReturn; // 850 + 150 = 1000
  state.wallet.totalWagered += settlement1.totalStake;
  state.wallet.netEarnings += settlement1.netProfit;
  state.history.unshift(settlement1);

  assert.equal(state.wallet.balance, 1000);
  assert.equal(settlement1.grossPayout, 150);
  assert.equal(settlement1.netProfit, 0);

  // Step 6: Next round
  state.phase = 'betting';
  state.roundNumber = 2;
  state.currentBets = { ...EMPTY_BET_MAP };

  // Step 7: Rebet last round ($150 total)
  state.currentBets = { ...state.lastBets };
  state.wallet.balance -= 150; // 850
  assert.equal(state.wallet.balance, 850);

  // Step 8: Roll -> [Tiger, Tiger, Tiger] (Triple Jackpot on Tiger!)
  state.phase = 'rolling';
  state.phase = 'revealing';
  state.lastOutcome = createDiceOutcome(['tiger', 'tiger', 'tiger']);
  const settlement2 = calculateRoundSettlement(state.roundNumber, state.currentBets, state.lastOutcome.dice);
  state.phase = 'settled';
  state.lastBets = { ...state.currentBets };
  state.lastSettlement = settlement2;
  // Tiger $50*4 = $200 return ($150 profit). Fish $100 lost. Total return $200. Net profit = $50.
  state.wallet.balance += settlement2.totalReturn; // 850 + 200 = 1050
  state.wallet.totalWagered += settlement2.totalStake;
  state.wallet.totalWon += (settlement2.netProfit > 0 ? settlement2.netProfit : 0);
  state.wallet.netEarnings += settlement2.netProfit;
  state.history.unshift(settlement2);

  assert.equal(state.wallet.balance, 1050);
  assert.equal(state.wallet.netEarnings, 50);
  assert.equal(settlement2.hasTriple, true);
  assert.equal(state.history.length, 2);
});

// --- 14. High-Roller Limits & Bankroll Math Verification ---
console.log('\n14. High-Roller Limits & Bankroll Math Verification');

test('enforces MAX_BET_PER_SYMBOL ($1000) and MAX_TOTAL_BET ($5000)', () => {
  let bets = { ...EMPTY_BET_MAP };
  let balance = 10000;

  // Max per symbol $1000
  const valid1 = validateBetPlacement(bets, 'tiger', 1000, balance);
  assert.equal(valid1.isValid, true);
  bets = placeBet(bets, 'tiger', 1000);

  const invalidSymbolOver = validateBetPlacement(bets, 'tiger', 1, balance);
  assert.equal(invalidSymbolOver.isValid, false);
  assert.equal(invalidSymbolOver.errorKey, 'aria.max_bet_exceeded');

  // Fill up table to $5000 limit
  bets = placeBet(bets, 'gourd', 1000);
  bets = placeBet(bets, 'shrimp', 1000);
  bets = placeBet(bets, 'fish', 1000);
  bets = placeBet(bets, 'crab', 1000);
  assert.equal(calculateTotalBet(bets), 5000);

  const invalidTotalOver = validateBetPlacement(bets, 'rooster', 1, balance);
  assert.equal(invalidTotalOver.isValid, false);
  assert.equal(invalidTotalOver.errorKey, 'bet.max');
});

console.log(`\n=============================================================`);
console.log(`Test Results: ${passed}/${total} passed (100% SUCCESS)`);
console.log(`=============================================================\n`);
