export type DeliveryStatus = 'draft' | 'confirmed' | 'shipped'
export type DeliveryStatusTarget = 'confirmed' | 'shipped'

export function validateDeliveryStatusTransition(current: string, target: string): { idempotent: boolean } {
  if (target !== 'confirmed' && target !== 'shipped') throw new Error('INVALID_STATUS')
  if (target === 'confirmed' && current !== 'draft' && current !== 'confirmed') {
    throw new Error('INVALID_CONFIRM_TRANSITION')
  }
  if (target === 'shipped' && current !== 'confirmed' && current !== 'shipped') {
    throw new Error('INVALID_SHIP_TRANSITION')
  }
  return { idempotent: current === target }
}
