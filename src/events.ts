import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'

export type Input =
  | { kind: 'tap' }
  | { kind: 'double' }
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'hold' }
  | { kind: 'overlay-open' }
  | { kind: 'overlay-close' }
  | { kind: 'menu'; id: number }

function eventType(event: EvenHubEvent): number | string | undefined {
  const json = (event.jsonData ?? {}) as Record<string, unknown>
  return (
    event.sysEvent?.eventType ??
    event.textEvent?.eventType ??
    event.listEvent?.eventType ??
    (json.eventType as number | string | undefined) ??
    (json.event_type as number | string | undefined) ??
    (json.Event_Type as number | string | undefined)
  )
}

// Normalises hardware (textEvent), simulator (sysEvent) and raw-JSON shapes.
// CLICK is 0 and protobuf drops zero-valued fields, so a click can arrive as
// a text, list or sys event carrying no eventType at all: that exact shape is
// a tap. An event type that is present but unknown is dropped, never fired.
export function toInput(event: EvenHubEvent): Input | null {
  const menuID = event.menuItemClickEvent?.itemID
  if (menuID !== undefined) return { kind: 'menu', id: menuID }

  const raw = eventType(event)
  if (raw === undefined) {
    if (event.sysEvent?.imuData) return null
    if (event.textEvent || event.listEvent || event.sysEvent) return { kind: 'tap' }
    return null
  }
  const t = typeof raw === 'string' ? fromName(raw) : raw

  switch (t) {
    case OsEventTypeList.CLICK_EVENT: return { kind: 'tap' }
    case OsEventTypeList.DOUBLE_CLICK_EVENT: return { kind: 'double' }
    case OsEventTypeList.SCROLL_TOP_EVENT: return { kind: 'up' }
    case OsEventTypeList.SCROLL_BOTTOM_EVENT: return { kind: 'down' }
    case OsEventTypeList.LONG_PRESS_EVENT: return { kind: 'hold' }
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT: return null
    // These bracket the OS contextual-menu overlay. The page remains mounted.
    case OsEventTypeList.FOREGROUND_ENTER_EVENT: return { kind: 'overlay-open' }
    case OsEventTypeList.FOREGROUND_EXIT_EVENT: return { kind: 'overlay-close' }
    case OsEventTypeList.IMU_DATA_REPORT: return null
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
      return null
    default:
      return null
  }
}

function fromName(name: string): number | undefined {
  const v = name.toUpperCase()
  if (v.includes('IMU')) return OsEventTypeList.IMU_DATA_REPORT
  if (v.includes('DOUBLE')) return OsEventTypeList.DOUBLE_CLICK_EVENT
  if (v.includes('LONG') && v.includes('RELEASE')) return OsEventTypeList.LONG_PRESS_RELEASE_EVENT
  if (v.includes('LONG')) return OsEventTypeList.LONG_PRESS_EVENT
  if (v.includes('CLICK')) return OsEventTypeList.CLICK_EVENT
  if (v.includes('TOP') || v.includes('UP')) return OsEventTypeList.SCROLL_TOP_EVENT
  if (v.includes('BOTTOM') || v.includes('DOWN')) return OsEventTypeList.SCROLL_BOTTOM_EVENT
  if (v.includes('FOREGROUND_ENTER')) return OsEventTypeList.FOREGROUND_ENTER_EVENT
  if (v.includes('FOREGROUND_EXIT')) return OsEventTypeList.FOREGROUND_EXIT_EVENT
  return undefined
}
