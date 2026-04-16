import { type CompanySettings } from './useCompany'

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
  const fmt = (v: any) => num(v).toLocaleString()

  const co = company || {
    company_name: 'FAN YONG CO., LTD',
    company_name_local: 'CÔNG TY TNHH FAN YONG VIỆT NAM',
    address: '', phone: '', contact_person: '', logo_url: null,
  }
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://43.133.56.234'
  const logoUrl = co.logo_url ? (co.logo_url.startsWith('http') ? co.logo_url : `${API_BASE}${co.logo_url}`) : null
  const items: any[] = data.items || []
  const subtotal = items.reduce((s: number, i: any) => s + (Number(i.qty)||0) * (Number(i.unit_price)||0), 0)
  const total = subtotal

  const itemRows = items.map((item: any, idx: number) => {
    const unitPrice = num(item.unit_price)
    const qty = num(item.qty)
    const amt = qty * unitPrice
    const nameText = txt(item.product_name)
    const skuVal = txt(item.product_sku)
    const skuText = skuVal ? '<div style="font-size:9px;color:#888;margin-top:1px">(' + skuVal + ')</div>' : ''
    return [
      '<tr>',
      '<td style="text-align:center">' + (idx+1) + '</td>',
      '<td>' + nameText + skuText + '</td>',
      '<td style="color:#555">' + txt(item.spec) + '</td>',
      '<td style="text-align:right;font-weight:600">' + fmt(qty) + '</td>',
      '<td style="text-align:center">' + (txt(item.unit) || 'PCS') + '</td>',
      '<td style="text-align:right">' + fmt(unitPrice) + '</td>',
      '<td style="text-align:right;font-weight:600">' + fmt(amt) + '</td>',
      '</tr>',
    ].join('')
  }).join('')

  const CSS = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Microsoft JhengHei","PingFang TC",Arial,sans-serif;font-size:11px;font-weight:400;color:#000;padding:12mm 15mm;background:#fff;line-height:1.4}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:5mm;margin-bottom:5mm}
    .company{font-size:18px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
    .subtitle{font-size:10px;color:#666;margin-top:3px}
    .doc-title{font-size:22px;font-weight:700;color:#1a56db;text-align:right}
    .doc-sub{font-size:10px;color:#666;text-align:right;margin-top:2px}
    .doc-no{font-size:12px;font-weight:600;text-align:right;margin-top:3px}
    .info-table{width:100%;border-collapse:collapse;margin-bottom:5mm}
    .info-table td{border:1px solid #bbb;padding:5px 8px;font-size:11px;font-weight:400;vertical-align:middle}
    .info-table .lbl{font-weight:600;background:#f5f5f5;white-space:nowrap;width:120px;color:#333}
    table.items{width:100%;border-collapse:collapse;margin-bottom:5mm}
    table.items th{border:1px solid #555;background:#e8e8e8;padding:6px 8px;text-align:center;font-size:10px;font-weight:600;color:#000}
    table.items td{border:1px solid #bbb;padding:5px 8px;font-size:11px;font-weight:400;color:#000}
    table.items tbody tr:nth-child(even){background:#fafafa}
    .total-row td{border:1px solid #555;background:#efefef;font-weight:600;font-size:11px;padding:6px 8px}
    .summary-right{width:260px;border:1px solid #bbb;padding:6px 10px;margin-left:auto;margin-bottom:5mm}
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
    @media print{body{padding:10mm}@page{size:A4;margin:0}}
  `

  const parts: string[] = []
  parts.push('<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"/>')
  parts.push('<title>客戶訂單 ' + txt(data.po_number) + '</title>')
  parts.push('<style>' + CSS + '</style></head><body>')

  // Header
  parts.push('<div class="header">')
  parts.push('<div>' + (logoUrl ? `<img src="${logoUrl}" style="max-height:40px;max-width:160px;object-fit:contain;margin-bottom:4px" onerror="this.style.display='none'"/><br/>` : '') + '<div class="company">' + txt(co.company_name) + '</div><div class="subtitle">' + txt(co.company_name_local) + '</div></div>')
  parts.push('<div><div class="doc-title">客戶訂單</div><div class="doc-sub">CUSTOMER ORDER / ĐƠN HÀNG KHÁCH</div><div class="doc-no">No. ' + txt(data.po_number) + '</div></div>')
  parts.push('</div>')

  // Info table
  parts.push('<table class="info-table">')
  parts.push('<tr><td class="lbl">客戶<br/>Khách hàng</td><td style="font-weight:600;font-size:12px" colspan="3">' + txt(data.customer_name) + '</td><td class="lbl">訂單號<br/>Số đơn</td><td style="font-family:monospace;font-weight:600">' + txt(data.po_number) + '</td></tr>')
  parts.push('<tr><td class="lbl">採購日期<br/>Ngày đặt</td><td>' + txt(data.po_date) + '</td><td class="lbl">交貨日<br/>Ngày giao</td><td>' + txt(data.delivery_date) + '</td><td class="lbl">幣種<br/>Loại tiền</td><td>' + (txt(data.currency) || 'VND') + '</td></tr>')
  if (data.payment_terms) {
    parts.push('<tr><td class="lbl">付款方式<br/>Thanh toán</td><td colspan="5">' + data.payment_terms + '</td></tr>')
  }
  if (data.delivery_address) {
    parts.push('<tr><td class="lbl">交貨地點<br/>Địa chỉ giao</td><td colspan="5">' + data.delivery_address + '</td></tr>')
  }
  if (data.person_in_charge) {
    parts.push('<tr><td class="lbl">負責人<br/>Người phụ trách</td><td colspan="5">' + data.person_in_charge + '</td></tr>')
  }
  parts.push('</table>')

  // Items table
  parts.push('<table class="items"><thead><tr>')
  parts.push('<th style="width:30px">ST</th><th>品名 / Tên hàng</th><th style="width:100px">規格</th><th style="width:65px">數量</th><th style="width:45px">單位</th><th style="width:80px">單價</th><th style="width:90px">金額</th>')
  parts.push('</tr></thead><tbody>' + itemRows + '</tbody>')
  parts.push('<tfoot><tr class="total-row"><td colspan="6" style="text-align:right">小計 / Tổng chưa thuế</td><td style="text-align:right">' + fmt(subtotal) + '</td></tr></tfoot>')
  parts.push('</table>')

  // Summary
  parts.push('<div class="summary-right">')
  parts.push('<div class="sum-row"><span>小計</span><span>' + fmt(subtotal) + '</span></div>')
  parts.push('<div class="sum-row"><span>總計</span><span style="font-size:13px;color:#1a56db">' + fmt(total) + ' ' + (txt(data.currency) || 'VND') + '</span></div>')
  parts.push('</div>')

  // Notes
  parts.push('<div class="notes"><div class="notes-title">備註 / Ghi chú：</div><div>' + txt(data.remark) + '</div></div>')

  // Terms
  parts.push('<div class="terms"><strong>注意事項：</strong> 訂單確認後不得擅自更改，如需更改須經本公司書面同意。收到本訂單後，請簽名並蓋章回傳。</div>')

  // Signatures
  parts.push('<div class="footer">')
  parts.push('<div class="sign-box"><div class="sign-label">FAN YONG 確認 / Xác nhận</div><div class="sign-area">')
  if (signatureUrl) {
    parts.push('<img src="' + signatureUrl + '" style="max-height:44px;max-width:150px;object-fit:contain" />')
  }
  parts.push('</div><div class="sign-line">' + txt(co.company_name) + '</div></div>')
  parts.push('<div class="sign-box"><div class="sign-label">客戶簽章 / Khách hàng ký</div><div class="sign-area"></div><div class="sign-line">' + txt(data.customer_name) + '</div></div>')
  parts.push('</div>')

  parts.push('</body></html>')
  return parts.join('')
}
