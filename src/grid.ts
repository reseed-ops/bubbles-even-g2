// Turns game state into the text the glasses show. Pure: no SDK imports.
import {
  COLS, DEAD_COL, ROWS, SCREEN_ROWS, SHOOTER_X, SHOOTER_Y,
  SKIP_POINTS,
} from './layout.ts'
import { aimAngle, aimPath, blinkOn, comboMultiplier, idx, isMystery, paceEvery, wallFor, wallWarning, LEVEL_COUNT, type Game, type Mode } from './game.ts'

// Glyphs confirmed to be exactly one grid cell wide in the G2 firmware font
// (see the ?test=font pages).
export const EMPTY = '　'   // ideographic space: fullwidth, keeps the grid aligned
const AIM_HORIZONTAL = '─'
const AIM_UP = '／'  // fullwidth slash: screen y decreases as the shot rises
const AIM_DOWN = '＼'
const AIM_VERTICAL = '│'
const NEXT_AIM_HORIZONTAL = '━'
const NEXT_AIM_VERTICAL = '┃'
const TARGET = 'Ｘ'  // unique landing marker; fullwidth Latin is firmware-proven
const WALL = '┃'
const WALL_WARNING = '│' // retain the boundary while making its warning visibly lighter
const WALL_PROGRESS = '┫'  // a tick on the wall, so the wall line stays unbroken
const AXLE = '╋'    // pulley mode: the axle both groups hang from
const DANGER = '：' // visually a boundary, unlike the single-dot projectile trail
const TRAIL = '・'
const NEXT = '＞'
const PICKUP = '＋'  // fly through it to load a special
// Effect frames by age (0 = the frame the shot landed): popped bubbles
// sparkle, burst, then fade; the blast rings ripple outward one frame later each.
const POP_BY_AGE = ['★', '◎', '◌', '・']
const RING_BY_AGE = ['・', '◌', '・']
// Frozen Bubble's eight colours, then star, rainbow, stone, bomb, ice and cracked ice.
export const BUBBLE = ['', '●', '○', '◎', '◆', '◇', '■', '□', '♥', '☆', '※', '▩', '♨', '▦', '▤']
const LEGIBLE_COLOUR = ['', '１', '２', '３', '４', '５', '６', '７', '８']
const MYSTERY = '？'
export const glyphFor = (type: number, highLegibility = false): string =>
  (highLegibility && type >= 1 && type < LEGIBLE_COLOUR.length) ? LEGIBLE_COLOUR[type]
    : isMystery(type) ? MYSTERY : BUBBLE[type] ?? MYSTERY

// Below this angle the line is flat, above the upper one it is upright;
// in between every cell gets a slash so a diagonal aim reads as one line.
const FLAT_DEG = 12
const UPRIGHT_DEG = 58

function aimGlyphs(g: Game, path: number[]): string[] {
  const deg = aimAngle(g)
  const size = Math.abs(deg)
  const shape = size < FLAT_DEG ? 'flat' : size > UPRIGHT_DEG ? 'upright' : 'slash'
  let rising = deg > 0
  let previousRow = SHOOTER_Y
  return path.map((c) => {
    const row = Math.floor(c / COLS)
    // A change of vertical direction means the line bounced off an edge.
    if (row !== previousRow) rising = row < previousRow
    previousRow = row
    if (shape === 'flat') return g.flying ? NEXT_AIM_HORIZONTAL : AIM_HORIZONTAL
    if (shape === 'upright') return g.flying ? NEXT_AIM_VERTICAL : AIM_VERTICAL
    return rising ? AIM_UP : AIM_DOWN
  })
}

// The frame: ◈ corners with a ◇ flourish beside each, and light ─ and │
// edges, the same thin stroke as the ◇, so the frame sits back behind the
// game. All one cell wide in
// the firmware font (sets 2, 11 and 14).
const CORNER = '◈'
const FLOURISH = '◇'
const EDGE_H = '─'
const EDGE_V = '│'
const INNER = COLS - 2

const frameRule = (): string => CORNER + FLOURISH + EDGE_H.repeat(COLS - 4) + FLOURISH + CORNER

// Screens that are not the playfield: SCREEN_ROWS - 2 inner rows of up to
// INNER cells each, framed. Short rows are padded; long ones are cut.
function framed(inner: string[]): string {
  const rows = [frameRule()]
  for (let i = 0; i < SCREEN_ROWS - 2; i++) {
    const side = i === 0 || i === SCREEN_ROWS - 3 ? FLOURISH : EDGE_V
    const glyphs = [...(inner[i] ?? '')].slice(0, INNER)
    while (glyphs.length < INNER) glyphs.push(EMPTY)
    rows.push(side + glyphs.join('') + side)
  }
  rows.push(frameRule())
  return rows.join('\n')
}

// Gameplay uses only its nine meaningful rows. Omitting the decorative floor
// removes a bright distraction and lets a banded renderer skip that region.
function rowsToText(cells: string[]): string {
  const rows: string[] = []
  for (let y = 0; y < ROWS; y++) rows.push(cells.slice(y * COLS, (y + 1) * COLS).join(''))
  return rows.join('\n')
}

// Fullwidth forms of ASCII (letters, digits, punctuation) are one cell wide
// in the firmware font (sets 4, 8, 9, 12 and 13). Screens use upper case.
export function fullwidth(text: string): string {
  return [...text.toUpperCase()].map((ch) => {
    if (ch === ' ') return EMPTY
    const code = ch.charCodeAt(0)
    return code >= 0x21 && code <= 0x7e ? String.fromCharCode(code - 0x20 + 0xff00) : ch
  }).join('')
}
export const fullwidthNumber = (n: number): string => fullwidth(String(n))

function launcherGlyph(g: Game): string {
  const deg = aimAngle(g)
  if (deg > 6) return '◥'
  if (deg < -6) return '◢'
  return '▶'
}

// Where a short word (READY, GO) sits over the empty left of the field.
const OVERLAY_X = 3
const OVERLAY_Y = 2

function gridCells(g: Game, overlay?: string): string[] {
  const cells: string[] = new Array(COLS * ROWS).fill(EMPTY)

  // The dashed line marks the two-column loss zone without consuming any
  // playable board space. Active objects are drawn over it below.
  for (let y = 0; y < ROWS; y++) cells[idx(DEAD_COL - 1, y)] = DANGER

  // Each row's wall; in pulley mode the two groups hang on their own walls
  // from the axle on the shooter row. The wall blinks before it moves.
  const wallGlyph = wallWarning(g) && !blinkOn(g) ? WALL_WARNING : WALL
  for (let y = 0; y < ROWS; y++) {
    const wx = wallFor(g, y) + 1
    if (wx < COLS) cells[idx(wx, y)] = wallGlyph
  }
  if (g.mode !== 'puzzle') {
    const tickRow = g.shots % paceEvery(g)
    const tickX = wallFor(g, tickRow) + 1
    if (tickX < COLS) cells[idx(tickX, tickRow)] = WALL_PROGRESS
  }
  if (g.mode === 'pulley' && g.wallCol + 1 < COLS) cells[idx(g.wallCol + 1, SHOOTER_Y)] = AXLE

  // The aim line stays up during a flight so the next shot can be lined up
  // while this one travels. It predicts against the board as it is now.
  {
    const path = aimPath(g)
    const glyphs = aimGlyphs(g, path)
    // The current aim is continuous. During flight this is the *next* shot's
    // guide, so half density gives it a clearly different visual weight.
    path.forEach((c, i) => { if (!g.flying || i % 2 === 0) cells[c] = glyphs[i] })
    if (path.length) cells[path[path.length - 1]] = TARGET
  }
  for (const c of g.pickups) cells[c] = PICKUP
  const age = g.effectFrame > 0 ? Math.floor(g.effectFrames - g.effectFrame) : 0
  g.blast.forEach((ring, i) => {
    const glyph = RING_BY_AGE[age - 1 - i]
    if (glyph) for (const c of ring) cells[c] = glyph
  })
  const popGlyph = POP_BY_AGE[age] ?? '◌'
  for (const c of g.flash) cells[c] = popGlyph
  for (let c = 0; c < g.field.length; c++) {
    if (g.field[c]) cells[c] = glyphFor(g.field[c], g.highLegibility)
  }
  for (const falling of g.falling) {
    const y = falling.y + age
    if (y >= 0 && y < ROWS) cells[idx(falling.x, y)] = glyphFor(falling.type, g.highLegibility)
  }
  for (const c of g.trail) {
    if (!g.field[c]) cells[c] = TRAIL
  }
  // HUD down column 0, which is inside the loss zone so nothing in play ever
  // needs it: the level (or wave) at the top; below the launcher, the shots
  // left in puzzle mode, or the combo multiplier when it is running.
  ;[...fullwidthNumber(g.level)].forEach((d, i) => { if (i < SHOOTER_Y) cells[idx(SHOOTER_X, i)] = d })
  const readout = g.mode === 'puzzle' ? fullwidthNumber(Math.max(0, g.shotsLeft))
    : comboMultiplier(g) > 1 ? 'Ｘ' + fullwidthNumber(comboMultiplier(g)) : ''
  ;[...readout].forEach((d, i) => { if (SHOOTER_Y + 1 + i < ROWS - 1) cells[idx(SHOOTER_X, SHOOTER_Y + 1 + i)] = d })
  cells[idx(SHOOTER_X + 1, ROWS - 2)] = glyphFor(g.next2, g.highLegibility)
  cells[idx(SHOOTER_X, ROWS - 1)] = NEXT
  cells[idx(SHOOTER_X + 1, ROWS - 1)] = glyphFor(g.next, g.highLegibility)
  cells[idx(SHOOTER_X + 1, SHOOTER_Y)] = launcherGlyph(g)
  cells[idx(SHOOTER_X, SHOOTER_Y)] = glyphFor(g.loaded, g.highLegibility)
  if (g.flying) {
    cells[idx(Math.round(g.flying.x), Math.round(g.flying.y))] = glyphFor(g.flying.type, g.highLegibility)
  }
  if (overlay) [...overlay].forEach((ch, i) => { if (OVERLAY_X + i < COLS) cells[idx(OVERLAY_X + i, OVERLAY_Y)] = ch })
  return cells
}

export function renderGrid(g: Game, overlay?: string): string {
  return rowsToText(gridCells(g, overlay))
}

// Level clear: sparkles scattered over the (now empty) field, a few frames
// of them, each a different scatter. Deterministic so it is testable.
export function renderFireworks(g: Game, frame: number): string {
  const cells = gridCells(g)
  for (let y = 0; y < ROWS; y++) {
    for (let x = DEAD_COL + 1; x <= g.wallCol; x++) {
      const h = (x * 31 + y * 17 + frame * 7) % 11
      if (h < 3 && cells[idx(x, y)] === EMPTY) cells[idx(x, y)] = POP_BY_AGE[(h + frame) % POP_BY_AGE.length]
    }
  }
  return rowsToText(cells)
}

// The title screen, framed, in the playfield's own language: the name in
// fullwidth letters, a demo shot into a stack hanging off the frame's right
// edge, then the controls, all in fullwidth capitals so every row is a grid row.
const TITLE_STACK = ['◆◇◆', '●○', '◎■□', '★◆★'] // from the right edge leftwards, inner rows 0-3

const MODE_NAMES: Record<Mode, string> = { classic: 'Classic', pulley: 'Pulley', endless: 'Endless', puzzle: 'Puzzle' }
export const modeName = (g: Game): string => `${MODE_NAMES[g.mode]} mode`

function withStack(inner: string[]): string[] {
  return inner.map((text, i) => {
    const stack = TITLE_STACK[i]
    if (!stack) return text
    const glyphs = [...text].slice(0, INNER)
    while (glyphs.length < INNER) glyphs.push(EMPTY)
    ;[...stack].forEach((glyph, k) => { glyphs[INNER - 1 - k] = glyph })
    return glyphs.join('')
  })
}

export function renderSplash(g: Game): string {
  const demoShot = glyphFor(1, g.highLegibility) + AIM_HORIZONTAL.repeat(INNER - 1 - [...TITLE_STACK[2]].length - 1) + TARGET
  const start = g.levelReached > 1 ? `TAP: LEVEL ${g.startLevel} SWIPE: PICK` : 'TAP TO START' // fits three digits
  const mode = MODE_NAMES[g.mode].toUpperCase()
  const record = g.highScore > 0 ? `BEST ${g.highScore}` : g.mode === 'endless' ? 'WAVES FOREVER' : `${LEVEL_COUNT}+ LEVELS`
  return framed(withStack([
    fullwidth(' BUBBLES'),
    '',
    demoShot,
    '',
    fullwidth(g.mode === 'endless' ? 'TAP TO START' : start),
    fullwidth('SWIPE: AIM   TAP: SHOOT'),
    fullwidth('HOLD: SWAP  2 TAPS: QUIT'),
    fullwidth(`${mode}   ${record}`),
  ]))
}

// Shown after a clear until the player taps. The game has already moved on
// to the next level when this is drawn, so the cleared one is the level
// before. The harder path skips a level for a bonus.
export function renderLevelCard(g: Game, skip = false): string {
  const canSkip = g.mode !== 'endless'
  const unit = g.mode === 'endless' ? 'WAVE' : 'LEVEL'
  const next = skip && canSkip ? `NEXT: SKIP TO ${g.level + 1}  +${SKIP_POINTS}` : `NEXT: ${unit} ${g.level}`
  return framed([
    '',
    fullwidth(`${unit} ${g.level - 1} CLEARED`),
    fullwidth(`${g.lastLevelShots} SHOTS  BONUS ${g.lastBonus}`),
    fullwidth(`SCORE ${g.score}`),
    '',
    fullwidth(next),
    fullwidth(canSkip ? 'TAP: GO ON  SWIPE: CHANGE' : 'TAP: GO ON'),
    '',
  ])
}

// offerContinue: the one second chance is still available and is being offered.
export function renderGameOver(g: Game, offerContinue = false): string {
  const record = !g.ranked ? `BEST ${g.highScore} FROM LEVEL 1` : g.newBest ? `NEW BEST ${g.highScore}` : `BEST ${g.highScore}`
  return framed([
    '',
    fullwidth(g.won ? `ALL ${LEVEL_COUNT} LEVELS CLEARED` : 'GAME OVER'),
    '',
    fullwidth(`SCORE ${g.score}`),
    fullwidth(`${g.mode === 'endless' ? 'WAVE' : 'LEVEL'} ${g.level}`),
    fullwidth(record),
    '',
    fullwidth(offerContinue ? 'TAP: CONTINUE  SWIPE: END' : 'TAP: AGAIN  2 TAPS: QUIT'),
  ])
}

export function renderScreen(g: Game): string {
  switch (g.phase) {
    case 'play': return renderGrid(g)
    case 'over': return renderGameOver(g)
    default: return renderSplash(g)
  }
}
