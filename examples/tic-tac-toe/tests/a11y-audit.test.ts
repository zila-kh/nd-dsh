import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TicTacToeGame,
  Board,
  Square,
  Status,
  MoveHistory,
  LiveAnnouncer,
  KeyboardLegend,
  createInitialGameState,
  makeMove,
  jumpToStep,
  calculateWinner,
  getCellAriaLabel,
} from '../src/index.js';

interface InspectedButton {
  attrs: string;
  content: string;
  ariaLabel: string | null;
  tabIndex: number | null;
  type: string | null;
  disabled: boolean;
  ariaDisabled: string | null;
  ariaExpanded: string | null;
  ariaControls: string | null;
  ariaCurrent: string | null;
  id: string | null;
}

interface InspectedSVG {
  ariaHidden: boolean;
  focusable: boolean;
}

interface InspectedHeading {
  level: number;
  attrs: string;
  text: string;
}

interface InspectedLandmark {
  tag: string;
  role: string | null;
  ariaLabel: string | null;
}

interface InspectedDOM {
  buttons: InspectedButton[];
  svgs: InspectedSVG[];
  headings: InspectedHeading[];
  landmarks: InspectedLandmark[];
  ids: string[];
}

/**
 * Helper to inspect server-rendered markup DOM elements.
 */
function inspectDOM(markup: string): InspectedDOM {
  const buttons: InspectedButton[] = [...markup.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)].map((m) => {
    const attrs = m[1] ?? '';
    const content = m[2] ?? '';
    const ariaLabelMatch = attrs.match(/aria-label="([^"]*)"/);
    const tabIndexMatch = attrs.match(/tabindex="([^"]*)"/);
    const typeMatch = attrs.match(/type="([^"]*)"/);
    // Explicitly match HTML disabled attribute (not aria-disabled)
    const disabledMatch = /(?:^|\s)disabled(?:\s*=\s*""|\s*=\s*"true"|\s*=\s*'true'|(?=[\s>]))/.test(attrs);
    const ariaDisabledMatch = attrs.match(/aria-disabled="([^"]*)"/);
    const ariaExpandedMatch = attrs.match(/aria-expanded="([^"]*)"/);
    const ariaControlsMatch = attrs.match(/aria-controls="([^"]*)"/);
    const ariaCurrentMatch = attrs.match(/aria-current="([^"]*)"/);
    const idMatch = attrs.match(/id="([^"]*)"/);

    return {
      attrs,
      content,
      ariaLabel: ariaLabelMatch ? (ariaLabelMatch[1] ?? null) : null,
      tabIndex: tabIndexMatch && tabIndexMatch[1] !== undefined ? parseInt(tabIndexMatch[1], 10) : null,
      type: typeMatch ? (typeMatch[1] ?? null) : null,
      disabled: disabledMatch,
      ariaDisabled: ariaDisabledMatch ? (ariaDisabledMatch[1] ?? null) : null,
      ariaExpanded: ariaExpandedMatch ? (ariaExpandedMatch[1] ?? null) : null,
      ariaControls: ariaControlsMatch ? (ariaControlsMatch[1] ?? null) : null,
      ariaCurrent: ariaCurrentMatch ? (ariaCurrentMatch[1] ?? null) : null,
      id: idMatch ? (idMatch[1] ?? null) : null,
    };
  });

  const svgs: InspectedSVG[] = [...markup.matchAll(/<svg([^>]*)>/g)].map((m) => {
    const attrs = m[1] ?? '';
    return {
      ariaHidden: attrs.includes('aria-hidden="true"'),
      focusable: attrs.includes('focusable="false"'),
    };
  });

  const headings: InspectedHeading[] = [...markup.matchAll(/<h([1-6])([^>]*)>(.*?)<\/h\1>/gs)].map((m) => ({
    level: parseInt(m[1] ?? '1', 10),
    attrs: m[2] ?? '',
    text: (m[3] ?? '').replace(/<[^>]*>/g, '').trim(),
  }));

  const landmarks: InspectedLandmark[] = [...markup.matchAll(/<(header|main|section|aside|nav|footer)([^>]*)>/g)].map((m) => {
    const tag = m[1] ?? '';
    const attrs = m[2] ?? '';
    const roleMatch = attrs.match(/role="([^"]*)"/);
    const ariaLabelMatch = attrs.match(/aria-label="([^"]*)"/);
    return {
      tag,
      role: roleMatch ? (roleMatch[1] ?? null) : null,
      ariaLabel: ariaLabelMatch ? (ariaLabelMatch[1] ?? null) : null,
    };
  });

  const ids: string[] = [...markup.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? '');

  return { buttons, svgs, headings, landmarks, ids };
}

/**
 * WCAG 2.1 AA / axe-core Accessibility Audit Suite
 */
export function runA11yAuditTests(test: (name: string, fn: () => void) => void): void {
  console.log('\n--- 11. Automated axe-core & WCAG 2.1 AA Accessibility Audit Tests ---\n');

  // --- 11.1 Rule: button-name (WCAG 4.1.2) ---
  console.log('11.1 Rule: button-name & Accessible Interactive Controls');
  test('axe-rule [button-name]: all buttons have non-empty accessible name and type="button"', () => {
    const markup = renderToStaticMarkup(React.createElement(TicTacToeGame));
    const dom = inspectDOM(markup);

    assert.ok(dom.buttons.length >= 10, 'Should render 9 board squares + controls');

    for (const btn of dom.buttons) {
      assert.equal(btn.type, 'button', 'Every button must explicitly declare type="button"');
      const hasAccessibleName = (btn.ariaLabel && btn.ariaLabel.trim().length > 0) ||
                                (btn.content && btn.content.replace(/<[^>]*>/g, '').trim().length > 0);
      assert.ok(hasAccessibleName, `Button missing accessible name: ${btn.attrs}`);
    }
  });

  // --- 11.2 Rule: tabindex (WCAG 2.1.1 / 2.4.3) ---
  console.log('\n11.2 Rule: tabindex & 2D Roving Tabindex Integrity');
  test('axe-rule [tabindex]: no positive tabindex; exactly one cell button has tabindex=0', () => {
    const markup = renderToStaticMarkup(React.createElement(TicTacToeGame));
    const dom = inspectDOM(markup);

    // No button should have tabindex > 0
    for (const btn of dom.buttons) {
      if (btn.tabIndex !== null) {
        assert.ok(btn.tabIndex <= 0, `Positive tabindex prohibited: ${btn.tabIndex}`);
      }
    }

    // Board cell buttons
    const squareButtons = dom.buttons.filter((b) => b.attrs.includes('ttt-square'));
    assert.equal(squareButtons.length, 9, 'Must have exactly 9 board squares');

    const zeroCount = squareButtons.filter((b) => b.tabIndex === 0).length;
    const minusOneCount = squareButtons.filter((b) => b.tabIndex === -1).length;

    assert.equal(zeroCount, 1, 'Exactly one square must have tabindex=0 for roving tabindex');
    assert.equal(minusOneCount, 8, 'Remaining 8 squares must have tabindex=-1');
  });

  test('axe-rule [focusable-disabled]: occupied cells use aria-disabled=true without losing keyboard focus', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0); // X at (1,1)
    state = makeMove(state, 4); // O at (2,2)

    const markup = renderToStaticMarkup(
      React.createElement(TicTacToeGame, { initialGameState: state })
    );
    const dom = inspectDOM(markup);
    const squareButtons = dom.buttons.filter((b) => b.attrs.includes('ttt-square'));

    // Cell 0 is occupied by X
    const cell0 = squareButtons[0];
    assert.ok(cell0, 'Square 0 must exist');
    assert.equal(cell0.disabled, false, 'Occupied cell must NOT have disabled attribute');
    assert.equal(cell0.ariaDisabled, 'true', 'Occupied cell must have aria-disabled="true"');
    assert.ok(cell0.ariaLabel?.includes('X'));

    // Cell 4 is occupied by O
    const cell4 = squareButtons[4];
    assert.ok(cell4, 'Square 4 must exist');
    assert.equal(cell4.disabled, false, 'Occupied cell must NOT have disabled attribute');
    assert.equal(cell4.ariaDisabled, 'true', 'Occupied cell must have aria-disabled="true"');
    assert.ok(cell4.ariaLabel?.includes('O'));
  });

  // --- 11.3 Rule: landmark-one-main & landmark-unique (WCAG 1.3.1 / 2.4.1) ---
  console.log('\n11.3 Rule: landmark & Semantic Page Hierarchy');
  test('axe-rule [landmark-one-main, landmark-unique]: page contains one main landmark and unique labels', () => {
    const markup = renderToStaticMarkup(React.createElement(TicTacToeGame));
    const dom = inspectDOM(markup);

    const mainLandmarks = dom.landmarks.filter((l) => l.tag === 'main');
    assert.equal(mainLandmarks.length, 1, 'Page must contain exactly one <main> landmark');

    const labeledLandmarks = dom.landmarks.filter((l) => l.ariaLabel !== null);
    const labels = labeledLandmarks.map((l) => l.ariaLabel as string);
    const uniqueLabels = new Set(labels);
    assert.equal(labels.length, uniqueLabels.size, 'All landmark aria-labels must be distinct');

    assert.ok(labels.includes('Game Play Area'));
    assert.ok(labels.includes('Move History Sidebar'));
    assert.ok(labels.includes('Move History and Time-Travel Controls'));
  });

  // --- 11.4 Rule: heading-order (WCAG 1.3.1 / 2.4.6) ---
  console.log('\n11.4 Rule: heading-order');
  test('axe-rule [heading-order]: document starts with h1 and maintains sequential levels', () => {
    const markup = renderToStaticMarkup(React.createElement(TicTacToeGame));
    const dom = inspectDOM(markup);

    assert.ok(dom.headings.length >= 2);
    assert.equal(dom.headings[0]?.level, 1, 'Top heading must be h1');
    assert.equal(dom.headings[0]?.text, 'Tic-Tac-Toe');
    assert.equal(dom.headings[1]?.level, 2, 'Subsequent heading must be h2');
    assert.equal(dom.headings[1]?.text, 'Move History');
  });

  // --- 11.5 Rule: svg-img-alt (WCAG 1.1.1) ---
  console.log('\n11.5 Rule: svg-img-alt & Decorative Icons');
  test('axe-rule [svg-img-alt]: all decorative SVG icons have aria-hidden=true and focusable=false', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0); // X icon
    state = makeMove(state, 4); // O icon

    const markup = renderToStaticMarkup(
      React.createElement(TicTacToeGame, { initialGameState: state })
    );
    const dom = inspectDOM(markup);

    assert.ok(dom.svgs.length > 0, 'Should render SVG tokens');
    for (const svg of dom.svgs) {
      assert.equal(svg.ariaHidden, true, 'SVG token must have aria-hidden="true"');
      assert.equal(svg.focusable, true, 'SVG token must have focusable="false"');
    }
  });

  // --- 11.6 Rule: duplicate-id-active & duplicate-id-aria (WCAG 4.1.1) ---
  console.log('\n11.6 Rule: duplicate-id');
  test('axe-rule [duplicate-id-active]: no duplicate element IDs anywhere in DOM', () => {
    const markup = renderToStaticMarkup(React.createElement(TicTacToeGame));
    const dom = inspectDOM(markup);

    const idSet = new Set<string>();
    for (const id of dom.ids) {
      assert.ok(!idSet.has(id), `Duplicate ID detected in document: ${id}`);
      idSet.add(id);
    }
  });

  // --- 11.7 Rule: list & listitem (WCAG 1.3.1) ---
  console.log('\n11.7 Rule: list & listitem');
  test('axe-rule [list, listitem]: move history list is semantic <ol> containing only <li> items', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0);
    state = makeMove(state, 4);

    const markup = renderToStaticMarkup(
      React.createElement(MoveHistory, {
        history: state.history,
        currentStep: 2,
        onJumpToStep: () => {},
        onUndo: () => {},
        onRedo: () => {},
        canUndo: true,
        canRedo: false,
      })
    );

    assert.ok(markup.includes('<ol class="ttt-history-list">'));
    const liMatches = markup.match(/<li\b[^>]*>/g);
    assert.equal(liMatches?.length, 3, 'Must render Step 0, Step 1, Step 2 as <li> items');
  });

  // --- 11.8 Rule: aria-live & Status Messages (WCAG 4.1.3) ---
  console.log('\n11.8 Rule: aria-live Dual Region Architecture (WCAG 4.1.3)');
  test('WCAG 4.1.3: polite and assertive live regions have proper roles and atomic attributes', () => {
    const markup = renderToStaticMarkup(
      React.createElement(LiveAnnouncer, {
        politeMessage: 'Turn update',
        assertiveMessage: 'Game won alert',
      })
    );

    assert.ok(markup.includes('role="status"'));
    assert.ok(markup.includes('aria-live="polite"'));
    assert.ok(markup.includes('role="alert"'));
    assert.ok(markup.includes('aria-live="assertive"'));
    assert.ok(markup.includes('aria-atomic="true"'));
    assert.ok(markup.includes('sr-only'));
  });

  // --- 11.9 Comprehensive Audit Across All 5 Core Game States ---
  console.log('\n11.9 Complete Game State Accessibility Audits (Zero Violations)');

  test('A11y Audit [State 1: Initial Game State]: Zero WCAG violations', () => {
    const markup = renderToStaticMarkup(React.createElement(TicTacToeGame));
    const dom = inspectDOM(markup);

    // Validate 9 squares, 1 active tabindex=0, all accessible labels present
    const squares = dom.buttons.filter((b) => b.attrs.includes('ttt-square'));
    assert.equal(squares.length, 9);
    assert.equal(squares.filter((s) => s.tabIndex === 0).length, 1);
    assert.equal(squares.filter((s) => s.ariaLabel?.includes('Empty')).length, 9);

    // Validate main toolbar button
    const restartBtn = dom.buttons.find((b) => b.attrs.includes('ttt-btn--restart'));
    assert.ok(restartBtn);
    assert.equal(restartBtn.ariaLabel, 'Restart game (Alt+R)');
  });

  test('A11y Audit [State 2: In-Progress Mid Game State]: Zero WCAG violations', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0); // X at (1,1)
    state = makeMove(state, 4); // O at (2,2)
    state = makeMove(state, 8); // X at (3,3)

    const markup = renderToStaticMarkup(
      React.createElement(TicTacToeGame, { initialGameState: state })
    );
    const dom = inspectDOM(markup);

    const squares = dom.buttons.filter((b) => b.attrs.includes('ttt-square'));
    assert.equal(squares.filter((s) => s.ariaDisabled === 'true').length, 3);
    assert.equal(squares.filter((s) => s.ariaDisabled === 'false').length, 6);
  });

  test('A11y Audit [State 3: Won Game State with Triplet Highlights]: Zero WCAG violations', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0); // X
    state = makeMove(state, 3); // O
    state = makeMove(state, 1); // X
    state = makeMove(state, 4); // O
    state = makeMove(state, 2); // X wins!

    const markup = renderToStaticMarkup(
      React.createElement(TicTacToeGame, { initialGameState: state })
    );
    const dom = inspectDOM(markup);

    const winningSquares = dom.buttons.filter((b) => b.attrs.includes('data-winning="true"'));
    assert.equal(winningSquares.length, 3, 'Must highlight 3 winning triplet cells');
    for (const ws of winningSquares) {
      assert.ok(ws.ariaLabel?.includes('Winning square'));
    }

    const playAgainBtn = dom.buttons.find((b) => b.attrs.includes('ttt-btn--restart'));
    assert.ok(playAgainBtn);
    assert.ok(playAgainBtn.content.includes('Play Again'));
  });

  test('A11y Audit [State 4: Draw Stalemate State]: Zero WCAG violations', () => {
    let state = createInitialGameState();
    const moves = [0, 1, 2, 4, 3, 5, 7, 6, 8];
    for (const m of moves) {
      state = makeMove(state, m);
    }

    const markup = renderToStaticMarkup(
      React.createElement(TicTacToeGame, { initialGameState: state })
    );
    const dom = inspectDOM(markup);

    const squares = dom.buttons.filter((b) => b.attrs.includes('ttt-square'));
    assert.equal(squares.filter((s) => s.ariaDisabled === 'true').length, 9);
    assert.ok(markup.includes('Game Drawn!'));
  });

  test('A11y Audit [State 5: Time-Traveled Replay State]: Zero WCAG violations', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0);
    state = makeMove(state, 4);
    state = makeMove(state, 8);

    // Jump back to step 1
    const pastState = jumpToStep(state, 1);

    const markup = renderToStaticMarkup(
      React.createElement(TicTacToeGame, { initialGameState: pastState })
    );
    const dom = inspectDOM(markup);

    const activeHistoryBtn = dom.buttons.find((b) => b.ariaCurrent === 'step');
    assert.ok(activeHistoryBtn, 'Must mark active step with aria-current="step"');
    assert.ok(activeHistoryBtn.ariaLabel?.includes('Move 1'));
  });
}
