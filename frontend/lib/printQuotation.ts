import { type CompanySettings } from './useCompany'
import {
  htmlPrintNumericStack,
  SHARED_PRINT_ITEM_TABLE_CSS,
  SHARED_PRINT_QUOTATION_ITEM_TABLE_CSS,
} from './printItemTableStyles'
import { formatDecimal, formatInteger } from './numberFormat'
import { normalizeMoqTiers } from './moqPricing'
import { getPrintSignatureConfig } from './printSignature'

export type QuotationPrintBom = { id: number; spec?: string; color?: string }
export type QuotationPrintCustomer = { address?: string; phone?: string; contact?: string }

export type QuotationPrintInput = {
  quotation: Record<string, unknown>
  q: Record<string, unknown>
  company: CompanySettings
  signUrl?: string
  customerDetail?: QuotationPrintCustomer | null
  boms?: QuotationPrintBom[]
}

const pad2 = (value: number) => String(value).padStart(2, '0')
const formatLocalYmd = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

const addMonthsYmd = (dateText: string, months: number) => {
  const normalized = String(dateText || '').trim().replace(/\//g, '-')
  if (!normalized) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!match) return normalized
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const base = new Date(year, monthIndex, day)
  if (Number.isNaN(base.getTime())) return normalized
  const next = new Date(base)
  next.setMonth(next.getMonth() + months)
  return formatLocalYmd(next)
}

export function generateQuotationHTML(input: QuotationPrintInput): string {
  const { quotation, q, company, signUrl = '', customerDetail, boms = [] } = input
  const txt = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = String(v).trim()
    if (!s || s === 'null' || s === 'undefined' || s === '—' || s === '-') return ''
    return s
  }
  const num = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  const fmt = (v: unknown) => formatDecimal(num(v))
  const escapeHtml = (v: unknown) =>
    txt(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  const items = Array.isArray(quotation.items) ? quotation.items : []
  const signatureConfig = getPrintSignatureConfig(company)
  const customerAddress = txt(customerDetail?.address)
  const customerPhone = txt(customerDetail?.phone)
  const customerContact = txt(customerDetail?.contact)
  const issueDateRaw = String(quotation.created_at || q.created_at || '').slice(0, 10)
  const issueDate = issueDateRaw ? issueDateRaw.replace(/-/g, '/') : ''
  const expireDateRaw =
    String(quotation.valid_until || q.valid_until || '').slice(0, 10) || addMonthsYmd(issueDateRaw, 6)
  const expireDate = expireDateRaw ? expireDateRaw.replace(/-/g, '/') : ''
  const currency = txt(q.currency).toUpperCase()
  const todayRateLine = currency === 'USD' ? '匯率: 1 USD = 26,500 VND' : ''

  const itemRows = items
    .map((item: Record<string, unknown>, idx: number) => {
      const matchedBom = item.bom_id ? boms.find((b) => b.id === item.bom_id) : undefined
      const spec = txt(item.spec || matchedBom?.spec)
      const color = txt(matchedBom?.color)
      const moqTiers = normalizeMoqTiers(item.moq_tiers)
      const moqLines = moqTiers.map(
        (tier) => `${formatInteger(tier.moq)} / ${formatDecimal(tier.price)}`,
      )
      const moqHtml = htmlPrintNumericStack(moqLines, escapeHtml)
      const unitPrice = num(item.unit_price)
      const usdPrice = currency === 'USD' ? fmt(unitPrice) : ''
      const vndPrice = currency === 'VND' ? fmt(unitPrice) : ''
      const remark = txt(item.remark)
      const displayRemark = remark || (currency === 'TWD' ? `Price in ${txt(q.currency)}` : '')

      return [
        '<tr>',
        `<td class="col-st">${idx + 1}</td>`,
        `<td class="col-name">${escapeHtml(item.item_name)}</td>`,
        `<td class="col-spec">${escapeHtml(spec)}</td>`,
        `<td class="col-color">${escapeHtml(color)}</td>`,
        `<td class="col-unit">${escapeHtml(txt(item.unit) || 'PCS')}</td>`,
        `<td class="col-moq">${moqHtml}</td>`,
        `<td class="col-price">${escapeHtml(usdPrice)}</td>`,
        `<td class="col-amt">${escapeHtml(vndPrice)}</td>`,
        `<td class="col-remark">${escapeHtml(displayRemark)}</td>`,
        '</tr>',
      ].join('')
    })
    .join('')

  const validityLine =
    '報價有效期限 / Quotation validity: This quotation is valid for six months from the date of issue.'
  const noteLines = [
    txt(q.remark),
    validityLine,
    '付款條件 / Payment: according to sales contract.',
    '交貨日期 / Lead time: to be confirmed by each product and final order arrangement.',
    '交貨方式 / Delivery: Vietnam local door to door.',
    '單價不含 VAT / Price excluding VAT.',
    '任何問題根據合同內容討論 / Any concern according to sales contract.',
    todayRateLine,
    txt(company.company_name),
  ].filter(Boolean)
  const noteText = noteLines.join('\n')

  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Microsoft JhengHei","PingFang TC",Arial,sans-serif;font-size:11px;font-weight:400;color:#000;background:#fff;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{padding:8mm 8mm 10mm;max-width:210mm;margin:0 auto}
    .topbar{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4mm}
    .title{font-size:24px;font-weight:700;letter-spacing:.5px}
    .doc-no{font-size:11px;font-weight:600;text-align:right;margin-top:4px}
    .block{margin-bottom:5px;font-size:11px;line-height:1.45}
    .block strong{font-weight:700}
    .meta{margin-top:2mm;margin-bottom:4mm}
    ${SHARED_PRINT_ITEM_TABLE_CSS}
    ${SHARED_PRINT_QUOTATION_ITEM_TABLE_CSS}
    .notes{margin-top:4mm;border:1px solid #bbb;padding:6px 10px}
    .notes-title{font-weight:700;margin-bottom:4px}
    .notes-body{white-space:pre-line;line-height:1.6;font-size:10px}
    .footer{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:8mm}
    .sign-box{border:1px solid #bbb;padding:8px 10px;text-align:center;display:flex;flex-direction:column}
    .sign-label{font-weight:600;font-size:10px;color:#333;padding-bottom:4px;border-bottom:1px solid #eee}
    .sign-area{flex:1;min-height:${signatureConfig.areaMinHeight}px;display:flex;align-items:center;justify-content:center}
    .sign-area img{${signatureConfig.imgStyle}}
    .sign-line{border-top:1px solid #555;padding-top:4px;font-size:10px;font-weight:400;color:#333;margin-top:4px}
    @media print{@page{size:A4;margin:0}}
  `

  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"/>
    <title>報價單 ${escapeHtml(quotation.quotation_number || q.quotation_number)}</title>
    <style>${css}</style></head><body>
    <div class="page">
      <div class="topbar">
        <div><div class="title">報價單 QUOTATION</div></div>
        <div><div class="doc-no">No. ${escapeHtml(quotation.quotation_number || q.quotation_number)}</div></div>
      </div>

      <div class="meta">
        <div class="block"><strong>公司名稱 Company Name:</strong> ${escapeHtml(company.company_name)}</div>
        <div class="block"><strong>地址 Address:</strong> ${escapeHtml(company.address)}</div>
        <div class="block"><strong>電話 Tel:</strong> ${escapeHtml(company.phone)}</div>
        <div class="block"><strong>聯繫人 Contact person:</strong> ${escapeHtml(company.contact_person)}</div>
        <div class="block"><strong>報價日期 Date Issue:</strong> ${escapeHtml(issueDate)}</div>
        <div class="block"><strong>報價期限 Date Expire:</strong> ${escapeHtml(expireDate)}</div>
        <div class="block"><strong>客戶工廠名稱 Company Name:</strong> ${escapeHtml(q.customer_name)}</div>
        <div class="block"><strong>地址 Address:</strong> ${escapeHtml(customerAddress)}</div>
        <div class="block"><strong>電話 Tel:</strong> ${escapeHtml(customerPhone)}</div>
        <div class="block"><strong>聯繫人 Contact person:</strong> ${escapeHtml(customerContact)}</div>
      </div>

      <table class="items quote-items"><thead><tr>
        <th class="col-st">項目\nItem</th>
        <th class="col-name">產品 Products</th>
        <th class="col-spec">規格\nSpec</th>
        <th class="col-color">顏色\nColor</th>
        <th class="col-unit">單位\nUnit</th>
        <th class="col-moq">MOQ / 單價</th>
        <th class="col-price">美金價\nPrice USD</th>
        <th class="col-amt">越盾價\nVND</th>
        <th class="col-remark">備註</th>
      </tr></thead><tbody>${itemRows}</tbody></table>

      <div class="notes">
        <div class="notes-title">備註 Mark</div>
        <div class="notes-body">${escapeHtml(noteText)}</div>
      </div>

      <div class="footer">
        <div class="sign-box">
          <div class="sign-label">我方確認</div>
          <div class="sign-area">${signUrl ? `<img src="${signUrl}" onerror="this.style.display='none'"/>` : ''}</div>
          <div class="sign-line">${escapeHtml(company.company_name)}</div>
        </div>
        <div class="sign-box">
          <div class="sign-label">客戶簽章</div>
          <div class="sign-area"></div>
          <div class="sign-line">${escapeHtml(q.customer_name)}</div>
        </div>
      </div>
    </div>
  </body></html>`
}

export function openQuotationPrint(html: string) {
  const w = window.open('', '_blank', 'width=900,height=1200')
  if (w) {
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 600)
  }
}
