import { type CompanySettings } from './useCompany'
import { SHARED_PRINT_ITEM_TABLE_CSS } from './printItemTableStyles'
import { SHARED_PRINT_PARTY_TABLE_CSS } from './printPartyTableStyles'

export function generateOrderHTML(data: any, signatureUrl?: string, company?: CompanySettings): string {
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
  const fmtQty = (v: any) => num(v).toLocaleString()
  const fmtMoney = (v: any) => num(v).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  const fmtText = (v: any) => txt(v).replace(/\n/g, '<br/>')
  const fmtDate = (v: any) => {
    const s = txt(v)
    if (!s) return ''
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s)
    return m ? m[1] : s
  }

  const co = company || {
    company_name: 'VUNG TAU ORIENT CO., LTD. - TO2',
    company_name_local: '',
    address: '',
    phone: '',
    contact_person: '',
    logo_url: null,
  }
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://43.133.56.234:10102'
  const logoUrl = co.logo_url ? (String(co.logo_url).startsWith('http') ? co.logo_url : `${API_BASE}${co.logo_url}`) : null
  const customerName = txt(data.customer_name)
  const customerAddress = txt(data.customer_address || data.address || data.delivery_address)
  const customerPhone = txt(data.customer_phone)
  const customerContact = txt(data.customer_contact || data.person_in_charge)
  const items: any[] = Array.isArray(data.items) ? data.items : []
  const subtotal = items.reduce((s: number, i: any) => s + (num(i.qty) * num(i.unit_price)), 0)

  const itemRows = items.map((item: any, idx: number) => {
    const unitPrice = num(item.unit_price)
    const qty = num(item.qty)
    const amt = qty * unitPrice
    const poNo = txt(item.po_no || data.po_number)
    return [
      '<tr>',
      `<td class="col-st" style="text-align:center">${idx + 1}</td>`,
      `<td class="col-code">${poNo}</td>`,
      `<td class="col-material">${txt(item.product_sku || item.material_code)}</td>`,
      `<td class="col-name">${txt(item.product_name || item.item_name)}</td>`,
      `<td class="col-spec">${txt(item.spec)}</td>`,
      `<td class="col-qty">${fmtQty(qty)}</td>`,
      `<td class="col-unit" style="text-align:center">${txt(item.unit) || 'PCS'}</td>`,
      `<td class="col-price">${fmtMoney(unitPrice)}</td>`,
      `<td class="col-amt">${fmtMoney(amt)}</td>`,
      `<td class="col-remark">${fmtText(item.remark)}</td>`,
      '</tr>',
    ].join('')
  }).join('')

  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Microsoft JhengHei","PingFang TC",Arial,sans-serif;font-size:11px;font-weight:400;color:#000;padding:8mm 6mm;background:#fff;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
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
    .notes{border:1px solid #bbb;padding:6px 10px;margin-bottom:5mm;min-height:30px;font-size:10px;font-weight:400}
    .notes-title{font-weight:600;margin-bottom:3px;font-size:10px}
    .terms{border:1px solid #ccc;padding:6px 10px;margin-bottom:5mm;font-size:9px;font-weight:400;line-height:1.5;color:#555}
    .footer{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:8mm}
    .sign-box{border:1px solid #bbb;padding:8px 10px;text-align:center;display:flex;flex-direction:column}
    .sign-label{font-weight:600;font-size:10px;color:#333;padding-bottom:4px;border-bottom:1px solid #eee}
    .sign-area{flex:1;min-height:50px;display:flex;align-items:center;justify-content:center}
    .sign-line{border-top:1px solid #555;padding-top:4px;font-size:10px;font-weight:400;color:#333;margin-top:4px}
    @media print{@page{size:A4;margin:0}}
  `

  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"/><title>客戶訂單 ${txt(data.po_number)}</title><style>${css}</style></head><body>
    <div class="header">
      <div>
        ${logoUrl ? `<img src="${logoUrl}" style="max-height:40px;max-width:160px;object-fit:contain;margin-bottom:4px" onerror="this.style.display='none'"/><br/>` : ''}
        <div class="company">${txt(co.company_name)}</div>
        <div class="subtitle">${txt(co.company_name_local)}</div>
      </div>
      <div>
        <div class="doc-title">客戶訂單</div>
        <div class="doc-sub">CUSTOMER ORDER / ĐƠN HÀNG KHÁCH</div>
        <div class="doc-no">No. ${txt(data.po_number)}</div>
      </div>
    </div>

    <table class="party-table">
      <tr><td class="section" colspan="4">本公司 / Company Name</td><td class="section" colspan="4">客戶公司 / Customer Name</td></tr>
      <tr><td class="label">公司名</td><td class="value" colspan="3">${txt(co.company_name)}</td><td class="label">公司名</td><td class="value" colspan="3">${customerName}</td></tr>
      <tr><td class="label">地址</td><td class="value" colspan="3">${txt(co.address)}</td><td class="label">地址</td><td class="value" colspan="3">${customerAddress}</td></tr>
      <tr><td class="label">電話</td><td class="value" colspan="3">${txt(co.phone)}</td><td class="label">電話</td><td class="value" colspan="3">${customerPhone}</td></tr>
      <tr><td class="label">聯絡人</td><td class="value" colspan="3">${txt(co.contact_person)}</td><td class="label">聯絡人</td><td class="value" colspan="3">${customerContact}</td></tr>
    </table>

    <table class="info-table">
      <tr><td class="lbl">客戶</td><td style="font-weight:600;font-size:12px" colspan="3">${customerName}</td><td class="lbl">訂單號</td><td style="font-family:monospace;font-weight:600">${txt(data.po_number)}</td></tr>
      <tr><td class="lbl">採購日期</td><td>${fmtDate(data.po_date)}</td><td class="lbl">交貨日</td><td>${fmtDate(data.delivery_date)}</td><td class="lbl">幣種</td><td>${txt(data.currency) || 'VND'}</td></tr>
      ${data.payment_terms ? `<tr><td class="lbl">付款方式</td><td colspan="5">${txt(data.payment_terms)}</td></tr>` : ''}
      ${data.delivery_address ? `<tr><td class="lbl">交貨地點</td><td colspan="5">${txt(data.delivery_address)}</td></tr>` : ''}
      ${data.person_in_charge ? `<tr><td class="lbl">負責人</td><td colspan="5">${txt(data.person_in_charge)}</td></tr>` : ''}
    </table>

    <table class="items"><thead><tr>
      <th class="col-st">ST</th><th class="col-code">PO No</th><th class="col-material">MTL No</th><th class="col-name">品名</th><th class="col-spec">規格</th><th class="col-qty">數量</th><th class="col-unit">單位</th><th class="col-price">單價</th><th class="col-amt">金額</th><th class="col-remark">備註</th>
    </tr></thead><tbody>${itemRows}</tbody>
    <tfoot><tr class="total-row"><td colspan="8">小計</td><td>${fmtMoney(subtotal)}</td><td></td></tr></tfoot></table>

    <div class="summary-right">
      <div class="sum-row"><span>小計</span><span>${fmtMoney(subtotal)}</span></div>
      <div class="sum-row"><span>總計</span><span>${fmtMoney(subtotal)} ${txt(data.currency) || 'VND'}</span></div>
    </div>

    <div class="notes"><div class="notes-title">備註：</div><div>${fmtText(data.remark)}</div></div>
    <div class="terms"><strong>注意事項：</strong> 訂單確認後不得擅自更改，如需更改須經本公司書面同意。收到本訂單後，請簽名並蓋章回傳。</div>

    <div class="footer">
      <div class="sign-box"><div class="sign-label">我方確認</div><div class="sign-area">${signatureUrl ? `<img src="${signatureUrl}" style="max-height:44px;max-width:150px;object-fit:contain"/>` : ''}</div><div class="sign-line">${txt(co.company_name)}</div></div>
      <div class="sign-box"><div class="sign-label">客戶簽章</div><div class="sign-area"></div><div class="sign-line">${customerName}</div></div>
    </div>
  </body></html>`
}
