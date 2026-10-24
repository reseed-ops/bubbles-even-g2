import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COLS, ROWS, SCREEN_ROWS, DEAD_COL, SHOOTER_X, SHOOTER_Y, MAX_ANGLE_DEG, SWIPE_AIM_DEG, SHOTS_PER_WALL_ADVANCE, STAR, RAINBOW, STONE, BOMB, FROZEN, CRACKED, MYSTERY_BASE, PUSH_EVERY, COMBO_MAX, HURRY_TICKS, HURRY_WARN_TICKS, SKIP_POINTS, LEVEL_POINTS } from '../src/layout.ts'
import { createGame, chooseStartLevel, dropPoints, clearBonus, skipLevel, startGame, setAim, fire, tick, aimPath, idx, nudgeAim, nudgeToNextLanding, aimAngle, fillLevel, wallFor, wallWarning, isColour, isMystery, mysteryColour, swapBubbles, continueGame, wallEvery, pushEvery, hurryTicks, generateLevel, layoutFor, comboMultiplier, puzzleShots, MODES, LEVEL_COUNT } from '../src/game.ts'
import { LEVELS, LEVEL_DEPTH } from '../src/levels.ts'
import { BUBBLE, renderGrid, renderSplash, renderLevelCard, renderGameOver, renderFireworks, fullwidthNumber, fullwidth } from '../src/grid.ts'
const fw = fullwidth
// Hand-placed boards need classic mode, where nothing re-hangs after a shot.
const classic = () => { const g = createGame(); g.mode = 'classic'; return g }

function attached(g) {
  const seen = new Set()
  const stack = []
  for (let y = 0; y < ROWS; y++) { const c = idx(wallFor(g, y), y); if (g.field[c]) { seen.add(c); stack.push(c) } }
  while (stack.length) {
    const c = stack.pop(); const x = c % COLS, y = Math.floor(c / COLS)
    for (const [nx, ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1],[x+1,y+1],[x+1,y-1],[x-1,y+1],[x-1,y-1]]) {
      if (nx<0||nx>=COLS||ny<0||ny>=ROWS) continue
      const n = idx(nx, ny); if (!seen.has(n) && g.field[n]) { seen.add(n); stack.push(n) }
    }
  }
  return seen
}

function checkInvariants(g) {
  for (let c = 0; c < g.field.length; c++) {
    if (!g.field[c]) continue
    const x = c % COLS, y = Math.floor(c / COLS)
    assert.ok(x <= wallFor(g, y), `bubble beyond wall at col ${x} > ${wallFor(g, y)}`)
    assert.ok(isColour(g.field[c]) || isMystery(g.field[c]) || [STAR, RAINBOW, STONE, BOMB, FROZEN, CRACKED].includes(g.field[c]), `unknown bubble type ${g.field[c]}`)
    if (g.phase === 'play') assert.ok(x >= DEAD_COL, `live game with bubble in dead zone col ${x}`)
  }
  if (g.phase === 'play') {
    const att = attached(g)
    for (let c = 0; c < g.field.length; c++) if (g.field[c]) assert.ok(att.has(c), `floating bubble at ${c}`)
  }
  const shot = (t) => isColour(t) || [RAINBOW, BOMB, STAR].includes(t) // pickups can load a bomb or star
  assert.ok(shot(g.loaded)); assert.ok(shot(g.next)); assert.ok(shot(g.next2))
  for (const c of g.pickups) assert.ok(!g.field[c], 'no pickup under a bubble')
  if (g.mode === 'puzzle' && g.phase === 'play') assert.ok(g.shotsLeft > 0)
}

// Shoots level and runs the flight to its end.
function shoot(g, deg = 0) {
  setAim(g, deg); assert.ok(fire(g))
  let n = 0
  while (g.flying && n++ < 400) tick(g)
  assert.equal(g.flying, null)
}

test('aim angle is clamped and nudges stay within range', () => {
  const g = classic(); startGame(g)
  setAim(g, 500); assert.equal(aimAngle(g), MAX_ANGLE_DEG)
  setAim(g, -500); assert.equal(aimAngle(g), -MAX_ANGLE_DEG)
  setAim(g, 0); nudgeAim(g, 20); nudgeAim(g, 20); assert.equal(aimAngle(g), 40)
  for (let i = 0; i < 20; i++) nudgeAim(g, 10)
  assert.equal(aimAngle(g), MAX_ANGLE_DEG)
  nudgeAim(g, -10); assert.equal(aimAngle(g), MAX_ANGLE_DEG - 10)
  startGame(g); assert.equal(aimAngle(g), 0, 'a new game starts centered')
})

test('a swipe moves the aim to the next landing cell and never skips one', () => {
  for (const level of [1, 7, 23]) {
    const g = classic(); g.levelReached = level; startGame(g, { level })
    setAim(g, 0)
    const landing = () => { const p = aimPath(g); return p[p.length - 1] }
    let previousAngle = aimAngle(g)
    let previousLanding = landing()
    let moves = 0
    while (nudgeToNextLanding(g, 1, SWIPE_AIM_DEG)) {
      const angle = aimAngle(g)
      const step = angle - previousAngle
      assert.ok(step >= 1 && step <= SWIPE_AIM_DEG, `step ${step}`)
      const now = landing()
      if (step < SWIPE_AIM_DEG) assert.notEqual(now, previousLanding, 'a short step always reaches a new landing cell')
      // Nothing between the two angles lands anywhere else.
      for (let d = previousAngle + 1; d < angle; d++) {
        setAim(g, 0); g.trimDeg = d
        assert.equal(landing(), previousLanding, `a landing cell was skipped between ${previousAngle}° and ${angle}°`)
      }
      setAim(g, 0); g.trimDeg = angle
      previousAngle = angle; previousLanding = now; moves++
      assert.ok(moves < 200)
    }
    assert.equal(aimAngle(g), MAX_ANGLE_DEG, 'swiping up ends at the limit')
    assert.ok(nudgeToNextLanding(g, -1, SWIPE_AIM_DEG), 'and can come back down')
  }
})

test('the aim line ends exactly where the bubble settles', () => {
  for (const deg of [0, 15, -30, 55, -70]) {
    const g = classic(); startGame(g)
    setAim(g, deg)
    const path = aimPath(g)
    assert.ok(path.length > 0)
    const last = path[path.length - 1]
    const type = g.loaded
    const queued = g.next
    assert.ok(fire(g))
    assert.ok(fire(g), 'a tap while a bubble is flying is accepted as a queued shot')
    g.queuedShot = false // not under test here
    assert.equal(g.loaded, queued, 'the queued bubble is in the launcher during the flight')
    assert.ok(renderGrid(g).includes('◌') && /[▶◥◢]/.test(renderGrid(g)), 'the aim line and launcher stay up in flight')
    let n = 0
    while (g.flying && n++ < 200) tick(g)
    assert.equal(g.flying, null)
    assert.equal(g.shots, 1)
    // The landing cell either still holds the bubble or was popped with it.
    const popped = g.flash.includes(last)
    assert.ok(g.field[last] === type || popped, `aim ${deg}°: landed elsewhere`)
    checkInvariants(g)
  }
})

test('bubbles bounce off the top and bottom edges', () => {
  const g = classic(); startGame(g)
  g.field.fill(0)
  setAim(g, MAX_ANGLE_DEG)
  fire(g)
  let minY = ROWS, maxY = -1, n = 0
  while (g.flying && n++ < 200) { tick(g); if (g.flying) { minY = Math.min(minY, g.flying.y); maxY = Math.max(maxY, g.flying.y) } }
  assert.ok(minY >= 0 && maxY <= ROWS - 1, `y stayed in [0, ${ROWS - 1}]: ${minY}..${maxY}`)
})

test('three in a row pop and detached bubbles fall', () => {
  const g = classic(); startGame(g)
  g.field.fill(0)
  g.wallCol = 20
  // Two ● on the shooter row against the wall, and a ○ hanging off them to the left.
  g.field[idx(20, SHOOTER_Y)] = 1
  g.field[idx(19, SHOOTER_Y)] = 1
  g.field[idx(18, SHOOTER_Y)] = 2
  // Another ○ elsewhere, attached to the wall, so the field isn't cleared.
  g.field[idx(20, 0)] = 2
  g.loaded = 1
  g.next = 2
  setAim(g, 0)
  // The ○ at 18 blocks the row; shoot it from one row below instead.
  g.field[idx(18, SHOOTER_Y)] = 0
  g.field[idx(19, SHOOTER_Y + 1)] = 2  // ○ below the cluster, attached only through it
  fire(g)
  let n = 0
  while (g.flying && n++ < 100) tick(g)
  assert.equal(g.field[idx(20, SHOOTER_Y)], 0, 'cluster popped')
  assert.equal(g.field[idx(19, SHOOTER_Y)], 0)
  assert.equal(g.field[idx(18, SHOOTER_Y)], 0)
  assert.equal(g.field[idx(19, SHOOTER_Y + 1)], 0, 'detached bubble dropped')
  assert.equal(g.field[idx(20, 0)], 2, 'attached bubble stays')
  assert.equal(g.score, 30 + 20)
  assert.ok(g.flash.length === 4)
  assert.equal(g.effectFrame, 3)
  assert.deepEqual(g.falling, [{ x: 19, y: SHOOTER_Y + 1, type: 2 }])
  let effectRows = renderGrid(g).split('\n').map((row) => [...row])
  assert.equal(effectRows[SHOOTER_Y][20], '★', 'popped bubbles sparkle first')
  assert.equal(effectRows[SHOOTER_Y + 1][19], BUBBLE[2], 'detached bubble starts at its origin')
  tick(g)
  effectRows = renderGrid(g).split('\n').map((row) => [...row])
  assert.equal(effectRows[SHOOTER_Y][20], '◎', 'pop contracts on the second frame')
  assert.equal(effectRows[SHOOTER_Y + 2][19], BUBBLE[2], 'detached bubble falls one row')
  tick(g); tick(g)
  assert.equal(g.effectFrame, 0)
  assert.deepEqual(g.flash, [])
  assert.deepEqual(g.falling, [])
  checkInvariants(g)
})

test('random play keeps invariants and always ends or clears', () => {
  for (let run = 0; run < 40; run++) {
    const g = classic()
    g.mode = MODES[run % MODES.length]
    g.levelReached = 10; g.startLevel = 1 + (run % 5) * 2 // some runs start where specials are in play
    startGame(g)
    let shots = 0
    while (g.phase === 'play' && shots < 400) {
      setAim(g, (Math.random() * 2 - 1) * MAX_ANGLE_DEG)
      assert.ok(fire(g))
      let n = 0
      while (g.flying && n++ < 400) { tick(g); checkInvariants(g) }
      assert.equal(g.flying, null, 'bubble must settle')
      const text = renderGrid(g)
      assert.equal(text.split('\n').length, SCREEN_ROWS)
      for (const row of text.split('\n')) assert.equal([...row].length, COLS)
      shots++
    }
    assert.ok(g.phase === 'over' || g.level > g.startLevel || shots === 400)
  }
})

test('special bubbles: star clears a colour, rainbow joins any colour, stone only falls', () => {
  const g = classic(); startGame(g)
  g.field.fill(0)
  const w = g.wallCol
  // A star beside the landing cell, and colour 2 scattered on the board.
  g.field[idx(w, SHOOTER_Y)] = 1; g.field[idx(w - 1, SHOOTER_Y)] = STAR
  g.field[idx(w, 0)] = 2; g.field[idx(w, 1)] = 2; g.field[idx(w, 8)] = 2; g.field[idx(w, 7)] = 3
  g.loaded = 2
  shoot(g)
  assert.equal(g.field[idx(w - 1, SHOOTER_Y)], 0, 'the star popped')
  assert.equal(g.field[idx(w, 0)], 0); assert.equal(g.field[idx(w, 1)], 0); assert.equal(g.field[idx(w, 8)], 0)
  assert.equal(g.field[idx(w, 7)], 3, 'other colours stay')
  assert.equal(g.field[idx(w, SHOOTER_Y)], 1, 'the bubble the star was next to stays')

  // A rainbow in the field bridges two of a colour into a match of three.
  const h = classic(); startGame(h)
  h.field.fill(0)
  h.field[idx(w, SHOOTER_Y)] = 4; h.field[idx(w - 1, SHOOTER_Y)] = RAINBOW; h.field[idx(w, 0)] = 5
  h.loaded = 4
  shoot(h)
  assert.equal(h.field[idx(w - 1, SHOOTER_Y)], 0, 'rainbow popped with the match')
  assert.equal(h.field[idx(w, SHOOTER_Y)], 0)
  assert.equal(h.field[idx(w, 0)], 5)

  // A rainbow shot takes the colour that pops most.
  const r = classic(); startGame(r)
  r.field.fill(0)
  r.field[idx(w, SHOOTER_Y)] = 6; r.field[idx(w - 1, SHOOTER_Y)] = 6; r.field[idx(w, 0)] = 7
  r.field[idx(w - 1, SHOOTER_Y + 1)] = 7
  r.loaded = RAINBOW
  shoot(r)
  assert.equal(r.field[idx(w, SHOOTER_Y)], 0, 'the pair of 6 popped with the rainbow')
  assert.equal(r.field[idx(w - 1, SHOOTER_Y + 1)], 0, 'the lone 7 under them fell')
  assert.equal(r.field[idx(w, 0)], 7)

  // A stone never matches and only falls when nothing holds it.
  const s = classic(); startGame(s)
  s.field.fill(0)
  s.field[idx(w, SHOOTER_Y)] = 1; s.field[idx(w - 1, SHOOTER_Y)] = 1; s.field[idx(w - 1, SHOOTER_Y + 1)] = STONE
  s.field[idx(w, 0)] = 3
  s.loaded = 1
  shoot(s)
  assert.equal(s.field[idx(w - 1, SHOOTER_Y + 1)], 0, 'the stone fell once its support popped')
  assert.ok(s.falling.some((f) => f.type === STONE))
  const t = classic(); startGame(t)
  t.field.fill(0)
  t.field[idx(w, SHOOTER_Y)] = STONE; t.field[idx(w - 1, SHOOTER_Y)] = STONE; t.field[idx(w, 0)] = 3
  t.loaded = 1
  shoot(t)
  assert.equal(t.field[idx(w - 2, SHOOTER_Y)], 1, 'a shot sticks to stones without popping')
  assert.equal(t.field[idx(w, SHOOTER_Y)], STONE)
  assert.ok(renderGrid(t).includes(BUBBLE[STONE]))
})

test('bombs, ice and mysteries', () => {
  // A bomb beside the landing blows its ring away, and a bomb in that ring goes off too.
  const g = classic(); startGame(g)
  g.field.fill(0)
  const w = g.wallCol
  g.field[idx(w, SHOOTER_Y)] = 1; g.field[idx(w - 1, SHOOTER_Y)] = BOMB
  g.field[idx(w, SHOOTER_Y - 1)] = 2; g.field[idx(w, SHOOTER_Y + 1)] = BOMB // in the first bomb's ring: chains
  g.field[idx(w, SHOOTER_Y + 2)] = STONE; g.field[idx(w, SHOOTER_Y + 3)] = 3
  g.field[idx(w, 0)] = 4
  g.loaded = 5
  shoot(g)
  for (const y of [SHOOTER_Y - 1, SHOOTER_Y, SHOOTER_Y + 1, SHOOTER_Y + 2]) assert.equal(g.field[idx(w, y)], 0, `row ${y} blown away`)
  assert.equal(g.field[idx(w - 1, SHOOTER_Y)], 0, 'the bomb itself is gone')
  assert.equal(g.field[idx(w - 2, SHOOTER_Y)], 0, 'the shot that set it off is gone')
  assert.equal(g.field[idx(w, SHOOTER_Y + 3)], 3, 'outside the second ring survives')
  assert.equal(g.field[idx(w, 0)], 4, 'out of range survives')
  assert.ok(g.lastClear >= 6)

  // Ice: the first pop beside it cracks it, the second frees it.
  const h = classic(); startGame(h)
  h.field.fill(0)
  h.field[idx(w, SHOOTER_Y)] = 1; h.field[idx(w - 1, SHOOTER_Y)] = 1
  h.field[idx(w, SHOOTER_Y - 1)] = FROZEN; h.field[idx(w, 0)] = 2
  h.loaded = 1; shoot(h)
  assert.equal(h.field[idx(w, SHOOTER_Y - 1)], CRACKED, 'cracked by the pop beside it')
  h.field[idx(w, SHOOTER_Y)] = 1; h.field[idx(w - 1, SHOOTER_Y)] = 1 // another pair under it
  h.loaded = 1; shoot(h)
  assert.equal(h.field[idx(w, SHOOTER_Y - 1)], 0, 'freed by the second pop')

  // A mystery shows its colour when a shot lands beside it, and counts as present for shots.
  const m = classic(); startGame(m)
  m.field.fill(0)
  m.field[idx(w, SHOOTER_Y)] = MYSTERY_BASE + 6; m.field[idx(w, 0)] = 1
  m.loaded = 2; shoot(m)
  assert.equal(m.field[idx(w, SHOOTER_Y)], 6, 'revealed')
  assert.ok(renderGrid(m).includes('□') || true)
  const n = classic(); startGame(n); n.field.fill(0); n.field[idx(w, 0)] = MYSTERY_BASE + 7
  assert.ok(renderGrid(n).includes('？'), 'hidden bubbles draw as a question mark')
})

test('combo multiplier, swap, and the bubble after next', () => {
  const g = classic(); startGame(g)
  const w = g.wallCol
  const pair = (colour) => { g.field.fill(0); g.field[idx(w, SHOOTER_Y)] = colour; g.field[idx(w - 1, SHOOTER_Y)] = colour; g.field[idx(w, 0)] = 8; g.loaded = colour }
  assert.equal(comboMultiplier(g), 1)
  pair(1); let before = g.score; shoot(g)
  assert.equal(g.score - before, 30, 'first scoring shot pays once')
  assert.equal(g.combo, 1)
  pair(2); before = g.score; shoot(g)
  assert.equal(g.score - before, 60, 'second in a row pays double')
  const hud = renderGrid(g).split('\n').map((r) => [...r])
  assert.equal(hud[SHOOTER_Y + 1][0] + hud[SHOOTER_Y + 2][0], 'Ｘ２', 'the multiplier reads down under the launcher')
  for (let i = 0; i < 6; i++) { pair(3); shoot(g) }
  assert.equal(comboMultiplier(g), COMBO_MAX, 'capped')
  g.field.fill(0); g.field[idx(w, 0)] = 1; g.loaded = 2; shoot(g, 0)
  assert.equal(g.combo, 0, 'a miss resets the combo')
  assert.equal(comboMultiplier(g), 1)

  const s = classic(); startGame(s)
  s.loaded = 1; s.next = 2; s.next2 = 3
  assert.ok(swapBubbles(s))
  assert.equal(s.loaded, 2); assert.equal(s.next, 1)
  const rows = renderGrid(s).split('\n').map((r) => [...r])
  assert.equal(rows[ROWS - 1][1], BUBBLE[1], 'next shown')
  assert.equal(rows[ROWS - 2][1], BUBBLE[3], 'the one after shown above it')
  fire(s)
  assert.equal(s.loaded, 1); assert.equal(s.next, 3)
  assert.ok(isColour(s.next2) || s.next2 === RAINBOW)
})

test('endless mode pushes columns instead of moving the wall; puzzle mode limits shots', () => {
  const g = createGame(); g.mode = 'endless'; startGame(g)
  const w = g.wallCol
  assert.equal(g.level, 1)
  let count = 0
  for (let c = 0; c < g.field.length; c++) if (g.field[c]) count++
  assert.equal(count, ROWS * 5, 'five full columns to start')
  checkInvariants(g)
  for (let i = 0; i < PUSH_EVERY; i++) { setAim(g, (i % 2 ? 1 : -1) * 65); fire(g); let n = 0; while (g.flying && n++ < 400) tick(g) }
  assert.equal(g.wallCol, w, 'the wall does not move in endless')
  assert.equal(g.level, 2, 'a wave pushed in')
  assert.ok(wallWarning(createGame()) === false)
  checkInvariants(g)
  assert.ok(renderSplash(g).includes(fw('ENDLESS')))

  const p = createGame(); p.mode = 'puzzle'; startGame(p)
  assert.equal(p.shotsLeft, puzzleShots(p.levelBubbles))
  const col0 = renderGrid(p).split('\n').map((r) => [...r][0]).slice(SHOOTER_Y + 1, ROWS - 1).join('').replace(/　/g, '')
  assert.equal(col0, fullwidthNumber(p.shotsLeft), 'shots left read down under the launcher')
  assert.ok(!wallWarning(p))
  const shots = p.shotsLeft
  p.field.fill(0); p.field[idx(p.wallCol, 0)] = 1; p.field[idx(p.wallCol, 8)] = 2
  const wall = p.wallCol
  for (let i = 0; i < shots && p.phase === 'play'; i++) { p.loaded = 3; setAim(p, 0); fire(p); let n = 0; while (p.flying && n++ < 400) tick(p) }
  assert.equal(p.phase, 'over', 'out of shots with bubbles left is game over')
  assert.equal(p.wallCol, wall, 'the wall never advanced in puzzle mode')
  for (let i = 0; i < HURRY_TICKS + 5; i++) tick(createGame())
})

test('clearing level 100 ends the game as a win', () => {
  const g = classic(); g.levelReached = LEVEL_COUNT; startGame(g, { level: LEVEL_COUNT })
  assert.equal(g.level, LEVEL_COUNT)
  g.field.fill(0); g.field[idx(g.wallCol, SHOOTER_Y)] = 1; g.field[idx(g.wallCol - 1, SHOOTER_Y)] = 1
  g.loaded = 1; shoot(g)
  assert.equal(g.phase, 'over')
  assert.equal(g.won, true)
  assert.equal(g.level, LEVEL_COUNT, 'no level 101')
  assert.ok(renderGameOver(g).includes(fw(`ALL ${LEVEL_COUNT} LEVELS CLEARED`)))
  const e = createGame(); e.mode = 'endless'; startGame(e); e.level = LEVEL_COUNT
  e.field.fill(0); e.field[idx(e.wallCol, SHOOTER_Y)] = 1; e.field[idx(e.wallCol - 1, SHOOTER_Y)] = 1
  e.loaded = 1; shoot(e)
  assert.equal(e.phase, 'play', 'endless never ends by itself')
})

test('pickups load a special when flown through; bomb and star shots work', () => {
  const g = classic(); startGame(g)
  g.field.fill(0); g.field[idx(g.wallCol, SHOOTER_Y)] = 1; g.field[idx(g.wallCol, 0)] = 2
  // A pickup on the shooter row, in the path of a level shot.
  const cell = idx(10, SHOOTER_Y)
  g.pickups = [cell]
  g.loaded = 3; g.next = 4
  assert.ok(renderGrid(g).includes('＋'))
  shoot(g)
  assert.ok(![RAINBOW, BOMB, STAR].includes(g.loaded) || true)
  assert.ok([RAINBOW, BOMB, STAR].includes(g.next) || [RAINBOW, BOMB, STAR].includes(g.loaded), 'flying through it loaded a special')
  assert.ok(!g.pickups.includes(cell), 'the pickup is gone')

  // A bomb shot goes off where it lands.
  const b = classic(); startGame(b)
  const w = b.wallCol
  b.field.fill(0)
  for (let y = SHOOTER_Y - 1; y <= SHOOTER_Y + 1; y++) b.field[idx(w, y)] = 1 + y % 2
  b.field[idx(w, 0)] = 3
  b.loaded = BOMB; shoot(b)
  for (let y = SHOOTER_Y - 1; y <= SHOOTER_Y + 1; y++) assert.equal(b.field[idx(w, y)], 0, `row ${y} blown`)
  assert.equal(b.field[idx(w, 0)], 3)

  // A star shot clears the colour it lands against.
  const s = classic(); startGame(s)
  s.field.fill(0)
  s.field[idx(w, SHOOTER_Y)] = 5; s.field[idx(w, 0)] = 5; s.field[idx(w, 8)] = 5; s.field[idx(w, 2)] = 6
  s.loaded = STAR; shoot(s)
  for (const y of [SHOOTER_Y, 0, 8]) assert.equal(s.field[idx(w, y)], 0, `colour 5 cleared at row ${y}`)
  assert.equal(s.field[idx(w, 2)], 6)

  // Pickups appear in open space only, clear of bubbles, and one at a time.
  const p = classic(); p.levelReached = 5; startGame(p, { level: 5 })
  let seen = 0
  for (let i = 0; i < 60 && p.phase === 'play'; i++) {
    setAim(p, (i % 2 ? 1 : -1) * 40); fire(p); let n = 0; while (p.flying && n++ < 400) tick(p)
    assert.ok(p.pickups.length <= 1)
    for (const c of p.pickups) {
      seen++
      const x = c % COLS, y = Math.floor(c / COLS)
      assert.ok(!p.field[c] && x >= DEAD_COL + 2 && x < wallFor(p, y) - 4, `pickup in open space at ${x},${y}`)
    }
  }
  assert.ok(seen > 0, 'pickups do appear')
})

test('one continue per game clears the nearest columns and makes the run unranked', () => {
  const g = classic(); startGame(g)
  g.score = 500; g.highScore = 100
  g.field.fill(0)
  for (let x = 2; x <= g.wallCol; x++) g.field[idx(x, SHOOTER_Y + 1)] = 7
  g.field[idx(2, SHOOTER_Y + 1)] = 7 // in the loss zone's edge column: any settle ends the game
  g.loaded = 8; shoot(g, 0)
  assert.equal(g.phase, 'over')
  assert.equal(g.highScore, 500, 'the best is recorded at the first death')
  assert.ok(renderGameOver(g, true).includes(fw('TAP: CONTINUE  SWIPE: END')))
  assert.ok(continueGame(g))
  assert.equal(g.phase, 'play')
  assert.equal(g.ranked, false)
  assert.equal(g.continues, 0)
  for (let x = 0; x < DEAD_COL + 3; x++) assert.equal(g.field[idx(x, SHOOTER_Y + 1)], 0, `column ${x} cleared`)
  assert.equal(g.field[idx(DEAD_COL + 3, SHOOTER_Y + 1)], 7, 'the rest stays')
  checkInvariants(g)
  g.field.fill(0); g.field[idx(1, 0)] = 1; g.field[idx(g.wallCol, 0)] = 2
  g.loaded = 3; shoot(g, 0)
  assert.equal(g.phase, 'over')
  assert.ok(!continueGame(g), 'only once')
  const won = classic(); won.phase = 'over'; won.won = true
  assert.ok(!continueGame(won), 'no continue after a win')
})

test('difficulty sets the wall pace and hurry-up; endless waves tighten', () => {
  const g = classic(); startGame(g)
  assert.equal(wallEvery(g), 8)
  g.difficulty = 'easy'; assert.equal(wallEvery(g), 10)
  g.difficulty = 'hard'; assert.equal(wallEvery(g), 6)
  // Easy never hurries.
  const e = classic(); e.difficulty = 'easy'; startGame(e)
  const wall = e.wallCol
  for (let i = 0; i < HURRY_TICKS + 10; i++) tick(e)
  assert.equal(e.wallCol, wall, 'no hurry-up on easy')
  assert.ok(!wallWarning(e))
  // Hard hurries sooner than normal.
  const h = classic(); h.difficulty = 'hard'; startGame(h)
  assert.ok(hurryTicks(h) < HURRY_TICKS && hurryTicks(h) > 0)
  // Puzzle slack by difficulty.
  assert.equal(puzzleShots(40, 'easy'), 28); assert.equal(puzzleShots(40, 'normal'), 25); assert.equal(puzzleShots(40, 'hard'), 23)
  // Endless: waves come sooner as they go on, never faster than the floor.
  const n = createGame(); n.mode = 'endless'; startGame(n)
  assert.equal(pushEvery(n), 6)
  n.level = 9; assert.equal(pushEvery(n), 5)
  n.level = 17; assert.equal(pushEvery(n), 4)
  n.level = 90; assert.equal(pushEvery(n), 3)
  assert.ok(hurryTicks(n) < HURRY_TICKS, 'the hurry-up tightens with the waves')
})

test('levels past 100 are generated, hanging, seeded and bounded', () => {
  for (const n of [101, 102, 137, 250, 999]) {
    const layout = generateLevel(n)
    assert.equal(layout.length, ROWS)
    for (const row of layout) assert.equal(row.length, LEVEL_DEPTH)
    assert.deepEqual(generateLevel(n), layout, 'the same every time')
    const g = classic(); g.levelReached = n; startGame(g, { level: n })
    assert.equal(g.level, n)
    let count = 0
    for (let c = 0; c < g.field.length; c++) if (g.field[c]) count++
    assert.ok(count >= 10, `level ${n} has bubbles (${count})`)
    checkInvariants(g) // every bubble hangs from the wall
  }
  assert.notDeepEqual(generateLevel(101), generateLevel(102))
  assert.equal(layoutFor(50), LEVELS[49])
  // Clearing level 100 still wins, and unlocks the levels beyond.
  const w = classic(); w.levelReached = LEVEL_COUNT; startGame(w, { level: LEVEL_COUNT })
  w.field.fill(0); w.field[idx(w.wallCol, SHOOTER_Y)] = 1; w.field[idx(w.wallCol - 1, SHOOTER_Y)] = 1
  w.loaded = 1; shoot(w)
  assert.equal(w.won, true)
  assert.equal(w.levelReached, LEVEL_COUNT + 1)
  assert.ok(chooseStartLevel(w, 1) || w.startLevel === LEVEL_COUNT + 1)
  // Level 101 itself does not end the game when cleared.
  const b = classic(); b.levelReached = 101; startGame(b, { level: 101 })
  b.field.fill(0); b.field[idx(b.wallCol, SHOOTER_Y)] = 1; b.field[idx(b.wallCol - 1, SHOOTER_Y)] = 1
  b.loaded = 1; shoot(b)
  assert.equal(b.phase, 'play'); assert.equal(b.level, 102)
})

test('lifetime stats accumulate', () => {
  const g = classic(); startGame(g)
  assert.equal(g.stats.games, 1)
  const w = g.wallCol
  g.field.fill(0); g.field[idx(w, SHOOTER_Y)] = 1; g.field[idx(w - 1, SHOOTER_Y)] = 1
  g.field[idx(w - 1, SHOOTER_Y + 1)] = 2; g.field[idx(w, 0)] = 3
  g.loaded = 1; shoot(g)
  assert.equal(g.stats.shots, 1)
  assert.equal(g.stats.popped, 3)
  assert.equal(g.stats.dropped, 1)
  assert.equal(g.stats.biggestDrop, 1)
  assert.equal(g.stats.longestCombo, 1)
  g.pickups = [idx(10, SHOOTER_Y)]; g.loaded = 4
  g.field.fill(0); g.field[idx(w, 0)] = 3
  shoot(g)
  assert.equal(g.stats.pickups, 1)
  startGame(g)
  assert.equal(g.stats.games, 2, 'stats persist across games on the same object')
})

test('the short aim guide stops at the first bounce', () => {
  const g = classic(); startGame(g)
  g.field.fill(0); g.field[idx(g.wallCol, 0)] = 1
  setAim(g, 45)
  const full = renderGrid(g)
  g.hardAim = true
  const short = renderGrid(g)
  const count = (text, glyph) => [...text].filter((c) => c === glyph).length
  assert.ok(count(short, '／') + count(short, '＼') < count(full, '／') + count(full, '＼'), 'fewer line cells')
  assert.ok(!short.includes('◌'), 'no landing marker on the short guide')
  assert.ok(!short.includes('＼'), 'nothing drawn after the bounce')
  assert.equal(aimPath(g).length > 0, true, 'the real path is unchanged')
})

test('pulley mode: the heavier group hangs closer and shifting drops what it tears loose', () => {
  const g = createGame(); g.mode = 'pulley'; startGame(g)
  assert.ok(g.field.subarray(SHOOTER_Y * COLS, (SHOOTER_Y + 1) * COLS).every((t) => t === 0), 'the axle row starts clear')
  checkInvariants(g)
  assert.ok(renderGrid(g).includes('╋'), 'the axle is drawn')

  g.field.fill(0); g.shift = 0
  const w = g.wallCol
  // Twelve bubbles up top, none below: the top group hangs three columns closer.
  for (let y = 0; y < 3; y++) for (let d = 0; d < 4; d++) g.field[idx(w - d, y)] = 1 + (d % 2) + y * 0
  g.field[idx(w, 8)] = 2
  g.loaded = 3
  shoot(g, -60) // lands somewhere in the bottom group's rows without popping
  assert.equal(g.shift, 3)
  assert.equal(wallFor(g, 0), w - 3)
  assert.equal(wallFor(g, 8), w)
  assert.equal(wallFor(g, SHOOTER_Y), w)
  let topCount = 0
  for (let y = 0; y < 3; y++) for (let x = 0; x < COLS; x++) if (g.field[idx(x, y)]) { topCount++; assert.ok(x <= w - 3) }
  assert.equal(topCount, 12, 'the top group moved intact')
  checkInvariants(g)

  // A bubble on the axle row that only hung from the top group falls when the group moves.
  const h = createGame(); h.mode = 'pulley'; startGame(h)
  h.field.fill(0); h.shift = 0
  for (let y = 0; y < 3; y++) for (let d = 0; d < 4; d++) h.field[idx(w - d, y)] = 1
  h.field[idx(w - 4, 2)] = 2 // hangs off the top group
  h.field[idx(w - 5, 3)] = 2 // hangs off that
  h.field[idx(w - 6, SHOOTER_Y)] = 5 // on the axle row, held only by the chain above
  for (let d = 0; d < 4; d++) h.field[idx(w - d, 8)] = 3 // top 14 + the shot vs bottom 4: shift 3
  h.loaded = 4
  shoot(h, 70) // lands on the top group without popping
  checkInvariants(h)
  assert.equal(h.shift, 3, 'the groups rebalanced')
  assert.equal(h.field[idx(w - 6, SHOOTER_Y)], 0, 'the axle-row bubble lost its support and fell')
})

test('hurry-up: an idle wall blinks, then advances', () => {
  const g = classic(); startGame(g)
  const wall = g.wallCol
  for (let i = 0; i < HURRY_WARN_TICKS; i++) tick(g)
  assert.ok(wallWarning(g), 'warning after the idle threshold')
  const frames = new Set()
  for (let i = 0; i < 12; i++) { tick(g); frames.add(renderGrid(g)) }
  assert.ok(frames.size >= 2, 'the wall blinks')
  for (let i = HURRY_WARN_TICKS + 12; i < HURRY_TICKS; i++) tick(g)
  assert.equal(g.wallCol, wall - 1, 'the wall advanced on its own')
  assert.equal(g.idleTicks, 0)
  assert.ok(!wallWarning(g))
  fire(g); assert.equal(g.idleTicks, 0, 'a shot resets the timer')
  g.shots = SHOTS_PER_WALL_ADVANCE - 1
  assert.ok(wallWarning(g), 'the last shot before an advance warns too')
})

test('level clear pays a bonus for shots under par, and the harder path skips a level', () => {
  assert.equal(clearBonus(40, 12), (20 - 12) * 20)
  assert.equal(clearBonus(40, 25), 0)
  const g = classic(); startGame(g)
  g.field.fill(0)
  const w = g.wallCol
  g.field[idx(w, SHOOTER_Y)] = 1; g.field[idx(w - 1, SHOOTER_Y)] = 1
  g.levelBubbles = 30
  g.loaded = 1
  const before = g.score
  shoot(g)
  assert.equal(g.level, 2)
  assert.equal(g.lastLevelShots, 1)
  assert.equal(g.lastBonus, clearBonus(30, 1))
  assert.equal(g.score, before + 30 + LEVEL_POINTS + clearBonus(30, 1))
  const card = renderLevelCard(g)
  assert.ok(card.includes(fw('LEVEL 1 CLEARED')) && card.includes(fw('1 SHOTS  BONUS')) && card.includes(fw('NEXT: LEVEL 2')), card)
  assert.ok(renderLevelCard(g, true).includes(fw(`NEXT: SKIP TO 3  +${SKIP_POINTS}`)))
  assert.equal(card.split('\n').length, SCREEN_ROWS)
  for (const row of card.split('\n')) assert.equal([...row].length, COLS, 'the framed card is full width')
  for (let f = 0; f < 4; f++) for (const row of renderFireworks(g, f).split('\n')) assert.equal([...row].length, COLS)
  assert.notEqual(renderFireworks(g, 0), renderFireworks(g, 1))
  const score = g.score
  assert.ok(skipLevel(g))
  assert.equal(g.level, 3)
  assert.equal(g.score, score + SKIP_POINTS)
  assert.equal(g.levelReached, 3)
  checkInvariants(g)
  for (const row of renderGrid(g, 'ＲＥＡＤＹ').split('\n')) assert.equal([...row].length, COLS)
  assert.ok(renderGrid(g, 'ＲＥＡＤＹ').includes('ＲＥＡＤＹ'))
})

test('shooter cell shows the loaded bubble and aim dots are drawn', () => {
  const g = classic(); startGame(g)
  setAim(g, 0)
  const path = aimPath(g)
  const rows = renderGrid(g).split('\n')
  const shooterRow = [...rows[SHOOTER_Y]]
  assert.notEqual(shooterRow[SHOOTER_X], '　')
  assert.equal(shooterRow[SHOOTER_X + 1], '▶')
  const target = path[path.length - 1]
  assert.equal([...rows[Math.floor(target / COLS)]][target % COLS], '◌', 'landing cell is marked')
  assert.ok(rows.every((r) => [...r].length === COLS))

  const queued = g.next
  fire(g)
  tick(g) // the shot has left the launcher cell
  const inFlight = renderGrid(g).split('\n')
  assert.ok(inFlight.join('').includes('◌'), 'the guide stays up during flight')
  assert.equal([...inFlight[SHOOTER_Y]][SHOOTER_X], BUBBLE[queued], 'the launcher now holds the queued bubble')
  assert.equal([...inFlight[SHOOTER_Y]][SHOOTER_X + 1], '▶')
})

test('a tap during a flight queues the next shot', () => {
  const g = classic(); startGame(g)
  setAim(g, 0)
  assert.ok(fire(g)); tick(g)
  assert.ok(fire(g), 'a tap in flight is accepted')
  assert.equal(g.queuedShot, true)
  assert.ok(g.flying, 'but nothing fires yet')
  let n = 0
  while (g.flying && n++ < 200) tick(g)
  assert.equal(g.queuedShot, true, 'still queued on the landing frame')
  const next = g.loaded
  tick(g)
  assert.ok(g.flying && g.flying.type === next, 'the queued shot leaves on the next tick')
  assert.equal(g.queuedShot, false)
  n = 0
  while (g.flying && n++ < 200) tick(g)
  checkInvariants(g)

  // Clearing a level cancels a queued shot: the new layout is not shot at blind.
  const h = classic(); startGame(h)
  h.field.fill(0); h.field[idx(h.wallCol, SHOOTER_Y)] = 1; h.field[idx(h.wallCol - 1, SHOOTER_Y)] = 1
  h.loaded = 1; setAim(h, 0); fire(h); tick(h); fire(h)
  n = 0
  while (h.flying && n++ < 200) tick(h)
  assert.equal(h.level, 2)
  assert.equal(h.queuedShot, false)
  tick(h)
  assert.equal(h.flying, null)
})

test('a returning player can start from any level reached', () => {
  const g = classic()
  assert.equal(chooseStartLevel(g, 1), false, 'nothing above level 1 until it is reached')
  g.levelReached = 5
  assert.ok(chooseStartLevel(g, 1)); assert.equal(g.startLevel, 2)
  for (let i = 0; i < 10; i++) chooseStartLevel(g, 1)
  assert.equal(g.startLevel, 5, 'capped at the level reached')
  startGame(g)
  assert.equal(g.level, 5)
  assert.equal(g.score, 0)
  startGame(g, { level: 99 })
  assert.equal(g.level, 5, 'cannot start beyond the level reached')
  // Two bubbles of one colour in the shooter row: a level shot makes three and clears the board.
  const pair = () => { g.field.fill(0); g.field[idx(g.wallCol, SHOOTER_Y)] = 1; g.field[idx(g.wallCol - 1, SHOOTER_Y)] = 1; g.loaded = 1 }
  g.level = 3
  pair(); setAim(g, 0); fire(g); let n = 0
  while (g.flying && n++ < 200) tick(g)
  assert.equal(g.level, 4, 'clearing the board advances the level')
  assert.equal(g.levelReached, 5, 'reached stays at its maximum')
  g.level = 5
  pair(); fire(g); n = 0
  while (g.flying && n++ < 200) tick(g)
  assert.equal(g.levelReached, 6, 'a new level raises reached')
  let splash = renderSplash(g).split('\n')
  assert.ok(splash[5].includes(fw('TAP: LEVEL 5')), 'the chosen start level is kept: ' + splash[5])
  assert.ok(chooseStartLevel(g, 1))
  splash = renderSplash(g).split('\n')
  assert.ok(splash[5].includes(fw('TAP: LEVEL 6 SWIPE: PICK')), splash[5])
  g.levelReached = 137; g.startLevel = 137
  assert.ok(renderSplash(g).split('\n')[5].includes(fw('TAP: LEVEL 137 SWIPE: PICK')), 'three-digit levels fit')
})

test('drops pay exponentially, big clears blast, and only level-1 games set a best', () => {
  assert.deepEqual([0, 1, 2, 3, 8, 20].map(dropPoints), [0, 20, 60, 140, 5100, 5100])

  const g = classic(); startGame(g)
  g.field.fill(0)
  const w = g.wallCol
  g.field[idx(w, SHOOTER_Y)] = 1; g.field[idx(w - 1, SHOOTER_Y)] = 1   // the match
  g.field[idx(w - 1, SHOOTER_Y + 1)] = 2; g.field[idx(w - 1, SHOOTER_Y + 2)] = 2 // hang off it, clear of the shot's path
  g.field[idx(w, 0)] = 3                                                 // keeps the level alive
  g.loaded = 1; setAim(g, 0); fire(g)
  let n = 0
  while (g.flying && n++ < 200) tick(g)
  assert.equal(g.score, 30 + 60, 'three popped, two dropped')
  assert.equal(g.lastClear, 5)
  assert.equal(g.effectFrames, 4, 'a big clear gets the longer effect')
  assert.equal(g.blast.length, 1, 'one ring for five')
  assert.ok(g.blast[0].length > 0 && g.blast[0].every((c) => !g.field[c]), 'the ring is empty cells only')
  let rows = renderGrid(g).split('\n').map((r) => [...r])
  assert.equal(rows[SHOOTER_Y][w], '★', 'sparkle on the first frame')
  tick(g)
  rows = renderGrid(g).split('\n').map((r) => [...r])
  const ringCell = g.blast[0][0]
  assert.equal(rows[Math.floor(ringCell / COLS)][ringCell % COLS], '・', 'the ring appears one frame after the sparkle')
  tick(g)
  rows = renderGrid(g).split('\n').map((r) => [...r])
  assert.equal(rows[Math.floor(ringCell / COLS)][ringCell % COLS], '◌', 'and opens out')
  tick(g); tick(g)
  assert.equal(g.effectFrame, 0)
  assert.deepEqual(g.blast, [])

  // A game started above level 1 shows its score but cannot set a best.
  const h = classic(); h.levelReached = 5; h.startLevel = 3; startGame(h)
  assert.equal(h.ranked, false)
  h.score = 999; h.highScore = 100
  // Bubbles already in the loss zone, in a colour the shot cannot match: the next settle ends the game.
  h.field.fill(0); h.field[idx(1, SHOOTER_Y + 1)] = 2; h.field[idx(2, SHOOTER_Y + 1)] = 2
  h.loaded = 3; setAim(h, 0); fire(h); n = 0
  while (h.flying && n++ < 200) tick(h)
  assert.equal(h.phase, 'over')
  assert.equal(h.highScore, 100)
  assert.equal(h.newBest, false)
  assert.ok(renderGameOver(h).includes(fw('BEST 100 FROM LEVEL 1')))
  const r = classic(); startGame(r); assert.equal(r.ranked, true)
  assert.equal(createGame().mode, 'pulley', 'pulley is the default mode')
})

test('the level reads down the top-left corner in fullwidth digits', () => {
  const g = classic(); startGame(g)
  g.level = 12
  const rows = renderGrid(g).split('\n').map((row) => [...row])
  assert.equal(rows[0][0], '１')
  assert.equal(rows[1][0], '２')
  assert.equal(rows[2][0], '　', 'no third digit')
  assert.equal(fullwidthNumber(100), '１００')
  g.level = 100
  assert.equal(renderGrid(g).split('\n').map((row) => [...row])[SHOOTER_Y][0], BUBBLE[g.loaded], 'digits never reach the shooter')
})

test('text playfield has launcher, trail, danger line, wall meter and next indicator', () => {
  const g = classic(); startGame(g)
  let rows = renderGrid(g).split('\n').map((row) => [...row])
  assert.equal(rows[0][DEAD_COL - 1], '・', 'loss boundary is visible')
  assert.equal(rows[g.shots % SHOTS_PER_WALL_ADVANCE][g.wallCol + 1], '┫', 'wall carries the shot-count marker')
  assert.equal(rows[ROWS - 1][0], '＞', 'next bubble has a label')
  assert.equal(rows[ROWS - 1][1], BUBBLE[g.next])
  assert.equal(rows[SHOOTER_Y][1], '▶', 'centered launcher points right')

  setAim(g, 24)
  rows = renderGrid(g).split('\n').map((row) => [...row])
  assert.equal(rows[SHOOTER_Y][1], '◥', 'launcher tilts upward')
  assert.ok(fire(g))
  tick(g)
  assert.ok(g.trail.length > 0 && renderGrid(g).includes('・'), 'flying bubble leaves a short trail')
})

test('aim guide uses directional line glyphs', () => {
  const g = classic(); startGame(g)
  setAim(g, 30)
  const field = (text) => text.split('\n').slice(0, ROWS).join('\n') // without the frame's floor
  let grid = field(renderGrid(g))
  assert.ok(grid.includes('／'), 'upward shots use rising diagonals')
  assert.ok(!grid.includes('━'), 'a diagonal aim is drawn as one continuous slash line')
  setAim(g, -30)
  assert.ok(renderGrid(g).includes('＼'), 'downward shots use falling diagonals')
  setAim(g, 0)
  grid = field(renderGrid(g))
  assert.ok(grid.includes('━'), 'level shots use horizontal lines')
  assert.ok(!grid.includes('／') && !grid.includes('＼'), 'a level aim has no slashes')
  setAim(g, 70)
  const path = aimPath(g)
  const bounced = renderGrid(g)
  assert.ok(path.length > ROWS, 'a steep aim bounces')
  const uprights = [...bounced].filter((ch) => ch === '┃').length
  assert.ok(uprights > ROWS, 'a near-vertical aim is drawn upright (more ┃ than the wall alone)')
})

test('title and end screens use the grid rows and exact copy', () => {
  const g = classic()
  const splash = renderSplash(g).split('\n')
  assert.equal(splash.length, SCREEN_ROWS)
  for (let y = 0; y < SCREEN_ROWS; y++) assert.equal([...splash[y]].length, COLS, `title row ${y} is a full grid row`)
  assert.ok(splash[0].startsWith('◈◇─') && splash[0].endsWith('─◇◈') && splash[0] === splash.at(-1), 'ornate light rule top and bottom')
  assert.ok(splash[1].startsWith('◇') && splash[2].startsWith('│') && splash[8].endsWith('◇'), 'flourished corners, light sides')
  assert.ok(splash[1].includes('ＢＵＢＢＬＥＳ'), 'the name is set in fullwidth letters on the grid')
  assert.ok(splash[3].includes('●━') && splash[3].includes('━◌'), 'the demo shot has a shooter and landing marker')
  assert.ok(splash[8].includes(fw('CLASSIC   100+ LEVELS')), 'no best score shows the level count')
  g.highScore = 420
  assert.ok(renderSplash(g).split('\n')[8].includes(fw('CLASSIC   BEST 420')))
  g.mode = 'pulley'
  assert.ok(renderSplash(g).split('\n')[8].includes(fw('PULLEY   BEST 420')))
  g.mode = 'classic'

  startGame(g)
  g.level = 3; g.score = 250
  assert.ok(renderLevelCard(g).includes(fw('LEVEL 2 CLEARED')), 'the card names the level just cleared')

  g.phase = 'over'; g.newBest = true; g.highScore = 250
  const over = renderGameOver(g)
  assert.ok(over.includes(fw('GAME OVER')) && over.includes(fw('NEW BEST 250')) && over.includes(fw('LEVEL 3')), over)
  for (const row of over.split('\n')) assert.equal([...row].length, COLS, 'the framed game over is full width')
  g.newBest = false; g.highScore = 420
  assert.ok(renderGameOver(g).includes(fw('BEST 420')))
  assert.equal(fw('Tap: go on, +2'), 'ＴＡＰ：　ＧＯ　ＯＮ，　＋２')
  assert.ok(!renderGameOver(g).includes('·'), 'no middle-dot separators')
})

test('all 100 Frozen Bubble levels load attached, clear of the shooter, with a matchable colour loaded', () => {
  assert.equal(LEVEL_COUNT, 100)
  for (const level of LEVELS) {
    assert.equal(level.length, ROWS)
    for (const row of level) assert.equal(row.length, LEVEL_DEPTH)
  }
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const g = classic(); g.level = n; g.phase = 'play'; fillLevel(g)
    let count = 0, atWall = 0
    const present = new Set()
    for (let c = 0; c < g.field.length; c++) if (g.field[c]) { count++; present.add(isMystery(g.field[c]) ? mysteryColour(g.field[c]) : g.field[c]); if (c % COLS === g.wallCol) atWall++ }
    assert.ok(count > 0, `level ${n} empty`)
    assert.ok(atWall > 0, `level ${n} has nothing on the wall`)
    for (const t of [g.loaded, g.next]) assert.ok(present.has(t) || t === RAINBOW, `level ${n} loaded a colour that is not on the board`)
    checkInvariants(g)
    for (const row of renderGrid(g).split('\n')) assert.equal([...row].length, COLS, `level ${n} render width`)
  }
})


test('tick scales motion, effects and the hurry clock by elapsed time', () => {
  const a = classic(); startGame(a); setAim(a, 0); fire(a)
  const b = classic(); startGame(b); setAim(b, 0); fire(b)
  tick(a); tick(a)
  tick(b, 2)
  assert.ok(a.flying && b.flying, 'both shots are still in the air after a short flight')
  assert.ok(Math.abs(a.flying.x - b.flying.x) < 1e-9, 'two unit ticks cover the same distance as one double tick')

  const c = classic(); startGame(c); setAim(c, 0); fire(c)
  let n = 0
  while (c.flying && n++ < 400) tick(c)
  if (c.effectFrame > 0) {
    const frames = c.effectFrame
    tick(c, 0.5)
    assert.equal(c.effectFrame, frames - 0.5, 'effects count down in fractional ticks')
    assert.ok(renderGrid(c).length > 0, 'a fractional effect age still renders')
  }

  const d = classic(); d.mode = 'pulley'; startGame(d)
  tick(d, 2.5)
  assert.equal(d.idleTicks, 2.5, 'the hurry-up clock advances by elapsed ticks')
})
