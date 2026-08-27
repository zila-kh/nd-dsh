# Product Requirements Document (PRD) & Accessibility Specification
## Project: Tic-Tac-Toe Beta Acceptance
**Company:** ND  
**Document Version:** 1.0.0  
**Author:** AI Product Manager (ND Harness)  
**Status:** Approved / Ready for Engineering  
**Target Platform:** Web (React 18+, TypeScript, Tailwind CSS / Vanilla CSS, Vitest, Playwright)

---

## 1. Executive Summary & Objective

### 1.1 Objective
Deliver a production-ready, highly polished, zero-barrier accessible React TypeScript Tic-Tac-Toe web application that adheres to WCAG 2.1 AA accessibility guidelines, provides rich visual and audible feedback, supports keyboard navigation (including 2D grid roving tabindex), provides time-travel move history replay, and exhibits rock-solid state management and test coverage.

### 1.2 Success Metrics & Acceptance Criteria
- **Functional Completeness:** Full 3x3 grid gameplay, accurate win/draw detection across all 8 lines, move undo/history jump, and seamless reset flow.
- **Visual Polish:** Responsive, modern design with clear active turn indicators, distinct player token aesthetics, high-contrast winning line highlights, and fluid micro-animations.
- **Accessibility Conformance:** 100% WCAG 2.1 AA compliance verified via automated testing (axe-core) and manual screen reader audits (NVDA, VoiceOver, JAWS).
- **Keyboard Usability:** Full arrow-key 2D grid navigation, Home/End shortcut keys, Enter/Space activation, and global shortcut keys for reset and undo/redo.
- **Auditory Clarity:** ARIA live region announcements for turn transitions, moves, invalid attempts, win/draw events, time-travel jumps, and board resets.

---

## 2. Game Mechanics & State Specifications

### 2.1 Grid Layout & Coordinate System
The game is played on a 3x3 matrix representing 9 cells indexed `0` through `8`:
```
   Col 0   Col 1   Col 2
Row 0:  [ 0 ] | [ 1 ] | [ 2 ]
       -------+-------+-------
Row 1:  [ 3 ] | [ 4 ] | [ 5 ]
       -------+-------+-------
Row 2:  [ 6 ] | [ 7 ] | [ 8 ]
```
- **Coordinate Mapping:**
  - Index `i` maps to `Row = Math.floor(i / 3) + 1` and `Column = (i % 3) + 1`.
  - Grid cell coordinates:
    - Index 0: Top-Left (Row 1, Column 1)
    - Index 1: Top-Center (Row 1, Column 2)
    - Index 2: Top-Right (Row 1, Column 3)
    - Index 3: Middle-Left (Row 2, Column 1)
    - Index 4: Center (Row 2, Column 2)
    - Index 5: Middle-Right (Row 2, Column 3)
    - Index 6: Bottom-Left (Row 3, Column 1)
    - Index 7: Bottom-Center (Row 3, Column 2)
    - Index 8: Bottom-Right (Row 3, Column 3)

### 2.2 Players & Move Execution
- **Player Marks:**
  - Player 1: Mark **`X`** (Starts the game by default).
  - Player 2: Mark **`O`**.
- **Rules:**
  1. A player may only place a mark on an empty cell (`null`).
  2. Clicking or pressing `Enter`/`Space` on an already occupied cell is a no-op visually, but triggers an accessible assistive notification informing the user that the cell is occupied.
  3. Once placed, a cell's mark cannot be changed or removed except by time-travel history replay or full game reset.
  4. The game alternates turns between `X` and `O` until a win or draw condition is reached.
  5. After the game ends (Win or Draw), no further marks may be placed on the grid.

### 2.3 Win Conditions & Line Detection
There are 8 predefined winning triplets of cell indices:
1. **Horizontal Rows (3):**
   - Row 1: `[0, 1, 2]` ("Top row")
   - Row 2: `[3, 4, 5]` ("Middle row")
   - Row 3: `[6, 7, 8]` ("Bottom row")
2. **Vertical Columns (3):**
   - Column 1: `[0, 3, 6]` ("Left column")
   - Column 2: `[1, 4, 7]` ("Middle column")
   - Column 3: `[2, 5, 8]` ("Right column")
3. **Diagonals (2):**
   - Main Diagonal: `[0, 4, 8]` ("Top-left to bottom-right diagonal")
   - Anti-Diagonal: `[2, 4, 6]` ("Top-right to bottom-left diagonal")

**Win Evaluation:**
After every valid move, the engine checks all 8 triplets. If all three cells in any triplet match the current player's mark:
- `winner = Player ('X' | 'O')`
- `winningLine = [indexA, indexB, indexC]`
- `status = 'won'`
- Winning cells are highlighted with celebratory styling and an accessible status update is broadcast.

### 2.4 Draw / Stalemate Conditions
- If all 9 cells are occupied (`board.every(cell => cell !== null)`) and no winning line is detected:
  - `status = 'draw'`
  - `winner = null`
  - `winningLine = null`
- A draw banner is displayed with a call to restart.

---

## 3. User Experience (UX) & UI Design Specifications

### 3.1 Turn Indicator UX
- **Position & Visual Hierarchy:**
  - Located prominently above the 3x3 game board in the header/status card.
  - Displays dynamic status:
    - In progress: `"Player X's turn"` or `"Player O's turn"`.
    - Won: `"🎉 Player X wins!"` or `"🎉 Player O wins!"`.
    - Draw: `"🤝 Game ended in a draw!"`.
- **Token Differentiation:**
  - `X`: Rendered in crisp primary indigo/blue with a modern geometric cross icon.
  - `O`: Rendered in vibrant amber/emerald with a clean geometric ring icon.
  - Shape, typography, and color are all distinct (satisfying WCAG 1.4.1 non-color-only distinction).
- **Animation & Visual Feedback:**
  - Active turn pill gently pulses or exhibits a subtle scale highlight.
  - Active player card is styled with an elevated shadow and border contrast.

### 3.2 3x3 Game Board & Cell UX
- **Dimensions & Responsive Behavior:**
  - Square aspect ratio (`aspect-square`), max width `420px` on desktop, fluid scaling down to `300px` on mobile screens.
  - 3x3 CSS Grid with consistent gap (`gap-3` / `12px`).
- **Cell States & Interactions:**
  - **Empty Cell (Default):** Subtle border, clean neutral background, slight hover elevation and translucent ghost preview of current player's mark (`X` or `O`).
  - **Occupied Cell:** Solid token icon with entrance scale-in animation (`animate-scale-in`), high contrast text/icon.
  - **Winning Cell (Victory State):** Distinct glowing background (emerald/amber glow), prominent border accent, and continuous subtle pulse animation.
  - **Disabled Cell:** Non-interactive cursor when game is over or cell is filled.

### 3.3 Winning Line Highlight UX
- When a victory occurs, the 3 winning cells receive:
  1. Highlight class (`bg-emerald-100 dark:bg-emerald-950 border-emerald-500 text-emerald-700 dark:text-emerald-300`).
  2. Overlay vector line or cell-level indicator indicating the alignment (Row, Column, or Diagonal).
  3. Non-winning cells reduce opacity slightly (`opacity-60`) to draw visual focus to the winning trio.

### 3.4 Move History & Time-Travel Replay UX
- **History Panel:**
  - Positioned adjacent to the board on desktop (2-column layout) and beneath the board on mobile.
  - Ordered list `<ol>` of all game steps:
    - Step 0: `Game Start` (Initial empty board).
    - Step `n`: `Move #n: Player [X|O] at [Row r, Col c]`.
  - Current active step is visually marked with a badge (`Current step`) and distinct button styling.
- **Time-Travel Jump Behavior:**
  - Clicking any step in the history updates the board state to that exact point in time.
  - If a player jumps back to Step 2 and makes a new move, the future history (Step 3+) is truncated/branched from that point, establishing the new game timeline.
- **Quick-Jump Controls:**
  - "Undo" button (Jump 1 step backward).
  - "Redo" button (Jump 1 step forward, active only when browsing past moves).
  - "Jump to Start" / "Jump to Latest" shortcuts.

### 3.5 Game Reset & Restart Flow
- **Reset Button:**
  - Prominent, easy-to-reach button in the main control bar labeled `"Restart Game"` or `"New Game"`.
  - Features a clean refresh icon (`↺`).
- **Reset Action Mechanics:**
  - Clears the 3x3 board array to `Array(9).fill(null)`.
  - Resets turn back to Player `X`.
  - Resets history stack back to `[Array(9).fill(null)]` and `stepNumber = 0`.
  - Clears winning lines and victory banners.
  - Retains score counters (if match tally mode is enabled).
  - **Focus Management:** Focus is automatically and smoothly returned to the top-left cell (`Cell 0` / Row 1, Col 1) or the board container, and screen reader announces `"Game reset. New game started. Player X's turn."`

---

## 4. Accessibility (A11y) Specifications (WCAG 2.1 AA Compliant)

### 4.1 WCAG 2.1 AA Compliance Matrix

| WCAG Criterion | Level | Implementation in Tic-Tac-Toe |
| :--- | :--- | :--- |
| **1.1.1 Non-text Content** | Level A | All SVG icons (X, O, Restart, Undo) have `aria-hidden="true"` and are accompanied by descriptive text or `aria-label`s. |
| **1.3.1 Info & Relationships** | Level A | Board uses semantic HTML `<div role="region" aria-label="Tic-Tac-Toe Game Board">` containing a grid structure or a semantic button group; Move history uses `<nav aria-label="Move History"><ol>`. |
| **1.3.2 Meaningful Sequence** | Level A | DOM order follows visual and logical order: Game Heading -> Turn Status -> Game Board -> Game Controls -> Move History. |
| **1.4.1 Use of Color** | Level A | Never rely solely on color. `X` and `O` are distinct glyphs; winning cells have text labels ("Winning cell"), borders, and background contrast. |
| **1.4.3 Contrast (Minimum)** | Level AA | Text and icons exceed 4.5:1 contrast against backgrounds; interactive borders and UI components exceed 3:1 contrast against adjacent colors in both light and dark modes. |
| **1.4.4 Resize Text** | Level AA | Supports 200% browser text zoom without clipping or loss of functionality using rem/em responsive units. |
| **1.4.11 Non-text Contrast** | Level AA | Cell borders, focus indicators, and player icons maintain >= 3:1 contrast against surrounding backgrounds. |
| **2.1.1 Keyboard** | Level A | All game actions (cell selection, restart, time-travel, undo/redo) are 100% operable via keyboard. |
| **2.1.2 No Keyboard Trap** | Level A | Keyboard focus can enter and exit all widgets without trapping the user. |
| **2.4.3 Focus Order** | Level A | Focus order is predictable: header -> status -> board cells -> game controls -> history list. |
| **2.4.7 Focus Visible** | Level AA | High-contrast custom focus ring: `outline: 3px solid #2563eb; outline-offset: 2px;` visible on all interactive elements upon keyboard focus (`:focus-visible`). |
| **2.5.3 Label in Name** | Level A | Accessible names match or include visible labels (e.g. "Move #1: X at Row 1, Column 1"). |
| **3.2.1 On Focus** | Level A | Focusing an element does not trigger unexpected state changes or move submissions. |
| **3.2.2 On Input** | Level A | Submitting a move updates game state predictably without disorienting context changes. |
| **4.1.2 Name, Role, Value** | Level A | Cells are `<button>` elements with dynamic `aria-label` describing position and content (e.g. `aria-label="Row 1, Column 1, Empty"` or `aria-label="Row 1, Column 1, X"`). |
| **4.1.3 Status Messages** | Level AA | Uses `aria-live="polite"` for regular turn updates and `aria-live="assertive"` for game endings (Win/Draw) and resets. |

---

### 4.2 Keyboard Navigation & Roving Tabindex Architecture

#### 4.2.1 2D Roving Tabindex Pattern
To provide optimal UX for screen reader and keyboard power users, the 3x3 board implements the **Roving Tabindex** pattern:
- Only **one** cell in the 3x3 board has `tabIndex={0}` at any time; the other 8 cells have `tabIndex={-1}`.
- Pressing `Tab` enters the board at the currently active cell.
- Pressing `Tab` again moves focus cleanly out of the board to the "Restart" button, avoiding 9 tedious tab stops.
- Navigating inside the board is handled via Arrow keys:
  - `ArrowRight`: Move right one column (wraps to next row or stops at boundary).
  - `ArrowLeft`: Move left one column (wraps to previous row or stops at boundary).
  - `ArrowDown`: Move down one row (index + 3).
  - `ArrowUp`: Move up one row (index - 3).
  - `Home`: Jump directly to top-left cell (`index 0`, Row 1, Col 1).
  - `End`: Jump directly to bottom-right cell (`index 8`, Row 3, Col 3).
  - `PageUp` / `PageDown`: Jump to top or bottom row respectively.

#### 4.2.2 Keyboard Shortcut Table

| Key / Shortcut | Target Context | Action |
| :--- | :--- | :--- |
| `Enter` / `Space` | Focused Cell | Place mark (`X` or `O`) in focused empty cell. |
| `Arrow Keys` (↑, ↓, ←, →) | Board Grid | Navigate between the 9 grid squares. |
| `Home` | Board Grid | Move focus to first square (Row 1, Col 1). |
| `End` | Board Grid | Move focus to last square (Row 3, Col 3). |
| `Alt + R` or `R` (when not typing) | Global | Reset game / Start new match. |
| `Ctrl + Z` / `Cmd + Z` | Global | Undo move (step 1 move back in history). |
| `Ctrl + Y` / `Cmd + Shift + Z` | Global | Redo move (step 1 move forward in history). |
| `Tab` / `Shift + Tab` | Global | Move between major UI landmarks. |

---

### 4.3 ARIA Live Region & Screen Reader Announcement Protocol

#### 4.3.1 Live Region Configuration
Two live regions are maintained in the DOM:
1. **Status Announcer (`aria-live="polite"` / `role="status"` / `aria-atomic="true"`):**
   - Handles standard non-urgent state transitions: turn progression, moves played, history jumps.
2. **Alert Announcer (`aria-live="assertive"` / `role="alert"` / `aria-atomic="true"`):**
   - Handles urgent events: Game Won, Game Drawn, Invalid Move Attempt, Game Reset.

#### 4.3.2 Screen Reader Announcement Copy Matrix

| Event Trigger | Live Region Priority | Exact Announcement Message |
| :--- | :--- | :--- |
| **Game Initial Load** | `polite` | `"Tic-Tac-Toe ready. Player X's turn. Use arrow keys to navigate the 3 by 3 board, Space or Enter to place a mark."` |
| **Valid Move Placed (Turn Switch)** | `polite` | `"Player {Player} marked Row {r}, Column {c}. Player {NextPlayer}'s turn."` *(e.g. "Player X marked Row 2, Column 2. Player O's turn.")* |
| **Invalid Move Attempt (Cell Occupied)** | `assertive` | `"Invalid move: Row {r}, Column {c} is already occupied by {Mark}. Please select an empty square."` |
| **Invalid Move Attempt (Game Over)** | `assertive` | `"Game is over. Press New Game or Alt+R to start a new match."` |
| **Game Won** | `assertive` | `"Game Over! Player {Winner} wins with three in a row on {LineDescription}! Press Restart or Alt+R to play again."` *(e.g. "...three in a row on Row 1!")* |
| **Game Draw** | `assertive` | `"Game Over! It's a draw! All 9 squares are filled with no winner. Press Restart or Alt+R to play again."` |
| **Time-Travel Jump** | `polite` | `"Jumped to Move {StepNumber} ({Player} at Row {r}, Column {c}). Board updated. Player {NextPlayer}'s turn."` |
| **Time-Travel to Start** | `polite` | `"Jumped to game start. Board cleared. Player X's turn."` |
| **Game Reset** | `assertive` | `"Game reset. New match started. Player X's turn. Focused on Row 1, Column 1."` |

#### 4.3.3 Cell Button Accessible Name Specification
Every cell button `<button>` dynamically renders an accessible `aria-label`:
- If Empty: `aria-label="Row {r}, Column {c}, Empty"` (e.g. `aria-label="Row 1, Column 1, Empty"`)
- If Occupied: `aria-label="Row {r}, Column {c}, {Mark}"` (e.g. `aria-label="Row 1, Column 1, X"`)
- If Part of Winning Line: `aria-label="Row {r}, Column {c}, {Mark}, Winning square"`
- Button disabled state: `disabled={isGameOver || cell !== null}` with appropriate visual styling.

---

## 5. Technical Architecture & TypeScript Contracts

### 5.1 Core Types Definition (`types/game.ts`)

```typescript
export type Player = 'X' | 'O';

export type CellValue = Player | null;

export type BoardState = [
  CellValue, CellValue, CellValue,
  CellValue, CellValue, CellValue,
  CellValue, CellValue, CellValue
];

export type WinningLine = [number, number, number];

export interface WinResult {
  winner: Player;
  line: WinningLine;
  description: string; // e.g. "Row 1", "Main Diagonal"
}

export type GameStatus = 'in_progress' | 'won' | 'draw';

export interface MoveRecord {
  step: number;
  player: Player;
  cellIndex: number;
  row: number; // 1-indexed (1..3)
  col: number; // 1-indexed (1..3)
  boardSnapshot: BoardState;
}

export interface GameState {
  board: BoardState;
  history: MoveRecord[];
  currentStep: number;
  currentPlayer: Player;
  status: GameStatus;
  winResult: WinResult | null;
  focusedCellIndex: number;
}
```

### 5.2 Winning Line Definitions & Helper Functions

```typescript
export const WINNING_COMBINATIONS: { line: WinningLine; description: string }[] = [
  { line: [0, 1, 2], description: 'Top row (Row 1)' },
  { line: [3, 4, 5], description: 'Middle row (Row 2)' },
  { line: [6, 7, 8], description: 'Bottom row (Row 3)' },
  { line: [0, 3, 6], description: 'Left column (Column 1)' },
  { line: [1, 4, 7], description: 'Middle column (Column 2)' },
  { line: [2, 5, 8], description: 'Right column (Column 3)' },
  { line: [0, 4, 8], description: 'Main diagonal (Top-left to bottom-right)' },
  { line: [2, 4, 6], description: 'Anti-diagonal (Top-right to bottom-left)' },
];

export function calculateWinner(board: BoardState): WinResult | null {
  for (const { line, description } of WINNING_COMBINATIONS) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return {
        winner: board[a] as Player,
        line,
        description,
      };
    }
  }
  return null;
}
```

### 5.3 Component Hierarchy
```
<TicTacToeApp>
  ├── <Header>
  │     ├── <Title />
  │     └── <ThemeToggle />
  ├── <LiveAnnouncer /> (Visually hidden aria-live regions)
  ├── <main className="game-container">
  │     ├── <GameStatusCard>
  │     │     ├── <TurnIndicator />
  │     │     └── <ScoreBoard /> (Optional Match Counter)
  │     ├── <Board> (role="grid" or role="group" aria-label="3 by 3 game board")
  │     │     └── 9x <CellButton /> (Roving tabindex, accessible aria-labels)
  │     ├── <GameControls>
  │     │     ├── <RestartButton />
  │     │     ├── <UndoButton />
  │     │     └── <RedoButton />
  │     └── <MoveHistory>
  │           └── <HistoryList /> (Step-by-step time travel buttons)
  └── <Footer> (Keyboard shortcuts legend)
```

---

## 6. Verification, Testing & QA Strategy

### 6.1 Automated Testing Matrix
1. **Unit & Logic Tests (Vitest):**
   - Win calculation for all 8 lines.
   - Draw detection on full board without winner.
   - Turn switching logic (`X` -> `O` -> `X`).
   - Move history immutability and timeline truncation upon branching.
   - Reset action restores initial state.
2. **Component & Accessibility Tests (React Testing Library + `vitest-axe`):**
   - Automated axe-core accessibility audit on clean board, mid-game, win state, and draw state (0 violations).
   - Verify `aria-live` messages rendered into polite and assertive announcer containers.
   - Verify roving tabindex: ArrowDown from cell 0 moves focus to cell 3 and updates `tabIndex={0}`.
   - Verify pressing `Enter`/`Space` triggers move on empty cell and triggers warning on filled cell.
3. **End-to-End Tests (Playwright):**
   - Full keyboard-only match playthrough from start to win.
   - Full keyboard-only match playthrough to draw.
   - Time-travel jump testing and verification of board DOM state.
   - High contrast / dark mode visual regression checks.

---

## 7. Roadmap & Task Breakdown

| Phase | Milestone | Deliverable |
| :--- | :--- | :--- |
| **Phase 1** | **PRD & A11y Specification** | Completed comprehensive PRD & WCAG 2.1 AA spec documentation (this document). |
| **Phase 2** | **Core Logic & State Machine** | TypeScript types, pure game engine functions, custom `useTicTacToe` hook, unit tests. |
| **Phase 3** | **Accessible UI Components** | Board, Cell, Turn Indicator, History List, Live Announcer, Roving Tabindex hook. |
| **Phase 4** | **Styling & Polish** | Tailwind CSS / CSS Modules, animations, winning line glows, high-contrast themes. |
| **Phase 5** | **Testing & QA Verification** | Vitest suite, axe-core a11y tests, Playwright keyboard e2e tests, Beta Acceptance signoff. |

---

*Sign-off: ND Product Management Team — Ready for Engineering implementation.*
