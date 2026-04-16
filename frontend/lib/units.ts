export const UNIT_OPTIONS = [
  'ROLL',
  'SHEET',
  'PCS',
  'KG',
  'BOX',
  'SET',
] as const

export function normalizeUnit(unit?: string): string {
  const val = String(unit || '').trim()
  if (!val) return 'PCS'
  const upper = val.toUpperCase()
  const legacyMap: Record<string, string> = {
    '捲 ROLL': 'ROLL',
    '張 SHEET': 'SHEET',
    '片 PCS': 'PCS',
    '公斤 KG': 'KG',
    'KG 公斤': 'KG',
    '盒 BOX': 'BOX',
    '套 SET': 'SET',
  }
  if (legacyMap[upper]) return legacyMap[upper]
  if (UNIT_OPTIONS.includes(upper as any)) return upper
  return val
}

export function getUnitOptions(current?: string): string[] {
  const normalized = normalizeUnit(current)
  if (UNIT_OPTIONS.includes(normalized as any)) return [...UNIT_OPTIONS]
  return [normalized, ...UNIT_OPTIONS]
}
