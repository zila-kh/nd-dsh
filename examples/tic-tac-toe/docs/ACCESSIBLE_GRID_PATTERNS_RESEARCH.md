# Research: Accessible Grid Interaction Patterns for 3x3 Game Boards

**Project:** Tic-Tac-Toe Beta Acceptance  
**Company:** ND  
**Author:** Researcher (ND Harness)  
**Date:** March 2025  
**Status:** Approved Technical Research Findings  
**Target Specification:** WCAG 2.1 Level AA & Level AAA Keyboard/AT Best Practices  

---

## 1. Executive Summary

This research document evaluates interaction architectures, ARIA design patterns, keyboard navigation paradigms, and screen reader feedback mechanisms for a 3x3 interactive game board (Tic-Tac-Toe).

### Key Decisions & Recommendations
1. **ARIA Pattern Choice:** Use the **Composite Button Matrix Pattern** (`role="region"` / `role="group"` container with 9 semantic `<button>` elements using a 2D **Roving `tabIndex`**) rather than the WAI-ARIA Data Grid (`role="grid"`). This avoids screen reader "application mode" modal lockouts and delivers predictable mobile and desktop assistive technology (AT) behavior.
2. **2D Arrow Key Navigation:** Implement 2D spatial Arrow key navigation (Up/Down/Left/Right) with boundary clamping (no disorienting wrapping), supplemented by `Home` (top-left / cell 0) and `End` (bottom-right / cell 8).
3. **The Focusable Disabled Cell Strategy:** Occupied cells should utilize `aria-disabled="true"` (or remain focusable `<button tabIndex={-1}>` elements) instead of native HTML `disabled` attributes. Native `disabled` removes elements from the tab and arrow navigation sequence, breaking 2D roving tabindex.
4. **Dual ARIA Live Region Architecture:** Employ two distinct visually hidden live regions—`aria-live="polite"` for regular turn notifications and move confirmations, and `aria-live="assertive"` for game endings (Win/Draw), invalid move alerts, and board resets.

---

## 2. ARIA Pattern Comparison: `role="grid"` vs. Button Matrix

When building a 3x3 interactive board, three primary structural patterns exist in web accessibility standards:

```
+------------------------------------------------------------------------------------+
|                               PATTERN COMPARISON                                   |
+------------------------------------+-----------------------------------------------+
| Pattern A: WAI-ARIA Grid           | Pattern B: Button Matrix + Roving Tabindex    |
| role="grid" > role="row" > gridcell| role="region" > 9x <button> with roving index |
+------------------------------------+-----------------------------------------------+
| + Built-in 2D semantic concept     | + Native button semantics preserved in all AT |
| - Triggers "Application Mode" in AT| + Consistent behavior across desktop & mobile|
| - Complex row/cell nesting overhead| + Direct activation with Space and Enter     |
| - Inconsistent mobile VO swipe nav | + Zero risk of screen reader virtual trap     |
+------------------------------------+-----------------------------------------------+
```

### 2.1 Pattern A: The WAI-ARIA Data/Interactive Grid (`role="grid"`)
The WAI-ARIA `grid` composite widget pattern is designed for multi-directional tabular data and spreadsheet-like widgets where cells contain editable data or interactive widgets.

- **Structure Required:**
  ```html
  <div role="grid" aria-label="Tic-Tac-Toe Board">
    <div role="row">
      <div role="gridcell"><button ...>...</button></div>
      <div role="gridcell"><button ...>...</button></div>
      <div role="gridcell"><button ...>...</button></div>
    </div>
    <!-- rows 2 and 3 -->
  </div>
  ```
- **Trade-offs & Assistive Technology Pitfalls:**
  - **Application Mode Forced:** Screen readers (NVDA, JAWS) switch from *Browse Mode* (virtual cursor) to *Focus/Application Mode* when entering `role="grid"`. In application mode, standard screen reader shortcuts are suppressed in favor of author-managed keyboard navigation. While intentional for spreadsheets, for a lightweight 3x3 casual game, users frequently get confused when virtual navigation stops working.
  - **Double Tab Stop / Interactive Cell Ambiguity:** If `gridcell` contains a `<button>`, some screen readers require pressing `Enter` to enter the cell and focus the button before pressing `Space` to activate, introducing redundant keystrokes.
  - **Mobile Screen Reader Friction:** On iOS VoiceOver and Android TalkBack, `role="grid"` can cause verbose row/column announcements that override custom dynamic cell labels, degrading the gameplay flow.

### 2.2 Pattern B: Composite Widget Button Matrix (`role="region"` / `role="group"` + Roving `tabIndex`) — **RECOMMENDED**
This pattern structures the board as an accessible container (`<div role="region" aria-label="Tic-Tac-Toe Game Board">`) enclosing a flat list or CSS grid of 9 semantic `<button>` elements. A custom 2D roving tabindex manages focus across the 3x3 layout.

- **Structure:**
  ```html
  <div role="region" aria-label="Tic-Tac-Toe Board" class="grid grid-cols-3">
    <button type="button" tabIndex={0} aria-label="Row 1, Column 1, Empty">...</button>
    <button type="button" tabIndex={-1} aria-label="Row 1, Column 2, X">...</button>
    ...
  </div>
  ```
- **Why Pattern B is Superior for Tic-Tac-Toe:**
  1. **Native Button Semantics:** `<button>` elements inherently support click, touch, `Enter`, and `Space` activation without custom key listeners or ARIA role polyfilling.
  2. **Single Tab Stop:** The board container consumes exactly **1 Tab stop** in the page's global focus order. Tabbing into the board focuses the active cell; tabbing again exits cleanly to the Next/Restart control.
  3. **No Screen Reader Mode Conflicts:** Screen readers announce the button, its coordinates, and its state immediately without switching into complex spreadsheet interaction modes.
  4. **Simpler DOM & Styling:** Clean 3x3 CSS grid (`display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));`) without requiring dummy row wrapper DOM nodes.

### 2.3 Decision Matrix

| Evaluation Criteria | WAI-ARIA `grid` | Button Matrix (Roving TabIndex) | Native `<table>` with Buttons |
| :--- | :---: | :---: | :---: |
| **Keyboard Nav Simplicity** | Medium (Requires gridcell focus) | **High (Direct button focus)** | Low (Tab-heavy by default) |
| **Screen Reader Verbosity** | High (Row/Col count spam) | **Optimal (Precise aria-label)** | High |
| **Mobile Screen Reader UX** | Inconsistent | **Excellent** | Good |
| **DOM Complexity** | High (13 nodes minimum) | **Low (10 nodes)** | High (14 nodes minimum) |
| **WCAG 2.1 AA Compliance** | Compliant | **Compliant (Best Practice)** | Compliant |
| **Recommendation** | Not Recommended | **Primary Recommended Architecture** | Alternative Only |

---

## 3. Keyboard Navigation & 2D Focus Management

### 3.1 2D Grid Mapping & Coordinate Calculations
The 9 cells are indexed from `0` to `8`:
```
       Col 1 (c=0)    Col 2 (c=1)    Col 3 (c=2)
Row 1:   Cell 0         Cell 1         Cell 2
Row 2:   Cell 3         Cell 4         Cell 5
Row 3:   Cell 6         Cell 7         Cell 8
```

- **Row Formula:** `row = Math.floor(index / 3)` (0-indexed) or `Math.floor(index / 3) + 1` (1-indexed)
- **Column Formula:** `col = index % 3` (0-indexed) or `(index % 3) + 1` (1-indexed)
- **Index Formula:** `index = row * 3 + col`

### 3.2 Key Bindings & Navigation Logic

```typescript
switch (event.key) {
  case 'ArrowRight':
    event.preventDefault();
    // Clamped boundary navigation within same row
    if (col < 2) setFocus(index + 1);
    break;

  case 'ArrowLeft':
    event.preventDefault();
    if (col > 0) setFocus(index - 1);
    break;

  case 'ArrowDown':
    event.preventDefault();
    // Move down 1 row (index + 3)
    if (row < 2) setFocus(index + 3);
    break;

  case 'ArrowUp':
    event.preventDefault();
    // Move up 1 row (index - 3)
    if (row > 0) setFocus(index - 3);
    break;

  case 'Home':
    event.preventDefault();
    // Jump to top-left cell (index 0) or start of current row
    setFocus(event.ctrlKey ? 0 : row * 3);
    break;

  case 'End':
    event.preventDefault();
    // Jump to bottom-right cell (index 8) or end of current row
    setFocus(event.ctrlKey ? 8 : row * 3 + 2);
    break;

  case 'PageUp':
    event.preventDefault();
    setFocus(col); // Jump to top row, same column
    break;

  case 'PageDown':
    event.preventDefault();
    setFocus(6 + col); // Jump to bottom row, same column
    break;
}
```

### 3.3 Boundary Behavior: Clamping vs. Wrapping
- **Clamping (Recommended):** Pressing `ArrowRight` on Cell 2 (top-right) does nothing. This matches physical spatial navigation and mental models of a bounded 2D board.
- **Wrapping (Discouraged):** Wrapping `ArrowRight` from Cell 2 to Cell 3 (top-right to middle-left) feels like reading text rather than traversing a spatial grid, leading to accidental moves and cognitive disorientation for blind and low-vision players.

### 3.4 The "Disabled Button" Trap & Resolution
A common anti-pattern in accessible game development is applying the HTML `disabled` attribute to occupied cells:
```html
<!-- ANTI-PATTERN: Breaks arrow key navigation -->
<button disabled>X</button>
```
**Why this fails:** A natively `disabled` button cannot receive programmatic focus (`element.focus()`) in modern browsers. If a user presses `ArrowRight` from an empty cell onto a disabled cell, focus is lost, jumping to the document `<body>`.

**The Solution (`aria-disabled="true"`):**
1. Keep the button natively focusable with `tabIndex={isFocused ? 0 : -1}`.
2. Mark occupied or game-over cells with `aria-disabled="true"`.
3. Style the button with disabled aesthetics (`cursor-not-allowed`, muted opacity).
4. Guard the click/activation handler:
   ```typescript
   const handleCellClick = (index: number) => {
     if (board[index] !== null || isGameOver) {
       announceAssertive(`Invalid move: Row ${row}, Column ${col} is already occupied by ${board[index]}.`);
       return;
     }
     makeMove(index);
   };
   ```

### 3.5 Dynamic Focus Management across Game States
1. **Move Execution:** When a player marks a cell, focus must remain on that same cell. Do not reset focus to cell 0 or move focus away.
2. **Game Reset / Restart:** When the user clicks "Restart" or triggers `Alt + R`, focus must be smoothly returned to `Cell 0` (Row 1, Column 1), accompanied by an assertive announcement.
3. **Time-Travel History Replay:** When selecting a historical move from the step list, focus remains on the clicked history button, while the board visual updates. If the user subsequently tabs to the board, focus lands on the cell corresponding to that historical step.

---

## 4. Screen Reader Strategy & ARIA Live Announcements

### 4.1 Dual Live Region Architecture

To prevent announcement collisions and prioritization drops, maintain two separate live regions:

```
+---------------------------------------------------------------------------------+
|                        DUAL LIVE REGION ANNOUNCEMENT FLOW                       |
+---------------------------------------------------------------------------------+
|  [Polite Announcer]                                                             |
|  role="status" | aria-live="polite" | aria-atomic="true"                        |
|  - Turn indicator changes ("Player O's turn")                                   |
|  - Valid move confirmation ("Player X marked Row 2, Column 2. Player O's turn")|
|  - History jump notifications ("Jumped to move 3")                             |
+---------------------------------------------------------------------------------+
|  [Assertive Announcer]                                                          |
|  role="alert" | aria-live="assertive" | aria-atomic="true"                      |
|  - Victory announcements ("Game Over! Player X wins on Main Diagonal!")         |
|  - Stalemate / Draw announcements ("Game Over! It's a draw!")                   |
|  - Occupied cell warning ("Square already occupied by X")                       |
|  - Game reset confirmation ("Game reset. New match started.")                   |
+---------------------------------------------------------------------------------+
```

### 4.2 Cell Accessible Name Formula

Every cell button must have an explicit, self-contained `aria-label` that conveys its coordinate, mark status, and victory state:

| Cell State | Mark | Example `aria-label` |
| :--- | :--- | :--- |
| **Empty** | `null` | `"Row 1, Column 1, Empty"` |
| **Occupied by X** | `'X'` | `"Row 2, Column 2, X"` |
| **Occupied by O** | `'O'` | `"Row 3, Column 1, O"` |
| **Winning Trio** | `'X'` | `"Row 1, Column 1, X, Winning square"` |

### 4.3 Screen Reader Announcement Copy Specifications

```
+---------------------------------------------------------------------------------------------+
| EVENT TRIGGER          | REGION    | EXACT ANNOUNCEMENT MESSAGE                             |
+------------------------+-----------+--------------------------------------------------------+
| Board Ready            | polite    | "Tic-Tac-Toe ready. Player X's turn. Use arrow keys to  |
|                        |           | navigate the 3 by 3 board, Space or Enter to place."    |
+------------------------+-----------+--------------------------------------------------------+
| Valid Move Made        | polite    | "Player {X|O} marked Row {r}, Column {c}.               |
|                        |           | Player {NextPlayer}'s turn."                           |
+------------------------+-----------+--------------------------------------------------------+
| Occupied Cell Clicked  | assertive | "Invalid move: Row {r}, Column {c} is already occupied  |
|                        |           | by {Mark}. Please select an empty square."             |
+------------------------+-----------+--------------------------------------------------------+
| Victory                | assertive | "Game Over! Player {Winner} wins with three in a row   |
|                        |           | on {LineDescription}! Press Restart to play again."    |
+------------------------+-----------+--------------------------------------------------------+
| Draw / Stalemate       | assertive | "Game Over! It's a draw! All 9 squares are filled with |
|                        |           | no winner. Press Restart to play again."               |
+------------------------+-----------+--------------------------------------------------------+
| History Jump           | polite    | "Jumped to Move {Step} ({Player} at Row {r}, Col {c}).  |
|                        |           | Board updated. Player {NextPlayer}'s turn."            |
+------------------------+-----------+--------------------------------------------------------+
| Game Reset             | assertive | "Game reset. New match started. Player X's turn.        |
|                        |           | Focused on Row 1, Column 1."                           |
+------------------------+-----------+--------------------------------------------------------+
```

### 4.4 Live Region Race Condition Mitigations
1. **DOM Container Recycling / Unique Key Updates:** Screen readers sometimes fail to announce repeated messages if the text content does not change. Solution: Append invisible non-breaking spaces or timestamp tokens or update React state keys to force DOM mutation events.
2. **Dedicated CSS Screen Reader Only Utility:**
   ```css
   .sr-only {
     position: absolute;
     width: 1px;
     height: 1px;
     padding: 0;
     margin: -1px;
     overflow: hidden;
     clip: rect(0, 0, 0, 0);
     white-space: nowrap;
     border: 0;
   }
   ```

---

## 5. React TypeScript Architecture & Implementation Contracts

### 5.1 Custom Hook: `useRovingGridFocus`
A reusable, type-safe React hook managing 2D grid coordinates and keybindings:

```typescript
import { useState, useRef, useCallback, KeyboardEvent } from 'react';

export interface UseRovingGridFocusOptions {
  gridSize?: number; // 3 for 3x3
  cellCount?: number; // 9
  onActivate?: (index: number) => void;
}

export function useRovingGridFocus({
  gridSize = 3,
  cellCount = 9,
  onActivate,
}: UseRovingGridFocusOptions = {}) {
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const registerRef = useCallback((index: number) => (el: HTMLButtonElement | null) => {
    cellRefs.current[index] = el;
  }, []);

  const focusCell = useCallback((index: number) => {
    const clampedIndex = Math.max(0, Math.min(index, cellCount - 1));
    setFocusedIndex(clampedIndex);
    cellRefs.current[clampedIndex]?.focus();
  }, [cellCount]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const row = Math.floor(index / gridSize);
    const col = index % gridSize;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        if (col < gridSize - 1) focusCell(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (col > 0) focusCell(index - 1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (row < gridSize - 1) focusCell(index + gridSize);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (row > 0) focusCell(index - gridSize);
        break;
      case 'Home':
        event.preventDefault();
        focusCell(event.ctrlKey ? 0 : row * gridSize);
        break;
      case 'End':
        event.preventDefault();
        focusCell(event.ctrlKey ? cellCount - 1 : row * gridSize + (gridSize - 1));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onActivate?.(index);
        break;
      default:
        break;
    }
  }, [gridSize, cellCount, focusCell, onActivate]);

  return {
    focusedIndex,
    setFocusedIndex,
    focusCell,
    registerRef,
    handleKeyDown,
  };
}
```

### 5.2 Cell Button Component Accessibility Contract

```typescript
export interface CellButtonProps {
  index: number;
  value: 'X' | 'O' | null;
  isWinningCell: boolean;
  isFocused: boolean;
  isGameOver: boolean;
  onClick: (index: number) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}
```

---

## 6. Verification & Accessibility Testing Matrix

| Testing Method | Verification Focus | Target Metric |
| :--- | :--- | :--- |
| **Axe-core Automated Audit** | `color-contrast`, `aria-roles`, `aria-allowed-attr`, `button-name` | **0 Violations (WCAG 2.1 AA)** |
| **NVDA + Firefox/Chrome (Windows)** | 2D arrow keys, live region announcements on turn/win/draw | **Smooth announcements, no dropped alerts** |
| **VoiceOver + Safari (macOS)** | `tabIndex` focus ring, `aria-label` reading, `Space`/`Enter` | **Correct coordinate & mark narration** |
| **Keyboard Only (No Mouse)** | 100% full game match, history jump, reset, focus return | **Zero focus traps, complete navigability** |

---

## 7. Conclusion & Next Steps for Engineering

1. **Adopt Composite Button Matrix (`role="region"` + roving tabindex)** as the standard board pattern.
2. **Enforce `aria-disabled="true"`** instead of HTML `disabled` on occupied cells to preserve 2D arrow navigation.
3. **Implement the `useRovingGridFocus` hook** and connect to the dual live region announcer.
4. **Proceed to Phase 3 Component Development** with these verified accessibility contracts.
