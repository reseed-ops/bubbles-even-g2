// Pure game logic. No SDK imports so it can be unit-tested in plain node.
import {
  COLS, ROWS, SHOOTER_X, SHOOTER_Y, DEAD_COL,
  WALL_INSET,
  MAX_ANGLE_DEG, BUBBLE_SPEED, SUBSTEP, AIM_MAX_STEPS,
  MAX_TYPES, POP_POINTS, DROP_BASE_POINTS, DROP_CAP, LEVEL_POINTS,
  BLAST_SIZE, EFFECT_FRAMES, BLAST_FRAMES,
  STAR, RAINBOW, STONE, BOMB, FROZEN, CRACKED, MYSTERY_BASE, SPECIALS_FROM_LEVEL, RAINBOW_SHOT_CHANCE,
  COMBO_MAX, ENDLESS_START_DEPTH,
  PICKUP_CHANCE, PICKUP_FROM_LEVEL, PICKUP_MARGIN, CONTINUES, CONTINUE_CLEAR,
  WALL_EVERY, HURRY_SCALE, PUZZLE_EXTRA, PUSH_EVERY_START, PUSH_TIGHTEN_WAVES, PUSH_EVERY_MIN, MAX_LEVEL,
  PULLEY_WEIGHT, PULLEY_MAX_SHIFT,
  HURRY_WARN_TICKS, HURRY_TICKS, BLINK_TICKS,
  BONUS_PER_SHOT, SKIP_POINTS,
} from './layout.ts'
import { LEVELS, LEVEL_DEPTH } from './levels.ts'

// Bubbles hang and match on all eight sides. The levels come from a hex grid
// snapped onto squares, and 8-neighbour adjacency keeps every original contact.
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
]
// A flying bubble stops only on real contact. Diagonal cells are 1.4 diameters
// apart, so a shot slides past a corner and goes on until it meets a bubble
// head-on or alongside.
const CONTACT: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

function forEachNeighbour(x: number, y: number, fn: (nx: number, ny: number) => void): void {
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx, ny = y + dy
    if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) fn(nx, ny)
  }
}

export type Phase = 'splash' | 'play' | 'over'
export type Mode = 'classic' | 'pulley' | 'endless' | 'puzzle'
export const MODES: readonly Mode[] = ['classic', 'pulley', 'endless', 'puzzle']
export type Difficulty = 'easy' | 'normal' | 'hard'
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard']

// Lifetime counters, kept across games by the app.
export type Stats = {
  games: number
  shots: number
  popped: number
  dropped: number
  biggestDrop: number
  longestCombo: number
  levelsCleared: number
  pickups: number
  bestWave: number
}
export const emptyStats = (): Stats => ({ games: 0, shots: 0, popped: 0, dropped: 0, biggestDrop: 0, longestCombo: 0, levelsCleared: 0, pickups: 0, bestWave: 0 })

export type Flying = { x: number; y: number; vx: number; vy: number; type: number }
export type Falling = { x: number; y: number; type: number }

export type Game = {
  phase: Phase
  mode: Mode
  difficulty: Difficulty
  stats: Stats
  field: Uint8Array        // 0 = empty, 1..MAX_TYPES = colour, STAR/RAINBOW/STONE specials; index = y * COLS + x
  cols: number             // playable width; field stride stays COLS
  speed: number            // cells the flying bubble moves per tick
  wallCol: number          // rightmost playable column; bubbles here are "attached"
  shift: number            // pulley: + means the top group hangs closer to the shooter, - the bottom
  level: number
  levelReached: number     // highest level ever reached; persisted, caps the start level
  startLevel: number       // level the next game starts on, chosen on the title screen
  score: number
  highScore: number
  shots: number            // shots this level
  levelBubbles: number     // bubbles the level started with; sets par for the clear bonus
  lastLevelShots: number   // shots the last cleared level took
  lastBonus: number        // clear bonus the last level paid
  loaded: number           // bubble type sitting in the shooter
  next: number             // bubble type queued after it
  next2: number            // and the one after that
  combo: number            // consecutive shots that removed something; multiplies the score
  shotsLeft: number        // puzzle mode: shots before the level is lost; -1 elsewhere
  hardAim: boolean         // show the aim guide only up to its first bounce
  justCleared: boolean     // the last shot emptied the board (consumed by the app)
  pickups: number[]        // cells holding a ＋; fly through one to load a special
  continues: number        // second chances left this game
  aimDeg: number           // base aim in degrees, + is up
  trimDeg: number          // swipe-controlled offset
  flying: Flying | null
  queuedShot: boolean      // a tap during a flight: fire again as soon as this shot lands
  trail: number[]          // recent cells crossed by the flying bubble
  flash: number[]          // origins of popped/dropped bubbles
  falling: Falling[]       // detached bubbles animated below their origins
  blast: number[][]        // shockwave rings (empty cells) around a big clear, innermost first
  effectFrame: number      // counts down from effectFrames to 0 (inactive)
  effectFrames: number     // length of the current effect
  lastClear: number        // bubbles removed by the last shot (popped + dropped)
  ticks: number            // frames since the level started; drives blinking
  idleTicks: number        // frames since the last shot; the wall hurries you along
  won: boolean
  ranked: boolean          // started at level 1, so the score competes for the best
  newBest: boolean         // this game's score beat the previous best
  quit: boolean
}

export const idx = (x: number, y: number): number => y * COLS + x

export const isPlaying = (g: Game): boolean => g.phase === 'play'
export const isOver = (g: Game): boolean => g.phase === 'over'
export const isColour = (t: number): boolean => t >= 1 && t <= MAX_TYPES
export const isMystery = (t: number): boolean => t > MYSTERY_BASE && t <= MYSTERY_BASE + MAX_TYPES
export const mysteryColour = (t: number): number => t - MYSTERY_BASE
export const isSpecial = (t: number): boolean =>
  t === STAR || t === RAINBOW || t === STONE || t === BOMB || t === FROZEN || t === CRACKED || isMystery(t)

export function createGame(): Game {
  return {
    phase: 'splash',
    mode: 'pulley', // the default; classic is the opt-out
    difficulty: 'normal',
    stats: emptyStats(),
    field: new Uint8Array(COLS * ROWS),
    cols: COLS,
    speed: BUBBLE_SPEED,
    wallCol: COLS - WALL_INSET,
    shift: 0,
    level: 1,
    levelReached: 1,
    startLevel: 1,
    score: 0,
    highScore: 0,
    shots: 0,
    levelBubbles: 0,
    lastLevelShots: 0,
    lastBonus: 0,
    loaded: 1,
    next: 2,
    next2: 3,
    combo: 0,
    shotsLeft: -1,
    hardAim: false,
    justCleared: false,
    pickups: [],
    continues: CONTINUES,
    aimDeg: 0,
    trimDeg: 0,
    flying: null,
    queuedShot: false,
    trail: [],
    flash: [],
    falling: [],
    blast: [],
    effectFrame: 0,
    effectFrames: EFFECT_FRAMES,
    lastClear: 0,
    ticks: 0,
    idleTicks: 0,
    won: false,
    ranked: true,
    newBest: false,
    quit: false,
  }
}

function randomInt(n: number): number {
  return Math.floor(Math.random() * n)
}

function occupied(g: Game, x: number, y: number): boolean {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS && g.field[idx(x, y)] !== 0
}

function coloursPresent(g: Game): number[] {
  const seen = new Set<number>()
  for (const t of g.field) {
    if (isColour(t)) seen.add(t)
    else if (isMystery(t)) seen.add(mysteryColour(t))
  }
  return [...seen]
}

function randomColour(count: number): number {
  return 1 + randomInt(Math.max(1, Math.min(MAX_TYPES, count)))
}

// Shots are colours on the board, with the odd rainbow once specials are in play.
function randomLoadable(g: Game): number {
  if (g.level >= SPECIALS_FROM_LEVEL && Math.random() < RAINBOW_SHOT_CHANCE) return RAINBOW
  const present = coloursPresent(g)
  if (present.length === 0) return 1 + randomInt(MAX_TYPES)
  return present[randomInt(present.length)]
}

export const LEVEL_COUNT = LEVELS.length

// Pacing by difficulty and, in endless, by how far you have got.
export const wallEvery = (g: Game): number => WALL_EVERY[g.difficulty]
export const pushEvery = (g: Game): number =>
  Math.max(PUSH_EVERY_MIN, PUSH_EVERY_START[g.difficulty] - Math.floor((g.level - 1) / PUSH_TIGHTEN_WAVES))
export const paceEvery = (g: Game): number => (g.mode === 'endless' ? pushEvery(g) : wallEvery(g))
const hurryScale = (g: Game): number =>
  HURRY_SCALE[g.difficulty] * (g.mode === 'endless' ? pushEvery(g) / PUSH_EVERY_START[g.difficulty] : 1)
export const hurryWarnTicks = (g: Game): number => Math.round(HURRY_WARN_TICKS * hurryScale(g))
export const hurryTicks = (g: Game): number => Math.round(HURRY_TICKS * hurryScale(g))

// A small seeded generator (mulberry32) so a generated level is the same for everyone.
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Levels past the 100 Frozen Bubble layouts: a hanging layout in the same
// 9-row, 10-deep format. Each column can only hold a bubble where the column
// nearer the wall has one within a row of it, so everything hangs from the
// wall; the first column always has a few. Deeper levels are denser and use
// more colours; every other level is mirrored top to bottom.
export function generateLevel(n: number): string[] {
  const rnd = seeded(n * 2654435761)
  const colours = Math.min(MAX_TYPES, 4 + Math.floor((n - LEVEL_COUNT) / 10))
  const density = Math.min(0.9, 0.6 + (n - LEVEL_COUNT) / 400)
  const mirror = n % 2 === 0
  const rowsToFill = mirror ? Math.ceil(ROWS / 2) : ROWS
  const grid: number[][] = Array.from({ length: ROWS }, () => new Array(LEVEL_DEPTH).fill(0))
  for (let d = 0; d < LEVEL_DEPTH; d++) {
    for (let y = 0; y < rowsToFill; y++) {
      const supported = d === 0 || [y - 1, y, y + 1].some((yy) => yy >= 0 && yy < ROWS && grid[yy][d - 1])
      if (!supported) continue
      const p = density * (1 - d / (LEVEL_DEPTH + 2))
      if (rnd() < p) grid[y][d] = 1 + Math.floor(rnd() * colours)
    }
    if (d === 0 && grid.filter((row) => row[0]).length < 3) {
      for (const y of [0, Math.floor(rowsToFill / 2), rowsToFill - 1]) if (!grid[y][0]) grid[y][0] = 1 + Math.floor(rnd() * colours)
    }
  }
  if (mirror) for (let y = 0; y < ROWS; y++) if (y >= rowsToFill) grid[y] = grid[ROWS - 1 - y].slice()
  return grid.map((row) => row.map((t) => (t ? String(t) : '.')).join(''))
}

export const layoutFor = (level: number): readonly string[] =>
  level <= LEVEL_COUNT ? LEVELS[level - 1] : generateLevel(level)

// Pulley mode hangs two groups from one axle on the shooter row: rows above
// it and rows below it, each on its own wall. The heavier group hangs closer
// to the shooter. The shooter row itself is the axle's row and keeps the base wall.
export function wallFor(g: Game, y: number): number {
  if (g.mode !== 'pulley' || y === SHOOTER_Y) return g.wallCol
  return y < SHOOTER_Y ? g.wallCol - Math.max(0, g.shift) : g.wallCol - Math.max(0, -g.shift)
}

function rowGroup(y: number): 'top' | 'bottom' | 'axle' {
  return y < SHOOTER_Y ? 'top' : y > SHOOTER_Y ? 'bottom' : 'axle'
}

function countGroup(g: Game, group: 'top' | 'bottom'): number {
  let n = 0
  for (let y = 0; y < ROWS; y++) {
    if (rowGroup(y) !== group) continue
    for (let x = 0; x < COLS; x++) if (g.field[idx(x, y)]) n++
  }
  return n
}

// Pickups sit in field space, so they move with the field and vanish when
// a bubble lands on them or they leave the board.
function shiftPickups(g: Game, by: number, rows?: (y: number) => boolean): void {
  g.pickups = g.pickups
    .map((c) => {
      const x = c % COLS, y = Math.floor(c / COLS)
      if (rows && !rows(y)) return c
      const nx = x + by
      return nx >= DEAD_COL + 2 && nx < COLS ? idx(nx, y) : -1
    })
    .filter((c) => c >= 0 && !g.field[c])
}

function moveRows(g: Game, group: 'top' | 'bottom', by: number): void {
  if (by === 0) return
  shiftPickups(g, by, (y) => rowGroup(y) === group)
  for (let y = 0; y < ROWS; y++) {
    if (rowGroup(y) !== group) continue
    const row = g.field.subarray(y * COLS, (y + 1) * COLS)
    const copy = Uint8Array.from(row)
    row.fill(0)
    for (let x = 0; x < COLS; x++) {
      const nx = x + by
      if (copy[x] && nx >= 0 && nx < COLS) row[nx] = copy[x]
    }
  }
}

// Re-hang the groups after the board changed. Returns true when something moved.
function rebalance(g: Game): boolean {
  if (g.mode !== 'pulley') return false
  const diff = countGroup(g, 'top') - countGroup(g, 'bottom')
  const target = Math.max(-PULLEY_MAX_SHIFT, Math.min(PULLEY_MAX_SHIFT, Math.round(diff / PULLEY_WEIGHT)))
  if (target === g.shift) return false
  const before = { top: wallFor(g, 0), bottom: wallFor(g, ROWS - 1) }
  g.shift = target
  moveRows(g, 'top', wallFor(g, 0) - before.top)
  moveRows(g, 'bottom', wallFor(g, ROWS - 1) - before.bottom)
  return true
}

function seedSpecials(g: Game): void {
  if (g.level < SPECIALS_FROM_LEVEL) return
  const cells: number[] = []
  for (let c = 0; c < g.field.length; c++) if (isColour(g.field[c])) cells.push(c)
  const place = (type: number, count: number) => {
    for (let i = 0; i < count && cells.length; i++) {
      const at = randomInt(cells.length)
      g.field[cells[at]] = type
      cells.splice(at, 1)
    }
  }
  const tier = g.level - SPECIALS_FROM_LEVEL
  place(STAR, Math.random() < 0.5 ? 1 : 0)
  place(RAINBOW, 1 + (tier >= 2 ? randomInt(2) : 0))
  if (tier >= 1) place(BOMB, Math.random() < 0.5 ? 1 : 0)
  if (tier >= 2) place(FROZEN, 1 + randomInt(2))
  if (tier >= 3) place(STONE, 1 + randomInt(2))
  // Mysteries keep their colour, hidden: pick cells and wrap what is there.
  const hide = 1 + randomInt(3)
  for (let i = 0; i < hide && cells.length; i++) {
    const at = randomInt(cells.length)
    g.field[cells[at]] = MYSTERY_BASE + g.field[cells[at]]
    cells.splice(at, 1)
  }
}

// Endless mode: the palette widens as the waves go on.
const endlessColours = (wave: number): number => Math.min(MAX_TYPES, 4 + Math.floor((wave - 1) / 3))

function fillEndless(g: Game): void {
  const colours = endlessColours(g.level)
  for (let y = 0; y < ROWS; y++) {
    for (let d = 0; d < ENDLESS_START_DEPTH; d++) g.field[idx(g.wallCol - d, y)] = randomColour(colours)
  }
}

// Endless mode: everything moves one column toward the shooter and a fresh
// column, with the odd gap and special, fills in against the wall.
function pushColumn(g: Game): void {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS - 1; x++) g.field[idx(x, y)] = g.field[idx(x + 1, y)]
    g.field[idx(COLS - 1, y)] = 0
  }
  shiftPickups(g, -1)
  const colours = endlessColours(g.level)
  for (let y = 0; y < ROWS; y++) {
    if (Math.random() < 0.15) continue
    let t = randomColour(colours)
    if (g.level >= 2 && Math.random() < 0.06) t = [STAR, RAINBOW, BOMB, FROZEN, STONE][randomInt(5)]
    else if (g.level >= 2 && Math.random() < 0.08) t = MYSTERY_BASE + t
    g.field[idx(g.wallCol, y)] = t
  }
  // A gap in the new column can leave a bubble with nothing to hang from
  // once its only support was a diagonal neighbour: it falls, unscored.
  if (dropDetached(g) > 0 && g.effectFrame === 0) {
    g.effectFrames = EFFECT_FRAMES
    g.effectFrame = EFFECT_FRAMES
  }
  g.level++ // a wave
}

export const puzzleShots = (levelBubbles: number, difficulty: Difficulty = 'normal'): number =>
  Math.ceil(levelBubbles / 2) + PUZZLE_EXTRA[difficulty]

// Loads Frozen Bubble level N (wrapping after the last one). Column 0 of the
// level data sits against the wall.
export function fillLevel(g: Game): void {
  g.field.fill(0)
  g.wallCol = g.cols - WALL_INSET
  g.shift = 0
  if (g.mode === 'endless') {
    fillEndless(g)
  } else {
    const layout = layoutFor(g.level)
    for (let y = 0; y < ROWS && y < layout.length; y++) {
      if (g.mode === 'pulley' && y === SHOOTER_Y) continue // the axle row stays clear
      const row = layout[y]
      for (let d = 0; d < LEVEL_DEPTH && d < row.length; d++) {
        const ch = row[d]
        if (ch === '.') continue
        const type = Number(ch)
        if (type >= 1 && type <= MAX_TYPES) g.field[idx(g.wallCol - d, y)] = type
      }
    }
    if (g.mode === 'pulley') {
      // Without the axle row some bubbles lose their support; they are simply not there.
      const attached = attachedCells(g)
      for (let c = 0; c < g.field.length; c++) if (g.field[c] && !attached.has(c)) g.field[c] = 0
      rebalance(g)
    }
    seedSpecials(g)
  }
  g.levelBubbles = g.field.reduce((n, t) => n + (t ? 1 : 0), 0)
  g.shotsLeft = g.mode === 'puzzle' ? puzzleShots(g.levelBubbles, g.difficulty) : -1
  g.loaded = randomLoadable(g)
  g.next = randomLoadable(g)
  g.next2 = randomLoadable(g)
  g.shots = 0
  g.ticks = 0
  g.idleTicks = 0
  g.flying = null
  g.queuedShot = false // a new layout should not be shot at blind
  g.pickups = []
  g.trail = []
  g.flash = []
  g.falling = []
  g.blast = []
  g.effectFrame = 0
}

export type GameOptions = { cols?: number; speed?: number; level?: number }

const clampLevel = (g: Game, level: number): number => Math.max(1, Math.min(g.levelReached, Math.round(level)))

// On the title screen, swipes move the start level between 1 and the
// highest level reached. Returns true when it changed.
export function chooseStartLevel(g: Game, delta: number): boolean {
  const next = clampLevel(g, g.startLevel + delta)
  if (next === g.startLevel) return false
  g.startLevel = next
  return true
}

export function startGame(g: Game, opts: GameOptions = {}): void {
  g.cols = Math.min(COLS, opts.cols ?? COLS)
  g.speed = opts.speed ?? BUBBLE_SPEED
  g.level = clampLevel(g, opts.level ?? g.startLevel)
  g.score = 0
  g.won = false
  g.ranked = g.level === 1
  g.newBest = false
  g.quit = false
  g.aimDeg = 0
  g.trimDeg = 0
  g.lastBonus = 0
  g.lastLevelShots = 0
  g.combo = 0
  g.justCleared = false
  g.continues = CONTINUES
  g.stats.games++
  if (g.mode === 'endless') g.level = 1 // waves always start from the first
  fillLevel(g)
  g.phase = 'play'
}

// The second chance: the columns nearest the shooter are cleared and play
// goes on, unranked. Puzzle mode gets a few shots back as well.
export function continueGame(g: Game): boolean {
  if (g.phase !== 'over' || g.won || g.continues <= 0) return false
  g.continues--
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < DEAD_COL + CONTINUE_CLEAR; x++) g.field[idx(x, y)] = 0
  }
  if (g.mode === 'puzzle') g.shotsLeft = Math.max(g.shotsLeft, PUZZLE_EXTRA[g.difficulty])
  g.ranked = false
  g.combo = 0
  g.flying = null
  g.queuedShot = false
  g.trail = []
  g.flash = []; g.falling = []; g.blast = []; g.effectFrame = 0
  g.idleTicks = 0
  g.phase = 'play'
  return true
}

// Specials a pickup can load into the next slot.
const PICKUP_SPECIALS = [RAINBOW, BOMB, STAR]

// After a shot, maybe put a ＋ somewhere in the open field: an empty cell
// well clear of the walls and the loss zone, never on the shooter row's
// first cells. Pickups under a bubble (after a wall move) are dropped.
function placePickup(g: Game): void {
  g.pickups = g.pickups.filter((c) => !g.field[c])
  if (g.pickups.length || g.level < PICKUP_FROM_LEVEL || Math.random() >= PICKUP_CHANCE) return
  const candidates: number[] = []
  for (let y = 0; y < ROWS; y++) {
    const limit = wallFor(g, y) - PICKUP_MARGIN
    for (let x = DEAD_COL + 2; x < limit; x++) {
      const c = idx(x, y)
      if (g.field[c]) continue
      let nearBubble = false
      forEachNeighbour(x, y, (nx, ny) => { if (g.field[idx(nx, ny)]) nearBubble = true })
      if (!nearBubble) candidates.push(c)
    }
  }
  if (candidates.length) g.pickups.push(candidates[randomInt(candidates.length)])
}

function collectPickup(g: Game, cell: number): boolean {
  const at = g.pickups.indexOf(cell)
  if (at < 0) return false
  g.pickups.splice(at, 1)
  g.stats.pickups++
  g.next = PICKUP_SPECIALS[randomInt(PICKUP_SPECIALS.length)]
  if (g.effectFrame === 0) {
    g.flash = [cell]
    g.falling = []
    g.blast = []
    g.effectFrames = EFFECT_FRAMES
    g.effectFrame = EFFECT_FRAMES
  }
  return true
}

// Hold: the loaded and the next bubble change places.
export function swapBubbles(g: Game): boolean {
  if (g.phase !== 'play' || g.loaded === g.next) return false
  ;[g.loaded, g.next] = [g.next, g.loaded]
  return true
}

export const comboMultiplier = (g: Game): number => Math.max(1, Math.min(COMBO_MAX, g.combo))

// The harder path after a clear: skip the next level for a bonus.
export function skipLevel(g: Game): boolean {
  if (g.phase !== 'play' || g.level >= MAX_LEVEL || g.mode === 'endless') return false
  g.level++
  g.levelReached = Math.min(MAX_LEVEL, Math.max(g.levelReached, g.level))
  g.score += SKIP_POINTS
  fillLevel(g)
  return true
}

export function clampAngle(deg: number): number {
  return Math.max(-MAX_ANGLE_DEG, Math.min(MAX_ANGLE_DEG, deg))
}

export function aimAngle(g: Game): number {
  return clampAngle(g.aimDeg + g.trimDeg)
}

export function setAim(g: Game, deg: number): void {
  g.aimDeg = deg
}

export function nudgeAim(g: Game, deg: number): void {
  g.trimDeg += deg
  // Keep the combined aim inside the limit so a nudge always has an effect.
  const total = g.aimDeg + g.trimDeg
  if (total > MAX_ANGLE_DEG) g.trimDeg = MAX_ANGLE_DEG - g.aimDeg
  if (total < -MAX_ANGLE_DEG) g.trimDeg = -MAX_ANGLE_DEG - g.aimDeg
}

// A swipe moves the aim to the next landing cell in that direction: the
// smallest whole degree, up to SWIPE_AIM_DEG, at which the predicted landing
// changes. Where landings are dense the step is fine; where the line bounces
// and they are sparse it still moves the full step. Returns true if it moved.
export function nudgeToNextLanding(g: Game, direction: 1 | -1, maxDeg: number): boolean {
  const start = aimAngle(g)
  const from = landingCell(g)
  for (let d = 1; d <= maxDeg; d++) {
    const target = start + direction * d
    if (Math.abs(target) > MAX_ANGLE_DEG) break
    g.trimDeg = target - g.aimDeg
    if (landingCell(g) !== from) return true
  }
  const limit = clampAngle(start + direction * maxDeg)
  g.trimDeg = limit - g.aimDeg
  return aimAngle(g) !== start
}

function landingCell(g: Game): number {
  const path = aimPath(g)
  return path.length ? path[path.length - 1] : -1
}

type Mover = { x: number; y: number; vx: number; vy: number }

// One sub-step of motion with reflection off the top and bottom edges. Shared
// by the aim line and the flight so the line predicts the landing exactly.
function stepMover(p: Mover, ds: number): void {
  p.x += p.vx * ds
  p.y += p.vy * ds
  if (p.y < 0) { p.y = -p.y; p.vy = -p.vy }
  if (p.y > ROWS - 1) { p.y = 2 * (ROWS - 1) - p.y; p.vy = -p.vy }
}

function direction(g: Game): { vx: number; vy: number } {
  const rad = (aimAngle(g) * Math.PI) / 180
  return { vx: Math.cos(rad), vy: -Math.sin(rad) } // screen y grows downward
}

// A bubble settles in cell (x, y) when it reaches that row's wall or touches
// any bubble around it.
function canLand(g: Game, x: number, y: number): boolean {
  if (x >= wallFor(g, y)) return true
  for (const [dx, dy] of CONTACT) {
    const nx = x + dx, ny = y + dy
    if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && g.field[idx(nx, ny)]) return true
  }
  return false
}

// The next bubble moves into the shooter as soon as a shot leaves, so the aim
// line shown during the flight is for the bubble you will actually fire next.
// A tap during a flight queues one shot, fired the tick after this one lands.
export function fire(g: Game): boolean {
  if (g.phase !== 'play') return false
  if (g.flying) {
    g.queuedShot = true
    return true
  }
  g.queuedShot = false
  const { vx, vy } = direction(g)
  g.flying = { x: SHOOTER_X, y: SHOOTER_Y, vx, vy, type: g.loaded }
  g.trail = []
  g.idleTicks = 0
  g.stats.shots++
  g.loaded = g.next
  g.next = g.next2
  g.next2 = randomLoadable(g)
  return true
}

// Cells the aim line passes through, bouncing off the top and bottom edges,
// up to where the bubble would settle. Shooter cell excluded.
export function aimPath(g: Game): number[] {
  const out: number[] = []
  const { vx, vy } = direction(g)
  const p: Mover = { x: SHOOTER_X, y: SHOOTER_Y, vx, vy }
  let px = SHOOTER_X, py = SHOOTER_Y
  for (let i = 0; i < AIM_MAX_STEPS; i++) {
    stepMover(p, SUBSTEP)
    const cx = Math.round(p.x), cy = Math.round(p.y)
    if (cx === px && cy === py) continue
    if (occupied(g, cx, cy)) break
    out.push(idx(cx, cy))
    if (canLand(g, cx, cy)) break
    px = cx; py = cy
  }
  return out
}

// A rainbow joins any colour; stones and stars never join a match.
const joins = (t: number, colour: number): boolean => t === colour || t === RAINBOW

function floodColour(g: Game, start: number, colour: number): number[] {
  const stack = [start]
  const seen = new Set<number>([start])
  while (stack.length) {
    const c = stack.pop()!
    forEachNeighbour(c % COLS, Math.floor(c / COLS), (nx, ny) => {
      const n = idx(nx, ny)
      if (!seen.has(n) && joins(g.field[n], colour)) { seen.add(n); stack.push(n) }
    })
  }
  return [...seen]
}

// The cluster a landed bubble forms. A rainbow (or star) shot takes whichever
// neighbouring colour gives the biggest cluster.
function clusterAt(g: Game, start: number): { cells: number[]; colour: number } {
  const type = g.field[start]
  if (isColour(type)) return { cells: floodColour(g, start, type), colour: type }
  let best: { cells: number[]; colour: number } = { cells: [start], colour: 0 }
  const tried = new Set<number>()
  forEachNeighbour(start % COLS, Math.floor(start / COLS), (nx, ny) => {
    const t = g.field[idx(nx, ny)]
    if (!isColour(t) || tried.has(t)) return
    tried.add(t)
    const cells = floodColour(g, start, t)
    if (cells.length > best.cells.length) best = { cells, colour: t }
  })
  return best
}

function attachedCells(g: Game): Set<number> {
  const seen = new Set<number>()
  const stack: number[] = []
  for (let y = 0; y < ROWS; y++) {
    const c = idx(wallFor(g, y), y)
    if (g.field[c]) { seen.add(c); stack.push(c) }
  }
  while (stack.length) {
    const c = stack.pop()!
    forEachNeighbour(c % COLS, Math.floor(c / COLS), (nx, ny) => {
      const n = idx(nx, ny)
      if (!seen.has(n) && g.field[n]) { seen.add(n); stack.push(n) }
    })
  }
  return seen
}

function fieldEmpty(g: Game): boolean {
  return g.field.every((t) => t === 0)
}

function anyBubbleDead(g: Game): boolean {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < DEAD_COL; x++) if (g.field[idx(x, y)]) return true
  }
  return false
}

function advanceWall(g: Game): void {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS - 1; x++) g.field[idx(x, y)] = g.field[idx(x + 1, y)]
    g.field[idx(COLS - 1, y)] = 0
  }
  g.wallCol--
  shiftPickups(g, -1)
}

function endGame(g: Game, won: boolean): void {
  g.phase = 'over'
  g.won = won
  g.startLevel = clampLevel(g, g.level) // "play again" continues on this level
  g.flying = null
  g.queuedShot = false
  g.trail = []
  if (g.ranked && g.score > g.highScore) {
    g.highScore = g.score
    g.newBest = true
  }
}

export const dropPoints = (dropped: number): number =>
  DROP_BASE_POINTS * (2 ** Math.min(dropped, DROP_CAP) - 1)

// Fewer shots than par pays a bonus; par is half the bubbles the level started with.
export const clearBonus = (levelBubbles: number, shots: number): number =>
  Math.max(0, Math.ceil(levelBubbles / 2) - shots) * BONUS_PER_SHOT

// Empty cells touching any of the given cells, excluding the cells themselves.
function ringAround(g: Game, inner: Set<number>, exclude: Set<number>): number[] {
  const ring = new Set<number>()
  for (const c of inner) {
    forEachNeighbour(c % COLS, Math.floor(c / COLS), (nx, ny) => {
      const n = idx(nx, ny)
      if (!g.field[n] && !inner.has(n) && !exclude.has(n)) ring.add(n)
    })
  }
  return [...ring]
}

// Removes every bubble no longer hanging from a wall. Returns how many fell.
function dropDetached(g: Game): number {
  const attached = attachedCells(g)
  let dropped = 0
  for (let c = 0; c < g.field.length; c++) {
    if (g.field[c] && !attached.has(c)) {
      g.falling.push({ x: c % COLS, y: Math.floor(c / COLS), type: g.field[c] })
      g.field[c] = 0
      dropped++
      g.flash.push(c)
    }
  }
  return dropped
}

function startEffect(g: Game, removed: number): void {
  g.lastClear = removed
  g.blast = []
  if (removed >= BLAST_SIZE) {
    const gone = new Set(g.flash)
    const ring1 = ringAround(g, gone, gone)
    g.blast.push(ring1)
    if (removed >= 2 * BLAST_SIZE) g.blast.push(ringAround(g, new Set(ring1), gone))
  }
  g.effectFrames = g.blast.length ? BLAST_FRAMES : EFFECT_FRAMES
  g.effectFrame = g.effectFrames
}

function settle(g: Game, x: number, y: number, type: number): void {
  x = Math.min(x, wallFor(g, y))
  const at = idx(x, y)
  g.field[at] = type
  g.flying = null
  g.trail = []
  g.shots++

  if (g.shotsLeft > 0) g.shotsLeft--
  const { cells: cluster, colour } = clusterAt(g, at)

  const popped = new Set<number>()
  // A star next to the landing clears every bubble of the landed colour.
  const stars: number[] = []
  forEachNeighbour(x, y, (nx, ny) => { if (g.field[idx(nx, ny)] === STAR) stars.push(idx(nx, ny)) })
  if (type === BOMB) {
    popped.add(at)
    forEachNeighbour(x, y, (nx, ny) => { const n = idx(nx, ny); if (g.field[n] && g.field[n] !== BOMB) popped.add(n) })
  } else if (type === STAR && colour) {
    popped.add(at)
    for (let c = 0; c < g.field.length; c++) if (g.field[c] === colour) popped.add(c)
  } else if (stars.length && colour) {
    for (const s of stars) popped.add(s)
    popped.add(at)
    for (let c = 0; c < g.field.length; c++) if (g.field[c] === colour) popped.add(c)
  } else if (cluster.length >= 3) {
    for (const c of cluster) popped.add(c)
  }
  // A bomb next to the landing takes everything around it, and any bomb
  // caught in that goes off too.
  const bombs: number[] = []
  forEachNeighbour(x, y, (nx, ny) => { if (g.field[idx(nx, ny)] === BOMB) bombs.push(idx(nx, ny)) })
  if (type === BOMB) bombs.push(at)
  if (bombs.length) popped.add(at)
  while (bombs.length) {
    const b = bombs.pop()!
    if (popped.has(b)) continue
    popped.add(b)
    forEachNeighbour(b % COLS, Math.floor(b / COLS), (nx, ny) => {
      const n = idx(nx, ny)
      if (!g.field[n] || popped.has(n)) return
      if (g.field[n] === BOMB) bombs.push(n)
      else popped.add(n)
    })
  }
  // Ice beside a pop cracks; cracked ice beside a pop comes away.
  const edge = new Set<number>()
  for (const c of popped) {
    forEachNeighbour(c % COLS, Math.floor(c / COLS), (nx, ny) => { const n = idx(nx, ny); if (!popped.has(n)) edge.add(n) })
  }
  for (const n of edge) {
    if (g.field[n] === CRACKED) popped.add(n)
    else if (g.field[n] === FROZEN) g.field[n] = CRACKED
  }
  // Mysteries beside the landing or beside a pop show their colour.
  const reveal = new Set<number>(edge)
  forEachNeighbour(x, y, (nx, ny) => reveal.add(idx(nx, ny)))
  for (const n of reveal) if (isMystery(g.field[n]) && !popped.has(n)) g.field[n] = mysteryColour(g.field[n])

  let removed = 0
  if (popped.size) {
    g.combo++
    const times = comboMultiplier(g)
    g.flash = []
    g.falling = []
    for (const c of popped) g.field[c] = 0
    g.score += POP_POINTS * popped.size * times
    g.flash.push(...popped)
    const dropped = dropDetached(g)
    g.score += dropPoints(dropped) * times
    removed = popped.size + dropped
    g.stats.popped += popped.size
    g.stats.dropped += dropped
    g.stats.biggestDrop = Math.max(g.stats.biggestDrop, dropped)
    g.stats.longestCombo = Math.max(g.stats.longestCombo, g.combo)
  } else {
    g.combo = 0
  }

  // Pulley: the lighter side rises, the heavier sinks toward the shooter,
  // and whatever that tears loose falls too.
  if (g.mode === 'pulley' && rebalance(g)) {
    if (!popped.size) { g.flash = []; g.falling = [] }
    const dropped = dropDetached(g)
    g.score += dropPoints(dropped) * comboMultiplier(g)
    removed += dropped
  }

  if (removed) startEffect(g, removed)
  else g.lastClear = 0

  placePickup(g)

  if (fieldEmpty(g)) {
    g.lastLevelShots = g.shots
    g.lastBonus = clearBonus(g.levelBubbles, g.shots)
    g.score += LEVEL_POINTS + g.lastBonus
    g.stats.levelsCleared++
    // Clearing the hundredth layout is the ending (endless has no last wave).
    // Generated levels lie beyond it for anyone who wants to keep going.
    if (g.mode !== 'endless' && g.level === LEVEL_COUNT) {
      g.levelReached = Math.max(g.levelReached, LEVEL_COUNT + 1)
      endGame(g, true)
      return
    }
    g.level++
    if (g.mode !== 'endless') g.levelReached = Math.min(MAX_LEVEL, Math.max(g.levelReached, g.level))
    g.justCleared = true
    fillLevel(g)
    return
  }
  if (anyBubbleDead(g)) { endGame(g, false); return }

  if (g.mode === 'puzzle') {
    if (g.shotsLeft === 0) endGame(g, false)
    return
  }
  if (g.mode === 'endless') {
    if (g.shots % pushEvery(g) === 0) {
      pushColumn(g)
      g.stats.bestWave = Math.max(g.stats.bestWave, g.level)
      if (anyBubbleDead(g)) { endGame(g, false); return }
    }
    return
  }
  if (g.shots % wallEvery(g) === 0) {
    advanceWall(g)
    if (anyBubbleDead(g)) { endGame(g, false); return }
  }
}

// The wall is about to move: the last shot before an advance, or the player
// has been idle long enough for the hurry-up.
export const wallWarning = (g: Game): boolean => {
  if (g.mode === 'puzzle') return false
  const every = paceEvery(g)
  return g.shots % every === every - 1 || (hurries(g) && g.idleTicks >= hurryWarnTicks(g))
}

// Puzzle mode has no clock and no moving wall: it is for thinking. Easy never hurries.
const hurries = (g: Game): boolean => g.mode !== 'puzzle' && HURRY_SCALE[g.difficulty] > 0

export const blinkOn = (g: Game): boolean => Math.floor(g.ticks / BLINK_TICKS) % 2 === 0

// Advance one frame. Returns true when something on screen may have changed.
// Advances the game by dt ticks (default one). The loop passes the real time
// elapsed since the last tick, so shot speed, effects and the hurry-up clock
// run at the same pace whatever the glasses' frame rate.
export function tick(g: Game, dt = 1): boolean {
  if (g.phase !== 'play') return false
  const wasBlinkOn = blinkOn(g)
  g.ticks += dt
  let changed = false
  if (g.effectFrame > 0) {
    g.effectFrame = Math.max(0, g.effectFrame - dt)
    changed = true
    if (g.effectFrame === 0) {
      g.flash = []
      g.falling = []
      g.blast = []
    }
  }
  if (wallWarning(g) && blinkOn(g) !== wasBlinkOn) changed = true

  const f = g.flying
  if (!f) {
    if (g.queuedShot) return fire(g) || changed
    if (hurries(g)) g.idleTicks += dt
    if (hurries(g) && g.idleTicks >= hurryTicks(g)) {
      g.idleTicks = 0
      if (g.mode === 'endless') pushColumn(g)
      else advanceWall(g)
      if (anyBubbleDead(g)) endGame(g, false)
      return true
    }
    return changed
  }

  let px = Math.round(f.x), py = Math.round(f.y)
  g.trail = []
  const steps = Math.max(1, Math.round(g.speed * dt / SUBSTEP))
  for (let i = 0; i < steps; i++) {
    stepMover(f, SUBSTEP)
    const cx = Math.round(f.x), cy = Math.round(f.y)
    if (cx === px && cy === py) continue
    const previous = idx(px, py)
    if (g.trail[g.trail.length - 1] !== previous) {
      g.trail.push(previous)
      if (g.trail.length > 3) g.trail.shift()
    }
    collectPickup(g, idx(cx, cy))
    if (occupied(g, cx, cy)) { settle(g, px, py, f.type); return true } // exact corner-on hit: both axes crossed in one substep
    if (canLand(g, cx, cy)) { settle(g, cx, cy, f.type); return true }
    px = cx; py = cy
  }
  return true
}
