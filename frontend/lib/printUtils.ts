export const cleanText = (value: any): string => {
  if (value === null || value === undefined) return ''
  const raw = String(value).trim()
  if (!raw || raw === 'null' || raw === 'undefined') return ''
  return fixMojibake(raw)
}

export const toNum = (value: any): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export const formatQty = (value: any): string => {
  const n = Math.round(toNum(value) * 10000) / 10000
  return n.toLocaleString()
}

export const formatMoney = (value: any): string => toNum(value).toLocaleString()

export const formatDate = (value: any): string => {
  const s = cleanText(value)
  if (!s) return ''
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toISOString().slice(0, 10)
}

const fixMojibake = (s: string): string => {
  if (!looksLikeMojibake(s)) return s
  try {
    const bytes = Uint8Array.from(Array.from(s).map((ch) => ch.charCodeAt(0) & 0xff))
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim()
    if (scoreText(decoded) > scoreText(s)) return decoded
    return s
  } catch {
    return s
  }
}

const looksLikeMojibake = (s: string): boolean => /Ã|Â|Ä|Å|Æ|Ð|Ñ|áº|á»|��/.test(s)

const scoreText = (s: string): number => {
  const cjk = (s.match(/[\u3400-\u9FFF]/g) || []).length
  const viet = (s.match(/[ĂÂĐÊÔƠƯăâđêôơưÁÀẢÃẠẮẰẲẴẶẤẦẨẪẬÉÈẺẼẸẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌỐỒỔỖỘỚỜỞỠỢÚÙỦŨỤỨỪỬỮỰÝỲỶỸỴáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/g) || []).length
  const bad = (s.match(/�|Ã|Â|Ä|Å|Æ|Ð|Ñ/g) || []).length
  return cjk * 3 + viet * 2 - bad * 2
}
