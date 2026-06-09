export const NUMBER_LOCALE = 'vi-VN'

export const toFiniteNumber = (value: any, fallback = 0): number => {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export const formatNumber = (value: any, options?: Intl.NumberFormatOptions): string =>
  toFiniteNumber(value, 0).toLocaleString(NUMBER_LOCALE, {
    useGrouping: true,
    ...options,
  })

export const formatDecimal = (value: any, digits = 3): string => {
  return formatNumber(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}

export const formatInteger = (value: any): string =>
  Math.round(toFiniteNumber(value, 0)).toLocaleString(NUMBER_LOCALE)

export const formatQuantity = (value: any, digits = 4): string =>
  formatNumber(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })

export const parseDecimalInput = (raw: string): number | null | undefined => {
  const text = String(raw || '').trim().replace(/\s+/g, '')
  if (!text) return undefined

  let normalized = text
  const commaCount = (text.match(/,/g) || []).length
  const dotCount = (text.match(/\./g) || []).length

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = text.lastIndexOf(',')
    const lastDot = text.lastIndexOf('.')
    normalized = lastComma > lastDot
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '')
  } else if (commaCount > 0) {
    normalized = commaCount === 1 ? text.replace(',', '.') : text.replace(/,/g, '')
  } else if (dotCount > 0) {
    normalized = /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, '') : text
  }

  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) return null
  return value
}
