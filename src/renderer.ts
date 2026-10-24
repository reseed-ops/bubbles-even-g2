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
let textInFlight = false

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

// A frame that arrives while BLE is busy is dropped instead of queued. The
// next game tick carries the latest state, keeping input and animation lively.
//
// Every push sends the whole screen. contentOffset/contentLength are not a
// splice: the simulator shows only the text sent, drawn from the top, so a
// changed-span update leaves the rest of the display blank.
export async function pushScreen(bridge: EvenAppBridge, content: string): Promise<boolean> {
  if (!created || textInFlight || content === lastText) return false
  textInFlight = true
  try {
    const ok = await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: SCREEN_ID,
      containerName: 'screen',
      content,
    }))
    if (ok) lastText = content
    return ok
  } finally {
    textInFlight = false
  }
}
