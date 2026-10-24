import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { BOMB, FROZEN, MAX_LEVEL, MYSTERY_BASE, RAINBOW, SHOOTER_Y, STAR, STONE, SWIPE_AIM_DEG, TICK_MS } from './layout.ts'
import { aimAngle, chooseStartLevel, continueGame, createGame, emptyStats, fire, idx, isOver, isPlaying, nudgeToNextLanding, paceEvery, setAim, skipLevel, startGame, swapBubbles, tick, DIFFICULTIES, MODES, type Difficulty, type Game, type Mode, type Phase, type Stats } from './game.ts'
import { modeName, renderFireworks, renderGameOver, renderGrid, renderLevelCard, renderSplash } from './grid.ts'
import { currentPage, invalidate, pushScreen, showPage, type PageKind } from './renderer.ts'
import { toInput, type Input } from './events.ts'

const HIGH_SCORE_KEY = 'bubbles_high_score'  // classic; other modes append _<mode>
const LEVEL_KEY = 'bubbles_level_reached'
const MODE_KEY = 'bubbles_mode'
const HARD_AIM_KEY = 'bubbles_hard_aim'
const DIFFICULTY_KEY = 'bubbles_difficulty'
const STATS_KEY = 'bubbles_stats'
const highScoreKey = (mode: Mode) => (mode === 'classic' ? HIGH_SCORE_KEY : `${HIGH_SCORE_KEY}_${mode}`)

export type Status = {
  text: string              // what the game is doing right now, one short line
  page: PageKind | null     // null until the glasses have opened the page
  screen: string            // exactly what the glasses show
  phase: Phase
  mode: Mode
  difficulty: Difficulty
  hardAim: boolean
  levelReached: number
  stats: Stats
  level: number
  score: number
  best: number
  aim: number
  pace: { label: string; value: string }   // what the wall or shot count is doing, in this mode's terms
}

export type PreviewKind = 'over' | 'won' | 'title' | 'blast' | 'specials' | 'card'

export type App = {
  game: Game
  newGame: () => void
  centerAim: () => void
  setMode: (mode: Mode) => void
  setHardAim: (on: boolean) => void
  setDifficulty: (d: Difficulty) => void
  setStartLevel: (level: number) => void
  preview: (kind: PreviewKind) => void   // developer aid: shows an end screen with sample numbers
  status: () => Status
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function initApp(bridge: EvenAppBridge, onStatus: (s: Status) => void): Promise<App> {
  const game = createGame()
  let statusText = 'connecting'
  let loopRunning = false
  let overlayOpen = false
  let transitionRunning = false
  let screenText = ''
  let screenDirty = true
  let introRunning = false           // READY / GO: input is ignored
  let levelCardOpen = false          // waiting for a tap to go on
  let levelCardSkip = false          // the harder path is selected on the card
  let levelCardTap: (() => void) | null = null
  let continueOffered = false        // game over, with the second chance on the table

  async function loadHighScore(): Promise<void> {
    try {
      const hs = await bridge.getLocalStorage(highScoreKey(game.mode))
      game.highScore = hs ? parseInt(hs, 10) || 0 : 0
    } catch { game.highScore = 0 }
  }
  try {
    const reached = parseInt((await bridge.getLocalStorage(LEVEL_KEY)) ?? '', 10)
    if (reached > 1) {
      game.levelReached = Math.min(MAX_LEVEL, reached)
      game.startLevel = game.levelReached // a returning player continues where they got to
    }
    const savedDifficulty = await bridge.getLocalStorage(DIFFICULTY_KEY)
    if (DIFFICULTIES.includes(savedDifficulty as Difficulty)) game.difficulty = savedDifficulty as Difficulty
    try {
      const saved = JSON.parse((await bridge.getLocalStorage(STATS_KEY)) || '{}') as Partial<Stats>
      game.stats = { ...emptyStats(), ...saved }
    } catch { game.stats = emptyStats() }
    const savedMode = await bridge.getLocalStorage(MODE_KEY)
    if (MODES.includes(savedMode as Mode)) game.mode = savedMode as Mode
    game.hardAim = (await bridge.getLocalStorage(HARD_AIM_KEY)) === '1'
  } catch { /* phone-side storage is optional */ }
  await loadHighScore()

  screenText = renderSplash(game)

  // Each mode keeps its own best; endless scores are not comparable to a level run.
  const saveHighScore = () => { void bridge.setLocalStorage(highScoreKey(game.mode), String(game.highScore)).catch(() => {}) }
  let savedLevelReached = game.levelReached
  const saveProgress = () => {
    if (game.levelReached === savedLevelReached) return
    savedLevelReached = game.levelReached
    void bridge.setLocalStorage(LEVEL_KEY, String(game.levelReached)).catch(() => {})
  }
  const saveStats = () => { void bridge.setLocalStorage(STATS_KEY, JSON.stringify(game.stats)).catch(() => {}) }

  function currentScreen(): string {
    if (isPlaying(game)) return renderGrid(game)
    if (isOver(game)) return renderGameOver(game, continueOffered)
    return renderSplash(game)
  }

  const status = (): Status => ({
    text: statusText,
    page: currentPage(),
    screen: screenText,
    phase: game.phase,
    mode: game.mode,
    difficulty: game.difficulty,
    hardAim: game.hardAim,
    levelReached: game.levelReached,
    stats: game.stats,
    level: isPlaying(game) || isOver(game) ? game.level : game.startLevel,
    score: game.score,
    best: game.highScore,
    aim: Math.round(aimAngle(game)),
    pace: pace(),
  })
  const shots = (n: number) => `${n} ${n === 1 ? 'shot' : 'shots'}`
  const pace = (): { label: string; value: string } => {
    if (!isPlaying(game)) return { label: game.mode === 'puzzle' ? 'Shots left' : game.mode === 'endless' ? 'Next wave in' : 'Wall moves in', value: '–' }
    if (game.mode === 'puzzle') return { label: 'Shots left', value: String(Math.max(0, game.shotsLeft)) }
    const every = paceEvery(game)
    return { label: game.mode === 'endless' ? 'Next wave in' : 'Wall moves in', value: shots(every - (game.shots % every)) }
  }
  const aimText = () => {
    const deg = Math.round(aimAngle(game))
    return deg === 0 ? 'Aim centered' : `Aim ${deg > 0 ? 'up' : 'down'} ${Math.abs(deg)}°`
  }
  const report = (text?: string) => {
    if (text) statusText = text
    onStatus(status())
  }

  async function showCurrentScreen(): Promise<void> {
    const screen = currentScreen()
    screenText = screen
    screenDirty = false
    if (currentPage()) await pushScreen(bridge, screen)
    else await showPage(bridge, screen)
  }

  async function pushPlayScreen(): Promise<void> {
    // Clear first: input arriving during the BLE write marks the next frame
    // dirty instead of having its newer aim accidentally cleared.
    screenDirty = false
    const screen = renderGrid(game)
    screenText = screen
    await pushScreen(bridge, screen)
    onStatus(status())
  }

  async function pushText(text: string): Promise<void> {
    screenText = text
    await pushScreen(bridge, text)
    onStatus(status())
  }

  // READY, then GO, over the new layout. Input is ignored meanwhile.
  async function intro(): Promise<void> {
    introRunning = true
    try {
      await pushText(renderGrid(game, 'ＲＥＡＤＹ'))
      await sleep(700)
      await pushText(renderGrid(game, 'ＧＯ'))
      await sleep(400)
    } finally {
      introRunning = false
      screenDirty = true
    }
  }

  // Fireworks, then the level card until a tap. A swipe up on the card
  // picks the harder path: skip the next level for a bonus.
  async function showLevelUp(): Promise<void> {
    screenDirty = false
    for (let frame = 0; frame < 4; frame++) {
      await pushText(renderFireworks(game, frame))
      await sleep(60)
    }
    levelCardSkip = false
    levelCardOpen = true
    await pushText(renderLevelCard(game, levelCardSkip))
    report(`Level ${game.level - 1} cleared`)
    await new Promise<void>((resolve) => { levelCardTap = resolve })
    levelCardOpen = false
    levelCardTap = null
    if (levelCardSkip) { skipLevel(game); saveProgress() }
    invalidate()
    await pushText(renderGrid(game))
    await intro()
  }

  function levelCardInput(kind: 'tap' | 'up' | 'down'): void {
    if (kind === 'tap') { levelCardTap?.(); return }
    const skip = kind === 'up'
    if (skip === levelCardSkip) return
    levelCardSkip = skip
    void pushText(renderLevelCard(game, levelCardSkip))
  }

  async function loop(): Promise<void> {
    if (loopRunning) return
    loopRunning = true
    try {
      while (isPlaying(game)) {
        const started = Date.now()
        if (overlayOpen) {
          await sleep(TICK_MS)
          continue
        }
        const changed = tick(game)
        if (game.justCleared) {
          game.justCleared = false
          saveProgress()
          saveStats()
          if (isPlaying(game)) await showLevelUp()
        }
        if (changed || screenDirty) await pushPlayScreen()
        if (isOver(game)) {
          saveHighScore()
          saveProgress()
          saveStats()
          continueOffered = !game.won && game.continues > 0
          await sleep(300)
          await showCurrentScreen()
          report(game.won ? 'All levels cleared' : continueOffered ? 'Game over. Tap the glasses to continue once, swipe to end.' : 'Game over')
        }
        await sleep(Math.max(0, TICK_MS - (Date.now() - started)))
      }
    } finally {
      loopRunning = false
    }
  }

  async function begin(): Promise<void> {
    if (transitionRunning) return
    transitionRunning = true
    try {
      startGame(game)
      screenDirty = true
      invalidate()
      await showCurrentScreen()
      report('Playing')
      await intro()
      void loop()
    } finally {
      transitionRunning = false
    }
  }

  function centerAim(): void {
    setAim(game, 0)
    game.trimDeg = 0
    screenDirty = true
    report(aimText())
  }

  // Swipes on the title and game-over screens pick the level to start on.
  function pickLevel(delta: number): void {
    if (!chooseStartLevel(game, delta)) return
    screenDirty = true
    void showCurrentScreen().then(() => report(`Start at level ${game.startLevel}`))
  }

  async function refreshAfterOverlay(): Promise<void> {
    while (transitionRunning) await sleep(20)
    if (overlayOpen) return
    invalidate()
    await showCurrentScreen()
  }

  function setMode(mode: Mode): void {
    if (game.mode === mode) return
    game.mode = mode
    void bridge.setLocalStorage(MODE_KEY, mode).catch(() => {})
    if (isPlaying(game)) {
      report(`${modeName(game)} from the next game`)
    } else {
      void loadHighScore().then(() => {
        invalidate()
        return showCurrentScreen()
      }).then(() => report(modeName(game)))
    }
  }

  function setDifficulty(d: Difficulty): void {
    if (game.difficulty === d) return
    game.difficulty = d
    void bridge.setLocalStorage(DIFFICULTY_KEY, d).catch(() => {})
    screenDirty = true
    report(`${d[0].toUpperCase()}${d.slice(1)} difficulty${isPlaying(game) ? ', from now on' : ''}`)
    if (!isPlaying(game)) onStatus(status())
  }

  // The phone page's level field: pick any level up to the one reached.
  function setStartLevel(level: number): void {
    if (!Number.isFinite(level)) return
    chooseStartLevel(game, Math.round(level) - game.startLevel)
    if (!isPlaying(game)) { invalidate(); void showCurrentScreen().then(() => report(`Start at level ${game.startLevel}`)) }
    else onStatus(status())
  }

  function setHardAim(on: boolean): void {
    if (game.hardAim === on) return
    game.hardAim = on
    void bridge.setLocalStorage(HARD_AIM_KEY, on ? '1' : '0').catch(() => {})
    screenDirty = true
    if (!isPlaying(game)) { invalidate(); void showCurrentScreen() }
    report(on ? 'Aim guide stops at the first bounce' : 'Full aim guide')
  }

  async function takeContinue(): Promise<void> {
    continueOffered = false
    if (!continueGame(game)) return
    screenDirty = true
    invalidate()
    await pushText(renderGrid(game))
    report('Continued. This run no longer counts for the best.')
    await intro()
    void loop()
  }

  function declineContinue(): void {
    continueOffered = false
    invalidate()
    void showCurrentScreen().then(() => report('Game over'))
  }

  function handle(input: Input): void {
    if (introRunning && (input.kind === 'tap' || input.kind === 'up' || input.kind === 'down' || input.kind === 'hold')) return
    if (continueOffered && isOver(game)) {
      if (input.kind === 'tap') { void takeContinue(); return }
      if (input.kind === 'up' || input.kind === 'down') { declineContinue(); return }
    }
    if (levelCardOpen && (input.kind === 'tap' || input.kind === 'up' || input.kind === 'down')) {
      levelCardInput(input.kind)
      return
    }
    switch (input.kind) {
      case 'tap':
        if (isPlaying(game)) {
          if (fire(game)) screenDirty = true
        } else {
          void begin()
        }
        break
      case 'double':
        if (game.ranked && game.score > game.highScore) {
          game.highScore = game.score
          saveHighScore()
        }
        void bridge.shutDownPageContainer(1)
        break
      case 'up':
        if (isPlaying(game)) {
          nudgeToNextLanding(game, 1, SWIPE_AIM_DEG)
          screenDirty = true
          report(aimText())
        } else {
          pickLevel(1)
        }
        break
      case 'down':
        if (isPlaying(game)) {
          nudgeToNextLanding(game, -1, SWIPE_AIM_DEG)
          screenDirty = true
          report(aimText())
        } else {
          pickLevel(-1)
        }
        break
      case 'hold':
        if (isPlaying(game) && swapBubbles(game)) {
          screenDirty = true
          report('Swapped')
        }
        break
      case 'menu':
        if (input.id === 1) void begin()
        if (input.id === 2 && isPlaying(game)) centerAim()
        if (input.id === 3) setMode('classic')
        if (input.id === 4) setMode('pulley')
        if (input.id === 5) setMode('endless')
        if (input.id === 6) setMode('puzzle')
        if (input.id === 7) setHardAim(!game.hardAim)
        if (input.id === 8) setDifficulty(DIFFICULTIES[(DIFFICULTIES.indexOf(game.difficulty) + 1) % DIFFICULTIES.length])
        break
      case 'overlay-open':
        overlayOpen = true
        break
      case 'overlay-close':
        overlayOpen = false
        void refreshAfterOverlay()
        break
    }
  }

  bridge.onEvenHubEvent((event) => {
    const input = toInput(event)
    if (input) handle(input)
  })

  await showCurrentScreen()
  if (currentPage()) report('Ready. Tap the glasses to start.')
  else report('The glasses did not open the page. Reopen Bubbles from the Even app.')

  function preview(kind: PreviewKind): void {
    game.levelReached = 7
    game.startLevel = 7
    if (kind === 'title') {
      invalidate()
      void showCurrentScreen().then(() => report('Ready. Tap the glasses to start.'))
      return
    }
    if (kind === 'card') {
      // The level card as it looks after clearing level 6 in 11 shots.
      game.mode = 'classic'
      startGame(game, { level: 7 })
      game.score = 2310; game.lastLevelShots = 11; game.lastBonus = 180
      invalidate()
      void pushText(renderLevelCard(game)).then(() => report('Level 6 cleared'))
      return
    }
    if (kind === 'specials') {
      // Level 1 layout with a star, a rainbow and a stone placed in it, and a rainbow queued.
      game.mode = 'classic'
      startGame(game, { level: 1 })
      const w = game.wallCol
      game.field[idx(w - 2, SHOOTER_Y)] = STAR
      game.field[idx(w - 1, SHOOTER_Y - 1)] = RAINBOW
      game.field[idx(w - 3, SHOOTER_Y + 2)] = STONE
      game.field[idx(w - 2, 1)] = BOMB
      game.field[idx(w - 1, 7)] = FROZEN
      game.field[idx(w - 3, 7)] = MYSTERY_BASE + 2
      game.next = RAINBOW
      game.combo = 3
      game.pickups = [idx(10, SHOOTER_Y - 2)]
      invalidate()
      void showCurrentScreen().then(() => { report('Playing'); void loop() })
      return
    }
    if (kind === 'blast') {
      // A level-shot that pops three and drops a hanging pair: a five-bubble clear.
      game.mode = 'classic'
      startGame(game, { level: 1 })
      game.field.fill(0)
      const w = game.wallCol, y = SHOOTER_Y
      game.field[idx(w, y)] = 1; game.field[idx(w - 1, y)] = 1
      game.field[idx(w - 1, y + 1)] = 2; game.field[idx(w - 1, y + 2)] = 2; game.field[idx(w - 1, y + 3)] = 2
      game.field[idx(w, 0)] = 3
      game.loaded = 1; game.next = 2
      invalidate()
      void showCurrentScreen().then(() => { report('Playing. Tap to fire the staged shot.'); void loop() })
      return
    }
    startGame(game)
    game.level = 7
    game.score = 1240
    game.won = kind === 'won'
    game.ranked = true
    game.newBest = game.score > game.highScore
    game.highScore = Math.max(game.highScore, game.score)
    game.phase = 'over'
    continueOffered = !game.won && game.continues > 0
    invalidate()
    void showCurrentScreen().then(() => report(game.won ? 'All levels cleared' : 'Game over'))
  }

  return {
    game,
    newGame: () => { void begin() },
    centerAim,
    setMode,
    setHardAim,
    setDifficulty,
    setStartLevel,
    preview,
    status,
  }
}
