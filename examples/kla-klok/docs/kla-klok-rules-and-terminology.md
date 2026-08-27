# Kla-Klok (ខ្លាឃ្លោក) Game Rules, Payout Structure & Khmer Terminology Specification

## 1. Executive Summary & Cultural Background

**Kla-Klok** (Khmer: ខ្លាឃ្លោក, literally *"Tiger-Gourd"*), also commonly referred to as the Khmer Traditional Animal Dice Game, is an iconic and beloved folk gambling game widely played in Cambodia, particularly during **Choul Chnam Thmey** (Khmer New Year), **Pchum Ben** (Ancestors' Day), and community celebrations.

The game is closely related to other Asian dice games such as Vietnamese *Bầu Cua Tôm Cá*, Chinese *Hoo Hey How* (Fish-Prawn-Crab), and the Western *Crown and Anchor*. In Cambodia, Kla-Klok holds deep cultural resonance as a lively social game of chance where family and community members gather around a vibrant canvas or wooden mat to place wagers on six traditional animal and nature symbols.

---

## 2. Six Traditional Symbols Specification Sheet

Each of the three dice in Kla-Klok features six distinct iconic symbols. The table below provides the full cultural, visual, chromatic, and linguistic specification for each symbol.

| # | English Name | Khmer Unicode | Romanization (IPA) | Traditional Symbolism & Meaning | Recommended UI Color Palette | Recommended Iconography / Visual Treatment |
|---|:---|:---:|:---|:---|:---|:---|
| 1 | **Tiger** | **ខ្លា** | *Kla* (`/kʰlaː/`) | Bravery, strength, royal dominion, and fierce power. | **Amber / Tiger Orange** (`#EA580C`, `#F97316`) with black stripes & golden highlights | Majestic roaring or poised tiger head/face with distinct stripes and intense eyes. |
| 2 | **Gourd** (Calabash) | **ឃ្លោក** | *Klok* (`/kʰloːk/`) | Longevity, health, bottle of abundance, container of good fortune. | **Emerald / Forest Green** (`#16A34A`, `#22C55E`) or Golden Amber bottle with red ribbon | Traditional hourglass-shaped calabash/bottle gourd tied with a festive red ribbon around its waist. |
| 3 | **Shrimp** (Prawn / Lobster) | **បង្កង** | *Bongkang* (`/ɓɑŋ.kɑːŋ/`) | Prosperity, agility, aquatic harvest, and renewal. | **Coral / Bright Red-Orange** (`#EF4444`, `#F87171`) with azure accents | Giant freshwater prawn (Macrobrachium rosenbergii) with curved segmented body, long antennae, and prominent claws. |
| 4 | **Fish** | **ត្រី** | *Trey* (`/trəj/`) | Abundance, wealth, prosperity, peaceful life, and fluidity (*"Where there is water, there is fish"*). | **Cobalt / Ocean Blue** (`#2563EB`, `#38BDF8`) with silver/cyan scales | Graceful swimming carp or freshwater fish with detailed flowing fins, scales, and tail. |
| 5 | **Crab** | **ក្តាម** | *Kdam* (`/kdaːm/`) | Resourcefulness, persistence, tenacity, and good harvest. | **Crimson / Deep Ruby Red** (`#DC2626`, `#B91C1C`) or rich warm ochre | Symmetrical mud crab / freshwater river crab with two large open pincers and eight articulated legs. |
| 6 | **Rooster** (Chicken) | **មាន់** | *Moan* (`/mŏən/`) | Punctuality, awakening, prosperity, vigilance, and good luck at dawn. | **Golden Yellow / Scarlet Red** (`#EAB308`, `#F59E0B`) with radiant scarlet comb | Proud Khmer fighting rooster standing tall with a bright red comb/wattle and arching tail feathers. |

### Standard Grid Layout on the Betting Board

In traditional Cambodian gaming mats, the 6 symbols are arranged in a 2×3 (or 3×2) grid. The most standard top-to-bottom, left-to-right configuration is:

```
+-------------------+-------------------+-------------------+
|     ខ្លា (Tiger)   |   ឃ្លោក (Gourd)  |   បង្កង (Shrimp)  |
+-------------------+-------------------+-------------------+
|     ត្រី (Fish)    |    ក្តាម (Crab)   |   មាន់ (Rooster)  |
+-------------------+-------------------+-------------------+
```

*(Alternative symmetrical arrangement pairing land vs. aquatic animals is also common, but the 2×3 grid with large touch/click targets and prominent symbol art is standard for responsive digital displays).*

---

## 3. Game Mechanics & Payout Structure

### 3.1 Equipment & Setup
1. **Three (3) Identical Six-Sided Dice**: Each die has faces representing { Tiger, Gourd, Shrimp, Fish, Crab, Rooster }.
2. **One (1) Shaker / Cup & Bowl Set** (*ចាន និង ត្រឡោក/គម្រប*): Used to conceal and randomize the dice roll.
3. **One (1) Betting Board / Felt Mat**: Divided into 6 wagering spaces corresponding to each symbol.
4. **Betting Chips / Balance**: Standard denominations ($1, $5, $10, $25, $50, $100, $500).

### 3.2 Round Lifecycle
1. **Betting Phase**: The player places chips onto one or multiple symbols on the board.
2. **Rolling / Shaking Phase**: The 3 dice are shaken inside the cup.
3. **Reveal Phase**: The cup is lifted to reveal the top faces of all 3 dice.
4. **Resolution / Settlement Phase**:
   - Bets on symbols that did not appear on any of the 3 dice are lost to the house.
   - Bets on symbols that appeared on 1, 2, or 3 dice receive payouts proportional to the match count, plus their initial stake is returned.
5. **Wallet Sync**: Balance updates immediately in state and persists to `localStorage`.

---

### 3.3 Formal Payout Formula

Let:
- $S \in \{\text{Tiger}, \text{Gourd}, \text{Shrimp}, \text{Fish}, \text{Crab}, \text{Rooster}\}$ represent any symbol.
- $B(S) \ge 0$ represent the amount wagered on symbol $S$.
- $M(S) \in \{0, 1, 2, 3\}$ represent the number of dice among the 3 rolled that show symbol $S$.

$$\sum_{i=1}^{6} M(S_i) = 3$$

#### Mathematical Payout & Return Rules:

| Match Count $M(S)$ | Result Status | Payout Ratio (Net Profit Multiplier) | Return Formula (Total Return to Player) | Net Profit Formula |
|:---:|:---:|:---:|:---|:---|
| **$M(S) = 0$** | **Loss** | $0$ (Stake forfeited) | $\text{Return}(S) = 0$ | $\text{Profit}(S) = -B(S)$ |
| **$M(S) = 1$** | **Single Match** | **1:1** ($1\times$) | $\text{Return}(S) = B(S) + (1 \times B(S)) = 2 \times B(S)$ | $\text{Profit}(S) = +1 \times B(S)$ |
| **$M(S) = 2$** | **Double Match** | **2:1** ($2\times$) | $\text{Return}(S) = B(S) + (2 \times B(S)) = 3 \times B(S)$ | $\text{Profit}(S) = +2 \times B(S)$ |
| **$M(S) = 3$** | **Triple Match** | **3:1** ($3\times$) | $\text{Return}(S) = B(S) + (3 \times B(S)) = 4 \times B(S)$ | $\text{Profit}(S) = +3 \times B(S)$ |

#### General Unified Formula for Total Round Resolution:
For a round with placed bets $\vec{B} = [B_1, B_2, B_3, B_4, B_5, B_6]$ and outcomes $\vec{M} = [M_1, M_2, M_3, M_4, M_5, M_6]$:

$$\text{Total Stake} = \sum_{i=1}^{6} B(S_i)$$

$$\text{Total Return} = \sum_{i=1}^{6} \begin{cases} B(S_i) \times (M(S_i) + 1) & \text{if } M(S_i) > 0 \\ 0 & \text{if } M(S_i) = 0 \end{cases}$$

$$\text{Net Round Profit / Loss} = \text{Total Return} - \text{Total Stake} = \sum_{i=1}^{6} \left( M(S_i) \cdot B(S_i) - [M(S_i) = 0] \cdot B(S_i) \right)$$

---

### 3.4 Multi-Bet Settlement Example

Suppose a player starts with a **$1,000** wallet balance and places the following bets:
- **Tiger (ខ្លា)**: $100
- **Gourd (ឃ្លោក)**: $50
- **Crab (ក្តាម)**: $50
- *Total Wagered*: $200 (Balance drops to $800 during roll).

**Dice Roll Outcome**: `[Tiger, Tiger, Fish]`
- Tiger match count $M(\text{Tiger}) = 2$ (Double):
  - Return = $\$100 \times (2 + 1) = \$300$ (Stake $\$100$ + Profit $\$200$).
- Gourd match count $M(\text{Gourd}) = 0$ (Zero):
  - Return = $\$0$ (Loss $-\$50$).
- Crab match count $M(\text{Crab}) = 0$ (Zero):
  - Return = $\$0$ (Loss $-\$50$).
- Fish match count $M(\text{Fish}) = 1$:
  - No bet was placed on Fish ($B = 0 \implies \text{Return} = \$0$).

**Settlement**:
- **Total Payout Returned**: $\$300$
- **New Balance**: $\$800 + \$300 = \$1,100$
- **Net Round Profit**: $\$1,100 - \$1,000 = +\$100$.

---

### 3.5 Probability Distribution & House Advantage

The game uses 3 independent six-sided dice, yielding $6^3 = 216$ equally probable sample space outcomes.

For any single chosen symbol $S$:
1. **0 matches ($M=0$)**:
   $$\left(\frac{5}{6}\right)^3 = \frac{125}{216} \approx 57.8704\%$$
2. **1 match ($M=1$)**:
   $$\binom{3}{1} \times \left(\frac{1}{6}\right)^1 \times \left(\frac{5}{6}\right)^2 = 3 \times \frac{25}{216} = \frac{75}{216} \approx 34.7222\%$$
3. **2 matches ($M=2$)**:
   $$\binom{3}{2} \times \left(\frac{1}{6}\right)^2 \times \left(\frac{5}{6}\right)^1 = 3 \times \frac{5}{216} = \frac{15}{216} \approx 6.9444\%$$
4. **3 matches ($M=3$)**:
   $$\binom{3}{3} \times \left(\frac{1}{6}\right)^3 = 1 \times \frac{1}{216} = \frac{1}{216} \approx 0.4630\%$$

#### Expected Value ($EV$) Calculation:
$$\mathbb{E}[\text{Net Profit per \$1 Bet}] = \left(-1 \times \frac{125}{216}\right) + \left(+1 \times \frac{75}{216}\right) + \left(+2 \times \frac{15}{216}\right) + \left(+3 \times \frac{1}{216}\right)$$

$$\mathbb{E} = \frac{-125 + 75 + 30 + 3}{216} = \frac{-17}{216} \approx -0.078704 \text{ (or } -7.8704\%)$$

- **Theoretical House Edge**: **7.87%**
- **Return to Player (RTP)**: **92.13%**

---

## 4. Comprehensive Bilingual Glossary (Khmer Unicode & English Pairings)

All UI strings, labels, status alerts, and ARIA announcements must follow exact Khmer Unicode typography and grammatical standards.

### 4.1 Core Game Titles & Identifiers
| Key / UI ID | English Text | Khmer Unicode | Phonetic / Notes |
|:---|:---|:---|:---|
| `app.title` | Kla-Klok | ខ្លាឃ្លោក | Traditional name |
| `app.subtitle` | Khmer Traditional Animal Dice Game | ល្បែងគ្រាប់ឡុកឡាក់សត្វប្រពៃណីខ្មែរ | Formal subtitle |
| `app.tagline` | Test your luck with Cambodia's classic festival game | សាកល្បងសំណាងរបស់អ្នកជាមួយល្បែងបុណ្យប្រពៃណីខ្មែរ | Marketing/Header tagline |

### 4.2 Game Symbols & Dice Faces
| Key / UI ID | English Label | Khmer Unicode | IPA Romanization | Short Description |
|:---|:---|:---|:---|:---|
| `symbol.tiger` | Tiger | ខ្លា | *Kla* | Lord of the forest (Bravery & Power) |
| `symbol.gourd` | Gourd | ឃ្លោក | *Klok* | Calabash gourd (Health & Abundance) |
| `symbol.shrimp` | Shrimp | បង្កង | *Bongkang* | River prawn (Agility & Prosperity) |
| `symbol.fish` | Fish | ត្រី | *Trey* | Freshwater fish (Wealth & Abundance) |
| `symbol.crab` | Crab | ក្តាម | *Kdam* | Mud crab (Tenacity & Good harvest) |
| `symbol.rooster` | Rooster | មាន់ | *Moan* | Morning rooster (Vigilance & Fortune) |

### 4.3 Betting Board & Financial Controls
| Key / UI ID | English Label | Khmer Unicode | Context / Usage |
|:---|:---|:---|:---|
| `wallet.balance` | Balance | សមតុល្យ | Header / Wallet card |
| `wallet.current_balance` | Current Balance | សមតុល្យបច្ចុប្បន្ន | Detailed balance view |
| `wallet.chips` | Betting Chips | កាក់ភ្នាល់ | Chip selector area |
| `bet.place_bet` | Place Your Bets | សូមដាក់ប្រាក់ភ្នាល់ | Instruction banner |
| `bet.total_bet` | Total Bet | ប្រាក់ភ្នាល់សរុប | Total wagered this round |
| `bet.stake` | Stake | ប្រាក់ដើម | Initial bet amount |
| `bet.payout` | Payout | ប្រាក់រង្វាន់ | Total payout returned |
| `bet.profit` | Net Profit | ប្រាក់ចំណេញសុទ្ធ | Profit above original stake |
| `bet.multiplier` | Multiplier | មេគុណ | Match multiplier indicator |
| `bet.clear` | Clear Bets | លុបការភ្នាល់ | Reset all active bets button |
| `bet.double` | Double Bets (2x) | គុណនឹងពីរ (2x) | Double current active bets |
| `bet.rebet` | Rebet Last | ភ្នាល់ដូចមុន | Repeat previous round's bets |
| `bet.max` | Max Bet | ភ្នាល់អតិបរមា | Set maximum bet limit |
| `bet.min` | Min Bet | ភ្នាល់អប្បបរមា | Minimum permitted bet ($1) |

### 4.4 Actions, Controls & Buttons
| Key / UI ID | English Label | Khmer Unicode | Context / Usage |
|:---|:---|:---|:---|
| `action.roll` | Roll Dice | ក្រឡុកគ្រាប់ឡុកឡាក់ | Primary action button |
| `action.shake` | Shake | ក្រឡុក | Short action label |
| `action.rolling` | Shaking... | កំពុងក្រឡុក... | Button loading state |
| `action.reveal` | Reveal Dice | បើកគម្រប | Interactive cup lifting |
| `action.new_round` | New Round | ជុំថ្មី | Start next round |
| `action.reset_game` | Reset Game | កំណត់ឡើងវិញ | Reset game & balance |
| `action.sound_on` | Sound On | បើកសំឡេង | Audio toggle |
| `action.sound_off` | Sound Off | បិទសំឡេង | Audio toggle |
| `action.rules` | Rules & Paytable | ច្បាប់ និង តារាងរង្វាន់ | Help modal trigger |
| `action.history` | Game History | ប្រវត្តិការលេង | History panel toggle |
| `action.language` | Language | ភាសា | Locale selector (KM / EN) |

### 4.5 Game Status, Outcomes & Multiplier Badges
| Key / UI ID | English Label | Khmer Unicode | Context / Usage |
|:---|:---|:---|:---|
| `status.waiting_bets` | Awaiting Bets | រង់ចាំការដាក់ប្រាក់ភ្នាល់ | Idle stage |
| `status.rolling` | Rolling in progress... | កំពុងក្រឡុកគ្រាប់ឡុកឡាក់... | Dice in motion |
| `status.win` | Winner! | ឈ្នះហើយ! | Winning celebratory banner |
| `status.loss` | No Matches | មិនត្រូវទេ | Loss banner |
| `status.big_win` | Big Win! | ឈ្នះរង្វាន់ធំ! | Double match win |
| `status.jackpot` | Triple Jackpot! | មហាសំណាង ៣ ជាន់! | Triple match win |
| `badge.single` | 1x (1:1) | ត្រូវ ១ (សង ១:១) | 1 match badge |
| `badge.double` | 2x (2:1) | ត្រូវ ២ (សង ២:១) | 2 match badge |
| `badge.triple` | 3x (3:1) | ត្រូវ ៣ (សង ៣:១) | 3 match badge |
| `history.round` | Round # | ជុំទី {n} | History table round column |
| `history.outcome` | Outcome | លទ្ធផល | History table dice results |
| `history.win_loss` | Win / Loss | ឈ្នះ / ចាញ់ | History net profit/loss |
| `history.empty` | No games played yet. | មិនទាន់មានប្រវត្តិលេងនៅឡើយទេ។ | Empty state |

### 4.6 Accessibility & ARIA Announcements (`aria-live="polite"` & `aria-live="assertive"`)
| Key / UI ID | English Screen Reader Text | Khmer Screen Reader Text |
|:---|:---|:---|
| `aria.welcome` | "Welcome to Kla-Klok Khmer Dice Game. Current balance: ${balance}. Please select chips and place your bets on the board." | "សូមស្វាគមន៍មកកាន់ល្បែងគ្រាប់ឡុកឡាក់ខ្មែរខ្លាឃ្លោក។ សមតុល្យបច្ចុប្បន្ន៖ ${balance} ដុល្លារ។ សូមជ្រើសរើសកាក់ និងដាក់ប្រាក់ភ្នាល់លើក្ដារ។" |
| `aria.bet_added` | "Placed ${amount} on {symbol}. Total bet on {symbol} is now ${total}." | "បានដាក់ប្រាក់ ${amount} លើ {symbol}។ ប្រាក់ភ្នាល់សរុបលើ {symbol} គឺ ${total}។" |
| `aria.bet_cleared` | "Cleared all bets. Balance restored to ${balance}." | "បានលុបការភ្នាល់ទាំងអស់។ សមតុល្យត្រូវបានប្រគល់ត្រឡប់មកវិញចំនួន ${balance}។" |
| `aria.rolling` | "Dice are shaking inside the cup. Please wait..." | "គ្រាប់ឡុកឡាក់កំពុងត្រូវបានក្រឡុកក្នុងគម្រប។ សូមរង់ចាំ..." |
| `aria.dice_result` | "Dice roll result: Die 1 is {d1}, Die 2 is {d2}, Die 3 is {d3}." | "លទ្ធផលគ្រាប់ឡុកឡាក់៖ គ្រាប់ទី១ គឺ {d1}, គ្រាប់ទី២ គឺ {d2}, គ្រាប់ទី៣ គឺ {d3}។" |
| `aria.round_win` | "Congratulations! You won ${payout} with a net profit of ${profit}. Your new balance is ${balance}." | "សូមអបអរសាទរ! អ្នកបានឈ្នះ ${payout} ដោយមានប្រាក់ចំណេញសុទ្ធ ${profit}។ សមតុល្យថ្មីរបស់អ្នកគឺ ${balance}។" |
| `aria.round_loss` | "No winning bets this round. You lost ${loss}. Your new balance is ${balance}." | "គ្មានការភ្នាល់ណាដែលត្រូវទេក្នុងជុំនេះ។ អ្នកបានបាត់បង់ ${loss}។ សមតុល្យថ្មីរបស់អ្នកគឺ ${balance}។" |
| `aria.insufficient_funds` | "Insufficient balance. You have ${balance} remaining." | "សមតុល្យមិនគ្រប់គ្រាន់ទេ។ អ្នកនៅសល់ត្រឹមតែ ${balance} ប៉ុណ្ណោះ។" |
| `aria.max_bet_exceeded` | "Maximum bet limit reached for {symbol}." | "បានដល់កម្រិតកំណត់នៃការភ្នាល់អតិបរមាសម្រាប់ {symbol} ហើយ។" |

---

## 5. UI/UX Design & Aesthetic Recommendations

1. **Cultural Atmosphere & Visual Motifs**:
   - Background aesthetic: Subtle Khmer traditional kbach (ក្បាច់) borders, warm golden wood textures, or deep festive crimson fabric (`bg-amber-950` / `bg-emerald-950` / `bg-slate-900`).
   - Dice Shaker: Traditional bamboo/coconut bowl or golden metallic ornate cup with realistic 3D shadow and shaking animation.
   - Dice Components: Rounded 3D cubes with high-contrast colored animal badges or engraved stylized illustrations.
   - Chip Components: Casino-style circular chips with embossed rim markers and distinct denominations ($1=White/Silver, $5=Red, $10=Blue, $25=Green, $50=Purple, $100=Black/Gold, $500=Orange).

2. **Typography Guidelines**:
   - English: Inter, Plus Jakarta Sans, or System Sans.
   - Khmer Unicode: **Kantumruy Pro**, **Siemreap**, **Battambang**, or **Noto Sans Khmer** for optimal legibility, diacritic positioning, and rendering across mobile/desktop browsers.

3. **Accessibility (WCAG 2.1 AA Compliance)**:
   - Minimum 4.5:1 color contrast ratio for all symbol tiles, chip labels, and text.
   - Full keyboard navigation (Tab/Shift-Tab, Space/Enter to place bets, 'R' hotkey to roll, 'C' to clear, 'D' to double).
   - High-visibility focus indicators (`ring-2 ring-amber-400 ring-offset-2`).
   - Screen reader live regions (`aria-live="polite"` for roll events and results).

---

## 6. Verification & Implementation Checklist

- [x] All 6 traditional symbols specified with Khmer Unicode, IPA pronunciation, cultural meanings, colors, and iconography.
- [x] Comprehensive payout formulas documented for 0x (loss), 1x (1:1), 2x (2:1), and 3x (3:1) matching dice plus initial stake return.
- [x] Full mathematical probability ($6^3 = 216$), RTP ($92.13\%$), and House Edge ($7.87\%$) analyzed.
- [x] Multi-bet simultaneous payout worked example included.
- [x] Complete bilingual glossary covering 40+ UI labels, actions, multipliers, state badges, and ARIA screen reader announcements.
