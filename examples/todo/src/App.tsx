import { useRef, useState, type KeyboardEvent } from 'react'

type Player = 'X' | 'O'
type Cell = Player | null

const winningLines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

function getWinningLine(board: Cell[]) {
  return winningLines.find(([first, second, third]) => {
    return board[first] && board[first] === board[second] && board[first] === board[third]
  })
}

function App() {
  const [board, setBoard] = useState<Cell[]>(() => Array(9).fill(null))
  const [turn, setTurn] = useState<Player>('X')
  const squareRefs = useRef<Array<HTMLButtonElement | null>>([])

  const winningLine = getWinningLine(board)
  const winner = winningLine ? board[winningLine[0]] : null
  const isDraw = !winner && board.every(Boolean)
  const gameComplete = Boolean(winner || isDraw)
  const status = winner
    ? `Player ${winner} wins!`
    : isDraw
      ? "It's a draw!"
      : `Player ${turn}'s turn`

  function playSquare(index: number) {
    if (board[index] || gameComplete) return

    setBoard((currentBoard) => currentBoard.map((cell, cellIndex) => (
      cellIndex === index ? turn : cell
    )))
    setTurn((currentTurn) => (currentTurn === 'X' ? 'O' : 'X'))
  }

  function resetGame() {
    setBoard(Array(9).fill(null))
    setTurn('X')
    squareRefs.current[0]?.focus()
  }

  function handleSquareKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const row = Math.floor(index / 3)
    const column = index % 3
    let nextIndex: number | undefined

    switch (event.key) {
      case 'ArrowRight':
        nextIndex = row * 3 + ((column + 1) % 3)
        break
      case 'ArrowLeft':
        nextIndex = row * 3 + ((column + 2) % 3)
        break
      case 'ArrowDown':
        nextIndex = ((row + 1) % 3) * 3 + column
        break
      case 'ArrowUp':
        nextIndex = ((row + 2) % 3) * 3 + column
        break
      case 'Home':
        nextIndex = row * 3
        break
      case 'End':
        nextIndex = row * 3 + 2
        break
      default:
        return
    }

    event.preventDefault()
    squareRefs.current[nextIndex]?.focus()
  }

  return (
    <main className="app-shell">
      <section className="game-card" aria-labelledby="game-title">
        <header className="game-header">
          <p className="eyebrow">A classic, made friendly</p>
          <h1 id="game-title">Tic-Tac-Toe</h1>
          <p className="intro">Take turns, make a line, enjoy the little win.</p>
        </header>

        <div className="players" aria-label="Players">
          <div className={`player player-x ${!gameComplete && turn === 'X' ? 'is-active' : ''}`}>
            <span className="player-mark" aria-hidden="true">X</span>
            <span>
              <strong>Player X</strong>
              <small>{!gameComplete && turn === 'X' ? 'Your turn' : 'Waiting'}</small>
            </span>
          </div>
          <span className="versus" aria-hidden="true">vs</span>
          <div className={`player player-o ${!gameComplete && turn === 'O' ? 'is-active' : ''}`}>
            <span className="player-mark" aria-hidden="true">O</span>
            <span>
              <strong>Player O</strong>
              <small>{!gameComplete && turn === 'O' ? 'Your turn' : 'Waiting'}</small>
            </span>
          </div>
        </div>

        <div className={`status ${gameComplete ? 'is-complete' : ''}`} aria-live="polite" aria-atomic="true">
          <span className="status-dot" aria-hidden="true" />
          {status}
        </div>

        <div className="board" role="group" aria-label="Tic-Tac-Toe board">
          {board.map((cell, index) => {
            const row = Math.floor(index / 3) + 1
            const column = (index % 3) + 1
            const isWinningSquare = winningLine?.includes(index)
            const squareLabel = cell
              ? `Row ${row}, column ${column}: Player ${cell}`
              : `Row ${row}, column ${column}: empty`

            return (
              <button
                key={index}
                ref={(element) => { squareRefs.current[index] = element }}
                className={`square ${cell ? `square-${cell.toLowerCase()}` : ''} ${isWinningSquare ? 'is-winning' : ''}`}
                type="button"
                onClick={() => playSquare(index)}
                onKeyDown={(event) => handleSquareKeyDown(event, index)}
                aria-label={squareLabel}
                aria-disabled={gameComplete || undefined}
              >
                {cell}
              </button>
            )
          })}
        </div>

        <div className="actions">
          <button className="reset-button" type="button" onClick={resetGame}>
            <span aria-hidden="true">↻</span>
            New game
          </button>
          <p className="keyboard-tip"><kbd>Tab</kbd> to focus · arrow keys to move · <kbd>Enter</kbd> to play</p>
        </div>
      </section>
    </main>
  )
}

export default App
