import assert from 'node:assert/strict'
import test from 'node:test'
import { validateDeliveryStatusTransition } from '../src/delivery-status'

test('allows the normal draft -> confirmed -> shipped flow', () => {
  assert.deepEqual(validateDeliveryStatusTransition('draft', 'confirmed'), { idempotent: false })
  assert.deepEqual(validateDeliveryStatusTransition('confirmed', 'shipped'), { idempotent: false })
})

test('treats repeated status requests as idempotent repairs', () => {
  assert.deepEqual(validateDeliveryStatusTransition('confirmed', 'confirmed'), { idempotent: true })
  assert.deepEqual(validateDeliveryStatusTransition('shipped', 'shipped'), { idempotent: true })
})

test('rejects skipped or reversed transitions', () => {
  assert.throws(() => validateDeliveryStatusTransition('draft', 'shipped'), /INVALID_SHIP_TRANSITION/)
  assert.throws(() => validateDeliveryStatusTransition('shipped', 'confirmed'), /INVALID_CONFIRM_TRANSITION/)
  assert.throws(() => validateDeliveryStatusTransition('draft', 'cancelled'), /INVALID_STATUS/)
})
