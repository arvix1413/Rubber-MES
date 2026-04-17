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

export const buildPrintStyles = (): string => `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#0f172a}
body{font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",Arial,sans-serif;font-size:11px;line-height:1.35}
.page{width:210mm;min-height:297mm;margin:0 auto;padding:8mm 9mm 9mm}
.title{text-align:center;font-weight:800;font-size:30px;letter-spacing:.8px;line-height:1.08;color:#0b1f3a}
.subtitle{text-align:center;font-weight:700;font-size:13px;color:#475569;margin-top:2px}
.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}
.card{border:1px solid #334155;padding:5px 7px}
.row{display:flex;gap:6px;align-items:flex-start;line-height:1.38}
.label{min-width:92px;font-weight:700;color:#1e293b}
.mono{font-family:Consolas,Menlo,monospace}
table{width:100%;border-collapse:collapse;margin-top:7px}
th,td{border:1px solid #334155;padding:4px 5px;vertical-align:middle}
th{background:#e2e8f0;text-align:center;font-size:10px;font-weight:700;color:#0f172a}
td{text-align:center}
.c{text-align:center}
.left{text-align:left}
.right{text-align:right}
.r{text-align:right}
.summary{margin-top:6px;margin-left:auto;width:300px;border:1px solid #334155}
.summary-row{display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #cbd5e1}
.summary-row:last-child{border-bottom:none;font-weight:800}
.note{margin-top:7px;border:1px solid #334155;padding:6px 8px;min-height:48px;line-height:1.42}
.sign-grid{display:grid;grid-template-columns:1fr 1fr;gap:9mm;margin-top:14mm;align-items:stretch}
.sign-box{border:1px solid #334155;height:92px;padding:6px 8px;text-align:center;display:flex;flex-direction:column}
.sign-title{font-weight:700;color:#0f172a}
.sign-img-wrap{height:36px;display:flex;align-items:center;justify-content:center;margin-top:auto}
.sign-line{margin-top:auto;border-top:1px solid #334155;padding-top:4px;font-size:10px;color:#334155}
@media print{@page{size:A4;margin:0}body{margin:0}}
`

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
