import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TicTacToeGame,
  createInitialGameState,
  makeMove,
  jumpToStep,
} from '../dist/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const css = fs.readFileSync(path.join(rootDir, 'src/styles/tic-tac-toe.css'), 'utf8');

function wrapHtml(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    ${css}
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
}

const fixturesDir = path.join(rootDir, 'dist/a11y-fixtures');
fs.mkdirSync(fixturesDir, { recursive: true });

// 1. Initial State (Player X's turn, empty 3x3 board)
const initialHtml = renderToStaticMarkup(React.createElement(TicTacToeGame));
fs.writeFileSync(
  path.join(fixturesDir, 'initial.html'),
  wrapHtml('Tic-Tac-Toe - Initial State', initialHtml),
  'utf8'
);

// 2. Mid Game State (Move 3, Player O's turn)
let midState = createInitialGameState();
midState = makeMove(midState, 0); // X at (1,1)
midState = makeMove(midState, 4); // O at (2,2)
midState = makeMove(midState, 8); // X at (3,3)
const midHtml = renderToStaticMarkup(
  React.createElement(TicTacToeGame, { initialGameState: midState })
);
fs.writeFileSync(
  path.join(fixturesDir, 'in-progress.html'),
  wrapHtml('Tic-Tac-Toe - In Progress State', midHtml),
  'utf8'
);

// 3. Won Game State (Player X won on Top Row)
let wonState = createInitialGameState();
wonState = makeMove(wonState, 0); // X
wonState = makeMove(wonState, 3); // O
wonState = makeMove(wonState, 1); // X
wonState = makeMove(wonState, 4); // O
wonState = makeMove(wonState, 2); // X wins!
const wonHtml = renderToStaticMarkup(
  React.createElement(TicTacToeGame, { initialGameState: wonState })
);
fs.writeFileSync(
  path.join(fixturesDir, 'won.html'),
  wrapHtml('Tic-Tac-Toe - Won State', wonHtml),
  'utf8'
);

// 4. Draw Game State (Stalemate)
let drawState = createInitialGameState();
const drawMoves = [0, 1, 2, 4, 3, 5, 7, 6, 8];
for (const m of drawMoves) {
  drawState = makeMove(drawState, m);
}
const drawHtml = renderToStaticMarkup(
  React.createElement(TicTacToeGame, { initialGameState: drawState })
);
fs.writeFileSync(
  path.join(fixturesDir, 'draw.html'),
  wrapHtml('Tic-Tac-Toe - Draw State', drawHtml),
  'utf8'
);

// 5. Time-Traveled State (Jumped back to Step 1)
const timeTravelState = jumpToStep(wonState, 1);
const timeTravelHtml = renderToStaticMarkup(
  React.createElement(TicTacToeGame, { initialGameState: timeTravelState })
);
fs.writeFileSync(
  path.join(fixturesDir, 'time-travel.html'),
  wrapHtml('Tic-Tac-Toe - Time Travel State', timeTravelHtml),
  'utf8'
);

console.log('Successfully generated 5 accessible HTML test fixtures in dist/a11y-fixtures/:');
console.log(' - initial.html');
console.log(' - in-progress.html');
console.log(' - won.html');
console.log(' - draw.html');
console.log(' - time-travel.html');
