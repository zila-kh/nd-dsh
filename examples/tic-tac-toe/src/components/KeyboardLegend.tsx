import React, { useState } from 'react';

export function KeyboardLegend(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="ttt-keyboard-legend-wrapper">
      <button
        type="button"
        className="ttt-btn ttt-btn--ghost ttt-btn--sm ttt-keyboard-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls="ttt-shortcuts-panel"
      >
        <span className="ttt-btn-icon" aria-hidden="true">⌨</span>
        <span>{isOpen ? 'Hide Keyboard Shortcuts' : 'Keyboard Shortcuts'}</span>
      </button>

      {isOpen && (
        <div
          id="ttt-shortcuts-panel"
          className="ttt-shortcuts-panel"
          role="region"
          aria-label="Keyboard Shortcuts Reference"
        >
          <table className="ttt-shortcuts-table">
            <caption className="sr-only">List of accessible keyboard shortcuts</caption>
            <thead>
              <tr>
                <th scope="col">Shortcut</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><kbd className="ttt-kbd">↑</kbd> <kbd className="ttt-kbd">↓</kbd> <kbd className="ttt-kbd">←</kbd> <kbd className="ttt-kbd">→</kbd></td>
                <td>Navigate 3x3 board cells</td>
              </tr>
              <tr>
                <td><kbd className="ttt-kbd">Space</kbd> / <kbd className="ttt-kbd">Enter</kbd></td>
                <td>Mark focused cell</td>
              </tr>
              <tr>
                <td><kbd className="ttt-kbd">Home</kbd> / <kbd className="ttt-kbd">End</kbd></td>
                <td>First / Last cell in row (Ctrl+Home/End for full board)</td>
              </tr>
              <tr>
                <td><kbd className="ttt-kbd">PageUp</kbd> / <kbd className="ttt-kbd">PageDown</kbd></td>
                <td>Top / Bottom cell in column</td>
              </tr>
              <tr>
                <td><kbd className="ttt-kbd">Alt + R</kbd></td>
                <td>Restart game / New match</td>
              </tr>
              <tr>
                <td><kbd className="ttt-kbd">Ctrl + Z</kbd></td>
                <td>Undo move (Step back)</td>
              </tr>
              <tr>
                <td><kbd className="ttt-kbd">Ctrl + Y</kbd></td>
                <td>Redo move (Step forward)</td>
              </tr>
              <tr>
                <td><kbd className="ttt-kbd">Tab</kbd> / <kbd className="ttt-kbd">Shift + Tab</kbd></td>
                <td>Move between board, controls, and history</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
