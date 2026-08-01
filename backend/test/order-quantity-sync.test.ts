import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOrderQuantityCaseUpdate } from '../src/order-quantity-sync'

test('groups CASE parameters by target column for multiple order lines', () => {
  const result = buildOrderQuantityCaseUpdate([
    { itemId: 101, arrivedQty: 8, balance: 2, status: 'partial' },
    { itemId: 202, arrivedQty: 5, balance: 0, status: 'completed' },
  ])

  assert.equal(result.arrivedCase, 'WHEN ? THEN ? WHEN ? THEN ?')
  assert.equal(result.balanceCase, 'WHEN ? THEN ? WHEN ? THEN ?')
  assert.equal(result.statusCase, 'WHEN ? THEN ? WHEN ? THEN ?')
  assert.deepEqual(result.params, [
    101, 8, 202, 5,
    101, 2, 202, 0,
    101, 'partial', 202, 'completed',
    101, 202,
  ])
})
