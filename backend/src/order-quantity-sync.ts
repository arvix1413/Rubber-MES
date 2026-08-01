export type OrderQuantityUpdate = {
  itemId: number
  arrivedQty: number
  balance: number
  status: 'pending' | 'partial' | 'completed'
}

/**
 * MySQL CASE expressions consume parameters column-by-column. Keeping the
 * parameter groups separate prevents values from different order lines and
 * columns being bound to the wrong placeholders during a multi-order shipment.
 */
export const buildOrderQuantityCaseUpdate = (updates: OrderQuantityUpdate[]) => ({
  arrivedCase: updates.map(() => 'WHEN ? THEN ?').join(' '),
  balanceCase: updates.map(() => 'WHEN ? THEN ?').join(' '),
  statusCase: updates.map(() => 'WHEN ? THEN ?').join(' '),
  params: [
    ...updates.flatMap((item) => [item.itemId, item.arrivedQty]),
    ...updates.flatMap((item) => [item.itemId, item.balance]),
    ...updates.flatMap((item) => [item.itemId, item.status]),
    ...updates.map((item) => item.itemId),
  ],
})
