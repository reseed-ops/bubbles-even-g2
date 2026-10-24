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
let maxInFlight = 1              // measured on G2 glasses 2026-10-24: one push at a time gave 5.9 fps with no drops;
                                 // two in flight gave 4.7 fps, longer round trips and 19% dropped frames

// Frame meter: every acknowledged push records when it finished and how long
// the round trip took, so the phone page can show the real BLE frame rate.
type PushSample = { at: number; ms: number }
const samples: PushSample[] = []
const skips: number[] = []       // when a frame was dropped because every slot was busy
const METER_WINDOW_MS = 3000
const IDLE_GAP_MS = 250          // a longer pause between pushes is the player aiming, not a slow frame

export type FrameMeter = {
  ms: number        // mean round trip of a push, send to acknowledgement
  fps: number       // sustained display rate while frames are flowing
  skipped: number   // share of frames dropped because the glasses were still busy, 0..1
}

export function frameMeter(now = Date.now()): FrameMeter | null {
  while (samples.length && samples[0].at < now - METER_WINDOW_MS) samples.shift()
  while (skips.length && skips[0] < now - METER_WINDOW_MS) skips.shift()
  if (!samples.length) return null
  const ms = samples.reduce((sum, s) => sum + s.ms, 0) / samples.length
  const gaps: number[] = []
  for (let i = 1; i < samples.length; i++) {
    const gap = samples[i].at - samples[i - 1].at
    if (gap <= IDLE_GAP_MS) gaps.push(gap)
  }
  const meanGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
  const attempted = samples.length + skips.length
  return {
    ms: Math.round(ms),
    fps: meanGap > 0 ? Math.round(1000 / meanGap * 10) / 10 : 0,
    skipped: attempted ? skips.length / attempted : 0,
  }
}

// Resolves once no push is in flight, so a caller that wants its own push
// accepted rather than dropped can wait for the slot.
export async function whenIdle(timeoutMs = 2000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (inFlight > 0 && Date.now() < until) await new Promise<void>((r) => setTimeout(r, 5))
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
// Pipelining (two pushes in flight, the loop not waiting for acknowledgement)
// is available from the phone page but off by default: the glasses accept
// one update at a time, so a second push only queues behind the first.
//
// Every push sends the whole screen. contentOffset/contentLength are not a
// splice: the simulator shows only the text sent, drawn from the top, so a
// changed-span update leaves the rest of the display blank.
export async function pushScreen(bridge: EvenAppBridge, content: string): Promise<boolean> {
  if (!created || content === lastText) return false
  if (inFlight >= maxInFlight) { skips.push(Date.now()); return false }
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
