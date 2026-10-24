import {
  CreateStartUpPageContainer,
  MenuContainerProperty,
  MenuItemProperty,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
export { renderGrid, renderSplash, renderGameOver, renderScreen } from './grid.ts'

export type PageKind = 'text'

const SCREEN_ID = 1

// The OS renders this outside our page. Essential actions remain available
// when a long press is claimed by the contextual-menu gesture.
const GAME_MENU = new MenuContainerProperty({
  menuItems: [
    new MenuItemProperty({ itemName: 'Restart game', itemID: 1 }),
    new MenuItemProperty({ itemName: 'Center aim', itemID: 2 }),
    new MenuItemProperty({ itemName: 'Classic mode', itemID: 3 }),
    new MenuItemProperty({ itemName: 'Pulley mode', itemID: 4 }),
    new MenuItemProperty({ itemName: 'Endless mode', itemID: 5 }),
    new MenuItemProperty({ itemName: 'Puzzle mode', itemID: 6 }),
    new MenuItemProperty({ itemName: 'Aim guide: full or short', itemID: 7 }),
    new MenuItemProperty({ itemName: 'Difficulty: easy, normal, hard', itemID: 8 }),
  ],
})

let created = false
let lastText = ''
let inFlight = 0
let maxInFlight = 2              // pipelined: the next frame leaves before the last one is acknowledged

// Frame meter: every acknowledged push records when it finished and how long
// the round trip took, so the phone page can show the real BLE frame rate.
type PushSample = { at: number; ms: number }
const samples: PushSample[] = []
const METER_WINDOW_MS = 2000

export type FrameMeter = { ms: number; fps: number }

export function frameMeter(now = Date.now()): FrameMeter | null {
  while (samples.length && samples[0].at < now - METER_WINDOW_MS) samples.shift()
  if (!samples.length) return null
  const ms = samples.reduce((sum, s) => sum + s.ms, 0) / samples.length
  // Frames per second is the sustained rate while frames are flowing (mean gap
  // between consecutive pushes), not a count diluted by idle time.
  const gaps = samples.length > 1 ? (samples[samples.length - 1].at - samples[0].at) / (samples.length - 1) : 0
  return { ms: Math.round(ms), fps: gaps > 0 ? Math.round(1000 / gaps * 10) / 10 : 0 }
}

export function setPipelined(on: boolean): void {
  maxInFlight = on ? 2 : 1
}

export function pipelined(): boolean {
  return maxInFlight > 1
}

export function currentPage(): PageKind | null {
  return created ? 'text' : null
}

export function invalidate(): void {
  lastText = ''
}

// One native full-screen text container handles both rendering and gestures.
// Keeping it for the app lifetime avoids page rebuild flashes and image BLE
// transfers; gameplay only upgrades changed text.
export async function showPage(bridge: EvenAppBridge, text: string): Promise<boolean> {
  if (created) return pushScreen(bridge, text)

  const ok = (await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
    containerTotalNum: 1,
    menuObject: GAME_MENU,
    textObject: [
      new TextContainerProperty({
        containerID: SCREEN_ID,
        containerName: 'screen',
        content: text,
        xPosition: 0,
        yPosition: 0,
        width: 576,
        height: 288,
        isEventCapture: 1,
        paddingLength: 0,
      }),
    ],
  }))) === 0

  if (ok) {
    created = true
    lastText = text
  }
  return ok
}

// A frame that arrives while BLE is saturated is dropped instead of queued. The
// next game tick carries the latest state, keeping input and animation lively.
// By default two pushes may be in flight: the game loop ticks on its own clock
// and does not wait for each acknowledgement, so the display rate is set by
// how fast the glasses accept text rather than by round-trip latency.
//
// Every push sends the whole screen. contentOffset/contentLength are not a
// splice: the simulator shows only the text sent, drawn from the top, so a
// changed-span update leaves the rest of the display blank.
export async function pushScreen(bridge: EvenAppBridge, content: string): Promise<boolean> {
  if (!created || inFlight >= maxInFlight || content === lastText) return false
  inFlight++
  lastText = content   // claimed on send so a pipelined follow-up is not a duplicate
  const started = Date.now()
  try {
    const ok = await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: SCREEN_ID,
      containerName: 'screen',
      content,
    }))
    const now = Date.now()
    samples.push({ at: now, ms: now - started })
    if (!ok && lastText === content) lastText = ''
    return ok
  } catch {
    if (lastText === content) lastText = ''
    return false
  } finally {
    inFlight--
  }
}
