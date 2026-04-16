export const isEmail = (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
export const isPhone = (v: string) => !v || /^[\d\s\-+()]{6,20}$/.test(v)

type Rule = { field: string; label: string; required?: boolean; email?: boolean; phone?: boolean; minLen?: number }

export function validate(data: Record<string, any>, rules: Rule[]): string | null {
  for (const r of rules) {
    const v = (data[r.field] ?? '').toString().trim()
    if (r.required && !v) return `${r.label} 為必填`
    if (v && r.email && !isEmail(v)) return `${r.label} 格式不正確`
    if (v && r.phone && !isPhone(v)) return `${r.label} 格式不正確（僅允許數字、空格、+、-）`
    if (v && r.minLen && v.length < r.minLen) return `${r.label} 至少需要 ${r.minLen} 個字元`
  }
  return null
}
