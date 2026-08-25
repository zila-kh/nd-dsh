let value = 0
const output = document.querySelector('#count')

function render() {
  output.textContent = String(value)
  document.title = `Counter ${value} · ND Extension Demo`
}

function get() {
  return value
}

function add(delta) {
  if (!Number.isFinite(delta)) throw new TypeError('Counter delta must be a finite number')
  value += delta
  render()
  return value
}

function reset() {
  value = 0
  render()
  return value
}

document.querySelector('#increment').addEventListener('click', () => add(1))
document.querySelector('#decrement').addEventListener('click', () => add(-1))
document.querySelector('#reset').addEventListener('click', reset)

window.ndCounter = Object.freeze({ get, add, reset })
render()
