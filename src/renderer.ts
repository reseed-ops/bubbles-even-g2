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
export type RenderMode = 'bands' | 'full'

const FULL_ID = 1
const BAND_IDS = [2, 3, 4, 5] as const
const BAND_NAMES = ['rows-top', 'rows-middle', 'rows-bottom', 'row-footer'] as const
const BAND_STARTS = [0, 3, 6, 9] as const
const BAND_COUNTS = [3, 3, 3, 1] as const
const BAND_Y = [0, 86, 173, 259] as const
const BAND_HEIGHT = [86, 87, 86, 29] as const

const GAME_MENU = new MenuContainerProperty({
  menuItems: [
    new MenuItemProperty({ itemName: 'Restart game', itemID: 1 }),
    new MenuItemProperty({ itemName: 'Center aim', itemID: 2 }),
    new MenuItemProperty({ itemName: 'Classic mode', itemID: 3 }),
    new MenuItemProperty({ itemName: 'Pulley mode', itemID: 4 }),
    new MenuItemProperty({ itemName: 'Endless mode', itemID: 5 }),
    new MenuItemProperty({ itemName: 'Puzzle mode', itemID: 6 }),
    new MenuItemProperty({ itemName: 'Difficulty: easy, normal, hard', itemID: 7 }),
    new MenuItemProperty({ itemName: 'Glyphs: shapes / numbers', itemID: 8 }),
  ],
})

let created = false
let lastText = ''
let lastBands = ['', '', '', '']
let mode: RenderMode = 'bands'
let inFlight = 0 // one logical frame at a time; dirty bands are sent serially

type PushSample = { at: number; ms: number }
const samples: PushSample[] = []
const skips: number[] = []
const METER_WINDOW_MS = 3000
const IDLE_GAP_MS = 300

export type FrameMeter = {
  ms: number
  fps: number
  skipped: number
  mode: RenderMode
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
    mode,
  }
}

export async function whenIdle(timeoutMs = 2000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (inFlight > 0 && Date.now() < until) await new Promise<void>((r) => setTimeout(r, 5))
}

export function currentPage(): PageKind | null {
  return created ? 'text' : null
}

export function currentRenderMode(): RenderMode {
  return mode
}

export function invalidate(): void {
  lastText = ''
  lastBands = ['', '', '', '']
}

function splitBands(content: string): string[] {
  const rows = content.split('\n')
  return BAND_STARTS.map((start, band) => {
    const present = rows.slice(start, start + BAND_COUNTS[band])
    // The firmware treats an empty upgrade as "no replacement". A fullwidth
    // blank explicitly erases a band, notably the title frame's footer.
    return present.length ? present.join('\n') : '\u3000'
  })
}

async function upgrade(bridge: EvenAppBridge, id: number, name: string, content: string, textColor?: number): Promise<boolean> {
  try {
    return await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: id,
      containerName: name,
      content,
      ...(textColor === undefined ? {} : { textColor }),
    }))
  } catch {
    return false
  }
}

// Four persistent horizontal bands make the common case—a projectile moving
// inside three rows—a small display refresh. A hidden full-screen container is
// retained as a diagnostic and firmware fallback path.
export async function showPage(bridge: EvenAppBridge, text: string): Promise<boolean> {
  if (created) return pushScreen(bridge, text)
  const bands = splitBands(text)
  const textObject = [
    new TextContainerProperty({
      containerID: FULL_ID, containerName: 'screen-full', content: '',
      xPosition: 0, yPosition: 0, width: 576, height: 288,
      isEventCapture: 1, paddingLength: 0, textColor: 0, zOrderIndex: 0,
    }),
    ...BAND_IDS.map((id, i) => new TextContainerProperty({
      containerID: id, containerName: BAND_NAMES[i], content: bands[i],
      xPosition: 0, yPosition: BAND_Y[i], width: 576, height: BAND_HEIGHT[i],
      isEventCapture: 0, paddingLength: 0, textColor: 4, zOrderIndex: i + 1,
    })),
  ]
  const ok = (await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
    containerTotalNum: textObject.length,
    menuObject: GAME_MENU,
    textObject,
  }))) === 0
  if (ok) {
    created = true
    lastText = text
    lastBands = bands
  }
  return ok
}

// Diagnostics can switch paths and compare them on the actual glasses.
export async function setRenderMode(bridge: EvenAppBridge, next: RenderMode, content: string): Promise<boolean> {
  if (!created || next === mode || inFlight > 0) return false
  inFlight++
  try {
    if (next === 'full') {
      for (let i = 0; i < BAND_IDS.length; i++) await upgrade(bridge, BAND_IDS[i], BAND_NAMES[i], '', 0)
      const ok = await upgrade(bridge, FULL_ID, 'screen-full', content, 4)
      if (ok) { mode = next; lastText = content }
      return ok
    }
    await upgrade(bridge, FULL_ID, 'screen-full', '', 0)
    const bands = splitBands(content)
    let ok = true
    for (let i = 0; i < BAND_IDS.length; i++) ok = (await upgrade(bridge, BAND_IDS[i], BAND_NAMES[i], bands[i], 4)) && ok
    if (ok) { mode = next; lastText = content; lastBands = bands }
    return ok
  } finally {
    inFlight--
  }
}

// Only changed bands are upgraded. Multiple dirty bands remain serial because
// measurements showed that concurrent bridge writes lose frames.
export async function pushScreen(bridge: EvenAppBridge, content: string): Promise<boolean> {
  if (!created || content === lastText) return false
  if (inFlight > 0) { skips.push(Date.now()); return false }
  inFlight++
  const started = Date.now()
  let ok = true
  let attempted = false
  try {
    if (mode === 'full') {
      attempted = true
      ok = await upgrade(bridge, FULL_ID, 'screen-full', content)
    } else {
      const bands = splitBands(content)
      for (let i = 0; i < BAND_IDS.length; i++) {
        if (bands[i] === lastBands[i]) continue
        attempted = true
        const bandOK = await upgrade(bridge, BAND_IDS[i], BAND_NAMES[i], bands[i])
        if (bandOK) lastBands[i] = bands[i]
        else ok = false
      }
    }
    if (ok) lastText = content
    else lastText = ''
    if (attempted) {
      const now = Date.now()
      samples.push({ at: now, ms: now - started })
    }
    return attempted && ok
  } finally {
    inFlight--
  }
}
