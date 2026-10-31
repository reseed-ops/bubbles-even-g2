import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { initApp } from '../src/app.ts'
import { idx } from '../src/game.ts'
import { SHOOTER_Y } from '../src/layout.ts'

// A stand-in for the Even bridge: local storage in a Map, page creation that
// always succeeds, and the event handler captured so the test can feed taps.
function stubBridge(store) {
  let handler = null
  return {
    bridge: {
      getLocalStorage: async (key) => store.get(key),
      setLocalStorage: async (key, value) => { store.set(key, value) },
      onEvenHubEvent: (cb) => { handler = cb },
      createStartUpPageContainer: async () => 0,
      textContainerUpgrade: async () => true,
      shutDownPageContainer: async () => {},
    },
    send: (event) => handler(event),
  }
}

async function until(check, action, timeoutMs = 20000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the app')
    if (action) action()
    await new Promise((r) => setTimeout(r, 50))
  }
}

test('a mode picked mid-game does not steal the running game\'s best score', async () => {
  const store = new Map([['bubbles_mode', 'classic']])
  const { bridge, send } = stubBridge(store)
  const app = await initApp(bridge, () => {})
  const tap = () => send({ textEvent: { eventType: OsEventTypeList.CLICK_EVENT } })

  tap() // start a classic game
  await until(() => app.game.phase === 'play')
  assert.equal(app.game.mode, 'classic')

  // Stage a loss worth 500 points: a full row one step below the shooter,
  // reaching into the loss zone, in a colour the loaded bubble cannot match.
  const g = app.game
  g.score = 500
  g.field.fill(0)
  for (let x = 1; x <= g.wallCol; x++) g.field[idx(x, SHOOTER_Y + 1)] = 7
  g.loaded = 8

  app.setMode('endless') // picked mid-game: it applies from the next game
  assert.equal(g.mode, 'classic', 'the running game keeps the mode it started in')
  assert.equal(app.status().mode, 'endless', 'the phone shows the mode queued for the next game')

  // Fire until the staged loss lands. Taps during the READY / GO intro are
  // ignored by the app, so keep offering them until the shot is away.
  await until(() => g.phase === 'over', () => { if (!g.flying && g.shots === 0) tap() })
  await until(() => store.get('bubbles_high_score') === '500')
  assert.equal(store.get('bubbles_high_score_endless'), undefined, 'nothing was recorded against the new mode')
})
