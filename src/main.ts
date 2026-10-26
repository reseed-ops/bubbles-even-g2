import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { initApp, type App, type Status } from './app.ts'
import { runFontTest, GLYPH_SETS } from './fonttest.ts'
import { EMPTY } from './grid.ts'
import { createGame, MODES, type Difficulty, type Mode } from './game.ts'
import { renderSplash } from './grid.ts'
import { COLS, SCREEN_ROWS } from './layout.ts'
import type { RenderMode } from './renderer.ts'

const elementCache = new Map<string, HTMLElement>()
const $ = <T extends HTMLElement>(id: string): T => {
  let el = elementCache.get(id)
  if (!el) { el = document.getElementById(id) as HTMLElement; elementCache.set(id, el) }
  return el as T
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no Even bridge after ${ms} ms`)), ms)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

// The lens is ten rows. A line of exactly COLS code points is a grid row and
// gets one centred cell per glyph; anything else is drawn as a line of text.
const lens = $('lens')
const rows: HTMLDivElement[] = Array.from({ length: SCREEN_ROWS }, () => {
  const row = document.createElement('div')
  row.className = 'row'
  lens.appendChild(row)
  return row
})
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-mode]')]
const difficultyButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-difficulty]')]
const legibilityButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-legibility]')]
const rendererButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-renderer]')]
const setText = (id: string, value: string) => {
  const el = $(id)
  if (el.textContent !== value) el.textContent = value
}

// Straight line glyphs are drawn as CSS lines so they join across cells,
// as the firmware font's box-drawing glyphs do on the glasses.
const LINE_CELLS: Record<string, string> = { '━': 'h', '┃': 'v', '┫': 'v tick', '─': 'h light', '│': 'v light' }

function drawLens(screen: string): void {
  const lines = screen.split('\n')
  rows.forEach((row, y) => {
    const glyphs = [...(lines[y] ?? '')]
    if (glyphs.length !== COLS) {
      if (row.className !== 'row') { row.className = 'row'; row.textContent = '' }
      if (row.textContent !== lines[y]) row.textContent = lines[y] ?? ''
      return
    }
    if (row.childElementCount !== COLS) {
      row.textContent = ''
      for (let i = 0; i < COLS; i++) row.appendChild(document.createElement('span')).className = 'cell'
    }
    row.className = 'row grid'
    glyphs.forEach((glyph, i) => {
      const cell = row.children[i]
      const line = LINE_CELLS[glyph]
      const text = glyph === EMPTY || line ? '' : glyph
      const className = line ? `cell ${line}` : 'cell'
      if (cell.className !== className) cell.className = className
      if (cell.textContent !== text) cell.textContent = text
    })
  })
}

function setStatus(text: string, connected: boolean): void {
  setText('status-text', text)
  $('status').classList.toggle('on', connected)
}

let lastScreen = ''
function renderNow(status: Status): void {
  const renderStarted = performance.now()
  setStatus(status.text, status.page !== null)
  if (status.screen !== lastScreen) { drawLens(status.screen); lastScreen = status.screen }
  setText('level', String(status.level))
  setText('score', status.score.toLocaleString())
  setText('best', status.best.toLocaleString())
  setText('aim', `${status.aim > 0 ? '+' : ''}${status.aim}°`)
  setText('pace-label', status.pace.label)
  setText('pace', status.pace.value)
  setText('push-ms', status.frame ? `${status.frame.ms} ms` : '–')
  setText('fps', status.frame ? `${status.frame.fps}/s` : '–')
  setText('skipped', status.frame ? `${Math.round(status.frame.skipped * 100)}%` : '–')
  setText('render-path', status.renderMode === 'bands' ? 'Dirty bands' : 'Full screen')
  setText('grid-ms', `${status.renderMs.toFixed(2)} ms`)
  setText('push-cost', status.pushCost ?? 'Not measured yet. A game in progress pauses while it runs.')
  $<HTMLButtonElement>('new-game').disabled = status.page === null
  $<HTMLButtonElement>('center-aim').disabled = status.phase !== 'play'
  $<HTMLButtonElement>('measure').disabled = status.page === null
  const connected = status.page !== null
  modeButtons.forEach((b) => {
    b.disabled = !connected
    b.setAttribute('aria-pressed', String(b.dataset.mode === status.mode))
  })
  difficultyButtons.forEach((b) => {
    b.disabled = !connected
    b.setAttribute('aria-pressed', String(b.dataset.difficulty === status.difficulty))
  })
  legibilityButtons.forEach((b) => {
    b.disabled = !connected
    b.setAttribute('aria-pressed', String((b.dataset.legibility === 'numbers') === status.highLegibility))
  })
  rendererButtons.forEach((b) => {
    b.disabled = !connected
    b.setAttribute('aria-pressed', String(b.dataset.renderer === status.renderMode))
  })
  const levelInput = $<HTMLInputElement>('start-level')
  levelInput.disabled = !connected || status.phase === 'play' || status.mode === 'endless'
  levelInput.max = String(status.levelReached)
  if (document.activeElement !== levelInput) levelInput.value = String(status.level)
  setText('level-reached', status.mode === 'endless' ? 'waves start at 1' : `of ${status.levelReached} reached`)
  const s = status.stats
  setText('st-games', s.games.toLocaleString())
  setText('st-shots', s.shots.toLocaleString())
  setText('st-popped', s.popped.toLocaleString())
  setText('st-dropped', s.dropped.toLocaleString())
  setText('st-biggest', String(s.biggestDrop))
  setText('st-combo', s.longestCombo ? `×${Math.min(5, s.longestCombo)}` : '0')
  setText('st-levels', s.levelsCleared.toLocaleString())
  setText('st-pickups', s.pickups.toLocaleString())
  setText('st-wave', String(s.bestWave))
  setText('phone-ms', `${(performance.now() - renderStarted).toFixed(2)} ms`)
}

// The phone mirror is useful but need not repaint at glasses-frame cadence.
// Coalesce status bursts to 4 Hz, and do no DOM work while the page is hidden.
let pendingStatus: Status | null = null
let renderTimer: number | null = null
function render(status: Status): void {
  pendingStatus = status
  if (document.hidden || renderTimer !== null) return
  renderTimer = window.setTimeout(() => {
    renderTimer = null
    if (pendingStatus && !document.hidden) { const latest = pendingStatus; pendingStatus = null; renderNow(latest) }
  }, 250)
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pendingStatus) {
    if (renderTimer !== null) window.clearTimeout(renderTimer)
    renderTimer = null
    const latest = pendingStatus
    pendingStatus = null
    renderNow(latest)
  }
})

async function boot(): Promise<void> {
  $('version').textContent = `v${__APP_VERSION__}`
  drawLens(renderSplash(createGame())) // the lens is never blank, even before the glasses answer
  const params = new URLSearchParams(location.search)
  const dev = import.meta.env.DEV   // developer URLs work on the dev server only; the packed build ignores them
  let app: App
  try {
    const bridge = await withTimeout(waitForEvenAppBridge(), 8000)
    if (dev && params.get('test') === 'font') {
      const set = Number(params.get('set') ?? 1)
      const text = await runFontTest(bridge, set)
      setStatus(`Font test ${set}: ${GLYPH_SETS[set - 1]?.join(' ') ?? ''}`, true)
      drawLens(text)
      return
    }
    app = await initApp(bridge, render)
  } catch (err) {
    setStatus('Not connected. Open Bubbles from the Even app or the simulator.', false)
    console.error(err)
    return
  }

  const mode = params.get('mode')
  if (MODES.includes(mode as Mode)) app.setMode(mode as Mode)
  if (dev) {
    const renderer = params.get('renderer')
    if (renderer === 'full' || renderer === 'bands') app.setRenderer(renderer)
    const level = Number(params.get('level'))   // unlock and pick a start level
    if (level > 1) { app.game.levelReached = Math.max(app.game.levelReached, level); app.setStartLevel(level) }
    if (params.get('measure') === '1') setTimeout(() => app.measurePush(), 1500)   // run the push-cost test once connected
    const preview = params.get('preview')
    if (preview === 'over' || preview === 'won' || preview === 'title' || preview === 'blast' || preview === 'specials' || preview === 'card') app.preview(preview)
  }

  $('new-game').onclick = () => app.newGame()
  $('center-aim').onclick = () => app.centerAim()
  $('measure').onclick = () => app.measurePush()
  modeButtons.forEach((b) => { b.onclick = () => app.setMode(b.dataset.mode as Mode) })
  difficultyButtons.forEach((b) => { b.onclick = () => app.setDifficulty(b.dataset.difficulty as Difficulty) })
  legibilityButtons.forEach((b) => { b.onclick = () => app.setHighLegibility(b.dataset.legibility === 'numbers') })
  rendererButtons.forEach((b) => { b.onclick = () => app.setRenderer(b.dataset.renderer as RenderMode) })
  const levelInput = $<HTMLInputElement>('start-level')
  levelInput.onchange = () => app.setStartLevel(Number(levelInput.value))
}

void boot()
