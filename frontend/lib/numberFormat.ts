export const formatDecimal = (value: any, digits = 3): string => {
  const num = Number(value)
  if (!Number.isFinite(num)) return (0).toFixed(digits)
  return num.toLocaleString(undefined, {
    useGrouping: true,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export const formatInteger = (value: any): string => {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  return Math.round(num).toLocaleString()
}
