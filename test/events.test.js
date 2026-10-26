import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { toInput } from '../src/events.ts'

const T = OsEventTypeList

test('each event type maps to its input, from the hardware, simulator and raw-JSON shapes', () => {
  assert.deepEqual(toInput({ textEvent: { eventType: T.CLICK_EVENT } }), { kind: 'tap' })
  assert.deepEqual(toInput({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT } }), { kind: 'double' })
  assert.deepEqual(toInput({ listEvent: { eventType: T.SCROLL_TOP_EVENT } }), { kind: 'up' })
  assert.deepEqual(toInput({ textEvent: { eventType: T.SCROLL_BOTTOM_EVENT } }), { kind: 'down' })
  assert.deepEqual(toInput({ textEvent: { eventType: T.LONG_PRESS_EVENT } }), { kind: 'hold' })
  assert.equal(toInput({ textEvent: { eventType: T.LONG_PRESS_RELEASE_EVENT } }), null)
  assert.deepEqual(toInput({ sysEvent: { eventType: T.FOREGROUND_ENTER_EVENT } }), { kind: 'overlay-open' })
  assert.deepEqual(toInput({ sysEvent: { eventType: T.FOREGROUND_EXIT_EVENT } }), { kind: 'overlay-close' })
  assert.equal(toInput({ sysEvent: { eventType: T.SYSTEM_EXIT_EVENT } }), null)
  assert.equal(toInput({ sysEvent: { eventType: T.ABNORMAL_EXIT_EVENT } }), null)
  assert.equal(toInput({ sysEvent: { eventType: T.IMU_DATA_REPORT, imuData: {} } }), null)
  assert.deepEqual(toInput({ jsonData: { eventType: 'DOUBLE_CLICK_EVENT' } }), { kind: 'double' })
  assert.deepEqual(toInput({ jsonData: { event_type: 'SCROLL_TOP_EVENT' } }), { kind: 'up' })
  assert.deepEqual(toInput({ jsonData: { Event_Type: 'LONG_PRESS_RELEASE_EVENT' } }), null)
  assert.deepEqual(toInput({ menuItemClickEvent: { itemID: 4 } }), { kind: 'menu', id: 4 })
})

test('a click whose zero eventType was dropped by protobuf is still a tap', () => {
  assert.deepEqual(toInput({ textEvent: {} }), { kind: 'tap' })
  assert.deepEqual(toInput({ listEvent: {} }), { kind: 'tap' })
  assert.deepEqual(toInput({ sysEvent: {} }), { kind: 'tap' })
  assert.equal(toInput({ sysEvent: { imuData: { x: 0 } } }), null, 'IMU data with no type is not a tap')
})

test('anything unrecognised is dropped rather than fired as a shot', () => {
  assert.equal(toInput({}), null)
  assert.equal(toInput({ jsonData: {} }), null)
  assert.equal(toInput({ textEvent: { eventType: 99 } }), null, 'an event type a future firmware adds')
  assert.equal(toInput({ sysEvent: { eventType: 42 } }), null)
  assert.equal(toInput({ jsonData: { eventType: 'SOME_NEW_EVENT' } }), null, 'an unknown event name')
  assert.equal(toInput({ jsonData: { eventType: 'HEAD_GESTURE' } }), null)
})
