import { formatDateYMD } from './datetime'
import { formatDecimal, formatQuantity } from './numberFormat'

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
  return formatQuantity(n)
}

export const formatMoney = (value: any): string => formatDecimal(toNum(value))

export const formatDate = (value: any): string => {
  const s = cleanText(value)
  if (!s) return ''
  const d = formatDateYMD(s)
  return d || s
}

export const buildPrintStyles = (): string => `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#0f172a}
body{
  font-family:"Noto Sans","Noto Sans TC","PingFang TC","Microsoft JhengHei","Helvetica Neue",Arial,sans-serif;
  font-size:12px;
  line-height:1.35;
  font-weight:500;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
.page{width:210mm;min-height:297mm;margin:0 auto;padding:8mm 9mm 9mm}
.title{text-align:center;font-weight:800;font-size:28px;letter-spacing:.8px;line-height:1.08;color:#0b1f3a}
.subtitle{text-align:center;font-weight:700;font-size:12px;color:#475569;margin-top:2px}
.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}
.card{border:1px solid #334155;padding:5px 7px}
.row{display:flex;gap:6px;align-items:flex-start;line-height:1.38}
.label{min-width:98px;font-weight:700;color:#1e293b}
.row > span:last-child{flex:1;word-break:break-word;overflow-wrap:anywhere}
.mono{font-family:inherit;font-variant-numeric:tabular-nums;letter-spacing:.2px}
table{width:100%;border-collapse:collapse;margin-top:7px;table-layout:fixed}
th,td{border:1px solid #334155;padding:4px 5px;vertical-align:middle;word-break:break-word;overflow-wrap:anywhere}
th{background:#e2e8f0;text-align:center;font-size:12px;font-weight:700;color:#0f172a}
td{text-align:center;font-size:12px}
thead{display:table-header-group}
tr{break-inside:avoid;page-break-inside:avoid}
.c{text-align:center}
.left{text-align:left}
.right{text-align:right}
.r{text-align:right}
.summary{margin-top:6px;margin-left:auto;width:300px;border:1px solid #334155;break-inside:avoid;page-break-inside:avoid}
.summary-row{display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #cbd5e1}
.summary-row:last-child{border-bottom:none;font-weight:800}
.note{margin-top:7px;border:1px solid #334155;padding:6px 8px;min-height:48px;line-height:1.42;white-space:pre-wrap}
.sign-grid{display:grid;grid-template-columns:1fr 1fr;gap:9mm;margin-top:14mm;align-items:stretch;break-inside:avoid;page-break-inside:avoid}
.sign-box{border:1px solid #334155;height:94px;padding:6px 8px;text-align:center;display:flex;flex-direction:column}
.sign-title{font-weight:700;color:#0f172a;font-size:12px}
.sign-img-wrap{flex:1;min-height:36px;display:flex;align-items:center;justify-content:center;padding:2px 0}
.sign-img-wrap img{max-height:28px;max-width:130px;object-fit:contain}
.sign-line{border-top:1px solid #334155;padding-top:4px;font-size:12px;color:#334155}
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
