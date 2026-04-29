import { type CompanySettings } from './useCompany'
import { SHARED_PRINT_ITEM_TABLE_CSS } from './printItemTableStyles'
import { SHARED_PRINT_PARTY_TABLE_CSS } from './printPartyTableStyles'
import { formatDateYMD } from './datetime'
import { formatDecimal, formatQuantity } from './numberFormat'

export function generateInvoiceHTML(data: any, signatureUrl?: string, company?: CompanySettings): string {
  const txt = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = String(v).trim()
    if (!s || s === 'null' || s === 'undefined' || s === '—' || s === '-') return ''
    return s
  }
  const num = (v: any) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  const fmtQty = (v: any) => formatQuantity(num(v))
  const fmtMoney = (v: any) => formatDecimal(num(v))
  const fmtText = (v: any) => txt(v).replace(/\n/g, '<br/>')

  const co = company || {
    company_name: 'RUBBER MES COMPANY',
    company_name_local: '',
    address: '',
    phone: '',
    contact_person: '',
    logo_url: null,
  }
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://43.133.56.234:10102'
  const logoUrl = co.logo_url ? (String(co.logo_url).startsWith('http') ? co.logo_url : `${API_BASE}${co.logo_url}`) : null

  const items: any[] = Array.isArray(data.items) ? data.items : []
  const invoiceType = txt(data.invoice_type) === 'supplier' ? 'supplier' : 'customer'
  const titleZh = invoiceType === 'supplier' ? '供應商發票' : '客戶發票'

  const rows = items.map((item: any, idx: number) => `
    <tr>
      <td class="col-st">${idx + 1}</td>
      <td class="col-code">${txt(item.po_number)}</td>
      <td class="col-material">${txt(item.material_code)}</td>
      <td class="col-name">${txt(item.material_name)}</td>
      <td class="col-unit">${txt(item.unit) || 'PCS'}</td>
      <td class="col-qty">${fmtQty(item.qty)}</td>
      <td class="col-price">${fmtMoney(item.unit_price)}</td>
      <td class="col-amt">${fmtMoney(item.amount)}</td>
      <td class="col-remark">${txt(item.spec)}</td>
    </tr>
  `).join('')

  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Microsoft JhengHei","PingFang TC",Arial,sans-serif;font-size:11px;font-weight:400;color:#000;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{padding:8mm 6mm;max-width:210mm;margin:0 auto}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:5mm;margin-bottom:5mm}
    .company{font-size:18px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
    .subtitle{font-size:10px;color:#666;margin-top:3px}
    .doc-title{font-size:22px;font-weight:700;color:#1a56db;text-align:right}
    .doc-sub{font-size:10px;color:#666;text-align:right;margin-top:2px}
    .doc-no{font-size:12px;font-weight:600;text-align:right;margin-top:3px}
    ${SHARED_PRINT_PARTY_TABLE_CSS}
    .info-table{width:100%;border-collapse:collapse;margin-bottom:5mm}
    .info-table td{border:1px solid #bbb;padding:5px 8px;font-size:11px;font-weight:400;vertical-align:middle;text-align:center}
    .info-table .lbl{font-weight:600;background:#f5f5f5;white-space:nowrap;width:120px;color:#333}
    ${SHARED_PRINT_ITEM_TABLE_CSS}
    .summary-right{width:300px;border:1px solid #bbb;padding:6px 10px;margin-left:auto;margin-bottom:5mm}
    .sum-row{display:flex;justify-content:space-between;padding:4px 0;font-size:11px;font-weight:400;border-bottom:1px solid #eee}
    .sum-row:last-child{border-bottom:none;border-top:2px solid #555;padding-top:6px;margin-top:2px;font-weight:600}
    .note-box{border:1px solid #bbb;padding:6px 10px;margin-bottom:5mm;font-size:10px;line-height:1.6}
    .note-title{font-weight:600;margin-bottom:4px}
    .sign-row{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:8mm}
    .sign-box{border:1px solid #bbb;padding:8px 10px;text-align:center;display:flex;flex-direction:column}
    .sign-label{font-weight:600;font-size:10px;color:#333;padding-bottom:4px;border-bottom:1px solid #eee}
    .sign-area{flex:1;min-height:50px;display:flex;align-items:center;justify-content:center}
    .sign-line{border-top:1px solid #555;padding-top:4px;font-size:10px;font-weight:400;color:#333;margin-top:4px}
    @media print{@page{size:A4;margin:0}}
  `

  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"/><title>發票 ${txt(data.invoice_no)}</title><style>${css}</style></head><body>
    <div class="page">
      <div class="header">
        <div>
          ${logoUrl ? `<img src="${logoUrl}" style="max-height:40px;max-width:160px;object-fit:contain;margin-bottom:4px" onerror="this.style.display='none'"/><br/>` : ''}
          <div class="company">${txt(co.company_name)}</div>
          <div class="subtitle">${txt(co.company_name_local)}</div>
        </div>
        <div>
          <div class="doc-title">${titleZh}</div>
          <div class="doc-sub">${invoiceType === 'supplier' ? 'SUPPLIER INVOICE' : 'CUSTOMER INVOICE'}</div>
          <div class="doc-no">No. ${txt(data.invoice_no)}</div>
        </div>
      </div>

      <table class="party-table">
        <tr><td class="section" colspan="4">本公司 / Company Name</td><td class="section" colspan="4">對象 / Party</td></tr>
        <tr><td class="label">公司名</td><td class="value" colspan="3">${txt(co.company_name)}</td><td class="label">公司名</td><td class="value" colspan="3">${txt(data.party_name)}</td></tr>
        <tr><td class="label">地址</td><td class="value" colspan="3">${txt(co.address)}</td><td class="label">地址</td><td class="value" colspan="3">${txt((data as any).party_address)}</td></tr>
        <tr><td class="label">電話</td><td class="value" colspan="3">${txt(co.phone)}</td><td class="label">電話</td><td class="value" colspan="3">${txt((data as any).party_phone)}</td></tr>
        <tr><td class="label">聯絡人</td><td class="value" colspan="3">${txt(co.contact_person)}</td><td class="label">聯絡人</td><td class="value" colspan="3">${txt((data as any).party_contact)}</td></tr>
      </table>

      <table class="info-table">
        <tr><td class="lbl">發票號</td><td style="font-family:monospace;font-weight:600">${txt(data.invoice_no)}</td><td class="lbl">發票日期</td><td>${txt(formatDateYMD(data.invoice_date || ''))}</td><td class="lbl">幣別</td><td>${txt(data.currency) || 'VND'}</td></tr>
        <tr><td class="lbl">狀態</td><td>${txt(data.status)}</td><td class="lbl">驗證碼</td><td style="font-family:monospace">${txt(data.verification_code)}</td><td class="lbl">稅率</td><td>${num(data.tax_rate)}%</td></tr>
      </table>

      <table class="items">
        <thead><tr>
          <th class="col-st">ST</th><th class="col-code">PO NO</th><th class="col-material">MTL NO</th><th class="col-name">DESCRIPTION</th><th class="col-unit">UNIT</th><th class="col-qty">QTY</th><th class="col-price">UNIT PRICE</th><th class="col-amt">AMOUNT</th><th class="col-remark">SPEC</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="summary-right">
        <div class="sum-row"><span>Subtotal</span><span>${fmtMoney(data.total_amount)}</span></div>
        <div class="sum-row"><span>Tax ${num(data.tax_rate)}%</span><span>${fmtMoney(data.tax_amount)}</span></div>
        <div class="sum-row"><span>Grand Total</span><span>${fmtMoney(data.grand_total)}</span></div>
      </div>

      <div class="note-box"><div class="note-title">備註：</div><div>${fmtText(data.remark)}</div><div style="margin-top:4px;color:#666">QR: ${txt(data.qr_payload)}</div></div>

      <div class="sign-row">
        <div class="sign-box"><div class="sign-label">${invoiceType === 'supplier' ? '供應商簽章' : '客戶簽章'}</div><div class="sign-area"></div><div class="sign-line">${txt(data.party_name)}</div></div>
        <div class="sign-box"><div class="sign-label">我方確認</div><div class="sign-area">${signatureUrl ? `<img src="${signatureUrl}" style="max-height:44px;max-width:150px;object-fit:contain"/>` : ''}</div><div class="sign-line">${txt(co.company_name)}</div></div>
      </div>
    </div>
  </body></html>`
}
