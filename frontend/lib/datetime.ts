const DATE_ONLY_PATTERN = /^(\d{4}-\d{2}-\d{2})/
const TZ = 'Asia/Taipei'

const ymdFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const hmFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (value === null || value === undefined || value === '') return null
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

export const formatDateYMD = (value: unknown): string => {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return ''
    const direct = text.match(DATE_ONLY_PATTERN)
    if (direct) return direct[1]
  }
  const d = toDate(value)
  if (!d) return ''
  return ymdFormatter.format(d)
}

export const formatDateTime = (value: unknown): string => {
  const date = formatDateYMD(value)
  if (!date) return ''
  const d = toDate(value)
  if (!d) return date
  return `${date} ${hmFormatter.format(d)}`
}

export const todayYMD = (): string => formatDateYMD(new Date())
