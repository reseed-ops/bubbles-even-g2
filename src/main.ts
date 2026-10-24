import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { initApp, type App, type Status } from './app.ts'
import { runFontTest, GLYPH_SETS } from './fonttest.ts'
import { EMPTY } from './grid.ts'
import { createGame, MODES, type Difficulty, type Mode } from './game.ts'
import { renderSplash } from './grid.ts'
import { COLS, SCREEN_ROWS } from './layout.ts'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

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
  $('status-text').textContent = text
  $('status').classList.toggle('on', connected)
}

function render(status: Status): void {
  setStatus(status.text, status.page !== null)
  drawLens(status.screen)
  $('level').textContent = String(status.level)
  $('score').textContent = status.score.toLocaleString()
  $('best').textContent = status.best.toLocaleString()
  $('aim').textContent = `${status.aim > 0 ? '+' : ''}${status.aim}°`
  $('pace-label').textContent = status.pace.label
  $('pace').textContent = status.pace.value
  $<HTMLButtonElement>('new-game').disabled = status.page === null
  $<HTMLButtonElement>('center-aim').disabled = status.phase !== 'play'
  const connected = status.page !== null
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
    b.disabled = !connected
    b.setAttribute('aria-pressed', String(b.dataset.mode === status.mode))
  })
  document.querySelectorAll<HTMLButtonElement>('[data-aim]').forEach((b) => {
    b.disabled = !connected
    b.setAttribute('aria-pressed', String((b.dataset.aim === 'short') === status.hardAim))
  })
  document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((b) => {
    b.disabled = !connected
    b.setAttribute('aria-pressed', String(b.dataset.difficulty === status.difficulty))
  })
  const levelInput = $<HTMLInputElement>('start-level')
  levelInput.disabled = !connected || status.phase === 'play' || status.mode === 'endless'
  levelInput.max = String(status.levelReached)
  if (document.activeElement !== levelInput) levelInput.value = String(status.level)
  $('level-reached').textContent = status.mode === 'endless' ? 'waves start at 1' : `of ${status.levelReached} reached`
  const s = status.stats
  $('st-games').textContent = s.games.toLocaleString()
  $('st-shots').textContent = s.shots.toLocaleString()
  $('st-popped').textContent = s.popped.toLocaleString()
  $('st-dropped').textContent = s.dropped.toLocaleString()
  $('st-biggest').textContent = String(s.biggestDrop)
  $('st-combo').textContent = s.longestCombo ? `×${Math.min(5, s.longestCombo)}` : '0'
  $('st-levels').textContent = s.levelsCleared.toLocaleString()
  $('st-pickups').textContent = s.pickups.toLocaleString()
  $('st-wave').textContent = String(s.bestWave)
}

async function boot(): Promise<void> {
  $('version').textContent = `v${__APP_VERSION__}`
  drawLens(renderSplash(createGame())) // the lens is never blank, even before the glasses answer
  const params = new URLSearchParams(location.search)
  let app: App
  try {
    const bridge = await withTimeout(waitForEvenAppBridge(), 8000)
    if (params.get('test') === 'font') {
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
  if (params.get('aim') === 'short') app.setHardAim(true)
  const level = Number(params.get('level'))   // developer aid: unlock and pick a start level
  if (level > 1) { app.game.levelReached = Math.max(app.game.levelReached, level); app.setStartLevel(level) }
  const preview = params.get('preview')
  if (preview === 'over' || preview === 'won' || preview === 'title' || preview === 'blast' || preview === 'specials' || preview === 'card') app.preview(preview)

  $('new-game').onclick = () => app.newGame()
  $('center-aim').onclick = () => app.centerAim()
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => { b.onclick = () => app.setMode(b.dataset.mode as Mode) })
  document.querySelectorAll<HTMLButtonElement>('[data-aim]').forEach((b) => { b.onclick = () => app.setHardAim(b.dataset.aim === 'short') })
  document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((b) => { b.onclick = () => app.setDifficulty(b.dataset.difficulty as Difficulty) })
  const levelInput = $<HTMLInputElement>('start-level')
  levelInput.onchange = () => app.setStartLevel(Number(levelInput.value))
}

void boot()
