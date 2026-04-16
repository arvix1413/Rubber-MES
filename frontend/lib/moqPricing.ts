export type MoqTier = { moq: number; price: number }

export function normalizeMoqTiers(raw: any): MoqTier[] {
  const src = Array.isArray(raw) ? raw : []
  return src
    .map((row: any) => ({
      moq: Math.max(0, Number(row?.moq) || 0),
      price: Math.max(0, Number(row?.price) || 0),
    }))
    .filter((row: MoqTier) => row.moq > 0 || row.price > 0)
    .sort((a: MoqTier, b: MoqTier) => a.moq - b.moq)
}

export function resolveTierPrice(
  tiers: MoqTier[] | undefined,
  qty: number,
  fallbackPrice = 0
): number {
  const list = normalizeMoqTiers(tiers)
  const targetQty = Math.max(0, Number(qty) || 0)
  let price = Number(fallbackPrice) || 0
  for (const tier of list) {
    if (tier.moq <= targetQty && tier.price > 0) price = tier.price
  }
  return price
}
