/**
 * ND 3D Tic-Tac-Toe — package-shipped web view UI.
 *
 * Runs inside ND's sandboxed iframe: opaque origin, no Node, no network, and
 * WebGL is the only privileged API it touches. Every durable effect goes
 * through the nd.webview/1 bridge (postMessage → parent → broker → host
 * methods), so this script holds no authority of its own. If WebGL is
 * unavailable the game still plays through keys and buttons; only visuals go.
 */
import * as THREE from './vendor/three.module.js'
import {
  EMPTY,
  applyMove,
  bestMove,
  easyMove,
  emptyBoard,
  opponentOf,
  outcomeOf,
} from './game-core.js'

const HUMAN = 'X'
const AI = 'O'
const CELL = 1.1

// --- nd.webview/1 bridge client ---------------------------------------------

function createBridge() {
  let hello = null
  const pending = new Map()
  const connectQueue = []

  window.addEventListener('message', (event) => {
    const data = event.data
    if (!data || typeof data !== 'object') return
    if (data.kind === 'nd-webview:hello' && data.protocol === 'nd.webview/1') {
      hello = data
      while (connectQueue.length > 0) connectQueue.shift()()
      return
    }
    if (data.kind === 'nd-webview:result') {
      const settle = pending.get(data.requestId)
      if (settle) {
        pending.delete(data.requestId)
        settle(data)
      }
    }
  })

  // Announce readiness until the host answers: a fast burst first, then a
  // slow retry forever, so a host that mounts late still connects instead of
  // leaving the dialog stuck on its loading state.
  let attempts = 0
  let slow = false
  const announce = () => window.parent.postMessage({ kind: 'nd-webview:ready' }, '*')
  announce()
  const retry = setInterval(() => {
    if (hello) {
      clearInterval(retry)
      return
    }
    attempts += 1
    if (!slow && attempts > 40) {
      slow = true
      clearInterval(retry)
      setInterval(function slower() {
        if (!hello) announce()
        else clearInterval(slower)
      }, 2_000)
      return
    }
    announce()
  }, 250)

  return {
    get connected() {
      return Boolean(hello)
    },
    /** Run fn once the host handshake has landed (immediately if it has). */
    whenConnected(fn) {
      if (hello) fn()
      else connectQueue.push(fn)
    },
    /** input {action} routes through the parent to the view's declared host methods. */
    invoke(input) {
      if (!hello) {
        return Promise.resolve({ ok: false, error: { code: 'unavailable', message: 'Not connected to ND' } })
      }
      const requestId = crypto.randomUUID()
      return new Promise((resolve) => {
        pending.set(requestId, resolve)
        window.parent.postMessage({ kind: 'nd-webview:invoke', requestId, input }, '*')
        setTimeout(() => {
          if (pending.has(requestId)) {
            pending.delete(requestId)
            resolve({ ok: false, error: { code: 'timeout', message: 'ND did not answer in time' } })
          }
        }, 10_000)
      })
    },
  }
}

const bridge = createBridge()

// --- DOM ---------------------------------------------------------------------

const statusEl = document.getElementById('status')
const boardEl = document.getElementById('board')
const fallbackEl = document.getElementById('fallback')
const els = {
  wins: document.getElementById('score-wins'),
  losses: document.getElementById('score-losses'),
  draws: document.getElementById('score-draws'),
  streak: document.getElementById('score-streak'),
  modeAi: document.getElementById('mode-ai'),
  mode2p: document.getElementById('mode-2p'),
  diffHard: document.getElementById('diff-hard'),
  diffEasy: document.getElementById('diff-easy'),
  difficultyGroup: document.getElementById('difficulty-group'),
  newGame: document.getElementById('new-game'),
  resetScores: document.getElementById('reset-scores'),
}

const state = {
  board: emptyBoard(),
  turn: HUMAN,
  mode: 'ai', // 'ai' | '2p'
  difficulty: 'hard', // 'hard' | 'easy'
  finished: false,
  busy: false,
}

function refreshModeButtons() {
  els.modeAi.classList.toggle('on', state.mode === 'ai')
  els.mode2p.classList.toggle('on', state.mode === '2p')
  els.diffHard.classList.toggle('on', state.difficulty === 'hard')
  els.diffEasy.classList.toggle('on', state.difficulty === 'easy')
  els.difficultyGroup.style.visibility = state.mode === 'ai' ? 'visible' : 'hidden'
}

function setStatus(text) {
  statusEl.textContent = text
}

function humanTurn() {
  return !state.finished && !state.busy && (state.mode === '2p' || state.turn === HUMAN)
}

function turnLabel() {
  if (state.mode === '2p') return `${state.turn} to move`
  return state.turn === HUMAN ? 'Your turn — you are X' : 'AI is thinking…'
}

// --- three.js visuals (optional; the game plays fine without them) ------------

let addPiece = () => {}
let clearPieces = () => {}
let showWinLine = () => {}
let clearWinLine = () => {}

function createRenderer() {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    return renderer.getContext() ? renderer : null
  } catch {
    return null
  }
}

const renderer = createRenderer()
if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  boardEl.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x111318)

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
  const target = new THREE.Vector3(0, 0.2, 0)
  const orbit = { theta: Math.PI * 0.24, phi: Math.PI * 0.36, radius: 8.4 }

  function updateCamera() {
    const { theta, phi, radius } = orbit
    camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta),
    )
    camera.lookAt(target)
  }
  updateCamera()

  scene.add(new THREE.HemisphereLight(0xdfe7ff, 0x0b0d12, 1.0))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(4, 7, 3)
  scene.add(sun)
  const fill = new THREE.PointLight(0xa78bfa, 12, 20)
  fill.position.set(-4, 3, -4)
  scene.add(fill)

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(3.9, 0.36, 3.9),
    new THREE.MeshStandardMaterial({ color: 0x1d212b, roughness: 0.85, metalness: 0.1 }),
  )
  base.position.y = -0.18
  scene.add(base)

  const gridMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3240, roughness: 0.6, metalness: 0.2 })
  for (const offset of [-0.55, 0.55]) {
    const alongX = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.1, 0.09), gridMaterial)
    alongX.position.set(0, 0.05, offset)
    scene.add(alongX)
    const alongZ = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 3.5), gridMaterial)
    alongZ.position.set(offset, 0.05, 0)
    scene.add(alongZ)
  }

  // Raycastable pads, one per cell, in reading order.
  const pads = []
  const padMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  for (let index = 0; index < 9; index += 1) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 1.06), padMaterial)
    pad.rotation.x = -Math.PI / 2
    pad.position.copy(cellPosition(index)).setY(0.11)
    pad.userData.index = index
    scene.add(pad)
    pads.push(pad)
  }

  const hover = new THREE.Mesh(
    new THREE.PlaneGeometry(1.02, 1.02),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.16, depthWrite: false }),
  )
  hover.rotation.x = -Math.PI / 2
  hover.visible = false
  scene.add(hover)

  const xMaterial = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.25, roughness: 0.35, metalness: 0.3 })
  const oMaterial = new THREE.MeshStandardMaterial({ color: 0xa78bfa, emissive: 0xa78bfa, emissiveIntensity: 0.25, roughness: 0.35, metalness: 0.3 })

  function markMesh(player) {
    const group = new THREE.Group()
    if (player === HUMAN) {
      for (const angle of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.15, 0.15), xMaterial)
        bar.rotation.y = angle
        bar.position.y = 0.28
        group.add(bar)
      }
    } else {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.09, 16, 44), oMaterial)
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.28
      group.add(ring)
    }
    return group
  }

  const pieces = new Map()
  const tweens = []

  function cellPosition(index) {
    const row = Math.floor(index / 3)
    const col = index % 3
    return new THREE.Vector3((col - 1) * CELL, 0, (row - 1) * CELL)
  }

  addPiece = (index, player) => {
    const mesh = markMesh(player)
    mesh.position.copy(cellPosition(index))
    mesh.position.y = 0.9
    mesh.scale.setScalar(0.01)
    scene.add(mesh)
    pieces.set(index, mesh)
    tweens.push({ mesh, start: performance.now(), duration: 340 })
  }

  clearPieces = () => {
    for (const mesh of pieces.values()) scene.remove(mesh)
    pieces.clear()
    tweens.length = 0
  }

  showWinLine = (line) => {
    const from = cellPosition(line[0]).setY(0.3)
    const to = cellPosition(line[2]).setY(0.3)
    const material = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x4ade80, emissiveIntensity: 0.9, roughness: 0.3 })
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, from.distanceTo(to) + 0.3, 12), material)
    beam.position.copy(from).add(to).multiplyScalar(0.5)
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
    scene.add(beam)
    tweens.winBeams ??= []
    tweens.winBeams.push(beam)
  }

  clearWinLine = () => {
    for (const beam of tweens.winBeams ?? []) scene.remove(beam)
    tweens.winBeams = []
  }

  // --- pointer interaction: hover, place, orbit --------------------------------

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let dragging = false
  let dragMoved = false
  let lastX = 0
  let lastY = 0

  function padUnderPointer(event) {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(pads, false)[0]
    return hit ? hit.object.userData.index : -1
  }

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (dragging) {
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true
      orbit.theta -= dx * 0.005
      orbit.phi = Math.min(1.35, Math.max(0.2, orbit.phi - dy * 0.005))
      lastX = event.clientX
      lastY = event.clientY
      updateCamera()
      hover.visible = false
      return
    }
    const index = padUnderPointer(event)
    hover.visible = index >= 0 && state.board[index] === EMPTY && humanTurn()
    if (hover.visible) hover.position.copy(cellPosition(index)).setY(0.12)
  })

  renderer.domElement.addEventListener('pointerdown', (event) => {
    dragging = true
    dragMoved = false
    lastX = event.clientX
    lastY = event.clientY
  })

  renderer.domElement.addEventListener('pointerup', (event) => {
    dragging = false
    if (dragMoved) return
    const index = padUnderPointer(event)
    if (index >= 0) tryPlace(index)
  })

  renderer.domElement.addEventListener('wheel', (event) => {
    event.preventDefault()
    orbit.radius = Math.min(12, Math.max(5.5, orbit.radius + event.deltaY * 0.004))
    updateCamera()
  }, { passive: false })

  function resize() {
    const { clientWidth, clientHeight } = boardEl
    if (clientWidth === 0 || clientHeight === 0) return
    renderer.setSize(clientWidth, clientHeight, false)
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
  }
  new ResizeObserver(resize).observe(boardEl)
  resize()

  renderer.setAnimationLoop(() => {
    const now = performance.now()
    for (let i = tweens.length - 1; i >= 0; i -= 1) {
      const tween = tweens[i]
      const t = Math.min(1, (now - tween.start) / tween.duration)
      const ease = 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2) // easeOutBack
      tween.mesh.scale.setScalar(0.01 + ease * 0.99)
      tween.mesh.position.y = 0.9 - ease * 0.62
      if (t >= 1) tweens.splice(i, 1)
    }
    const pulse = 0.75 + Math.sin(now * 0.005) * 0.25
    for (const beam of tweens.winBeams ?? []) beam.material.emissiveIntensity = pulse
    renderer.render(scene, camera)
  })
} else {
  fallbackEl.style.display = 'flex'
}

// --- game flow -----------------------------------------------------------------

function resetGame() {
  state.board = emptyBoard()
  state.turn = HUMAN
  state.finished = false
  state.busy = false
  clearPieces()
  clearWinLine()
  setStatus(turnLabel())
}

function place(index, player) {
  state.board = applyMove(state.board, index, player)
  addPiece(index, player)
}

function afterMove(player) {
  const outcome = outcomeOf(state.board)
  if (outcome.status !== 'playing') {
    state.finished = true
    state.busy = false
    if (outcome.status === 'won') {
      showWinLine(outcome.line)
      setStatus(state.mode === '2p' ? `${outcome.player} wins!` : outcome.player === HUMAN ? 'You win!' : 'AI wins — try again')
    } else {
      setStatus('Draw — the board is full')
    }
    // Scoreboard is X-perspective in both modes; see showScores().
    void recordOutcome(outcome.status === 'draw' ? 'draw' : outcome.player === HUMAN ? 'win' : 'loss')
    return
  }
  state.turn = opponentOf(player)
  setStatus(turnLabel())
  if (state.mode === 'ai' && state.turn === AI) {
    state.busy = true
    setTimeout(() => {
      const move = state.difficulty === 'hard' ? bestMove(state.board, AI) : easyMove(state.board, AI)
      state.busy = false
      if (move >= 0 && !state.finished) {
        place(move, AI)
        afterMove(AI)
      }
    }, 320)
  }
}

function tryPlace(index) {
  if (state.board[index] !== EMPTY || !humanTurn()) return
  place(index, state.turn)
  afterMove(state.turn)
}

// --- Scoreboard over the bridge ----------------------------------------------

function showScores(stats) {
  if (!stats || typeof stats !== 'object') {
    for (const el of [els.wins, els.losses, els.draws, els.streak]) el.textContent = '—'
    els.resetScores.disabled = true
    return
  }
  els.wins.textContent = String(stats.wins)
  els.losses.textContent = String(stats.losses)
  els.draws.textContent = String(stats.draws)
  els.streak.textContent = String(stats.streak)
  els.resetScores.disabled = false
}

async function loadScores() {
  const result = await bridge.invoke({ action: 'get' })
  showScores(result.ok ? result.value : null)
}

async function recordOutcome(outcome) {
  const result = await bridge.invoke({ action: 'record', outcome })
  showScores(result.ok ? result.value : null)
}

// --- controls --------------------------------------------------------------------

els.newGame.addEventListener('click', resetGame)
els.modeAi.addEventListener('click', () => {
  state.mode = 'ai'
  refreshModeButtons()
  resetGame()
})
els.mode2p.addEventListener('click', () => {
  state.mode = '2p'
  refreshModeButtons()
  resetGame()
})
els.diffHard.addEventListener('click', () => {
  state.difficulty = 'hard'
  refreshModeButtons()
})
els.diffEasy.addEventListener('click', () => {
  state.difficulty = 'easy'
  refreshModeButtons()
})
els.resetScores.addEventListener('click', async () => {
  els.resetScores.disabled = true
  const result = await bridge.invoke({ action: 'reset' })
  showScores(result.ok ? result.value : null)
})

// Keys 1–9 place a mark in reading order, matching game-core's indexing.
window.addEventListener('keydown', (event) => {
  const index = Number(event.key) - 1
  if (Number.isInteger(index) && index >= 0 && index <= 8) tryPlace(index)
})

refreshModeButtons()
setStatus(turnLabel())
// The handshake lands asynchronously; only fetch the scoreboard once the
// bridge is actually connected, or the first read would always miss.
bridge.whenConnected(() => {
  void loadScores()
})
