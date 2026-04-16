import { type CompanySettings } from './useCompany'

export function generateDeliveryNoteHTML(data: any, signatureUrl?: string, company?: CompanySettings): string {
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
  const orderRef = txt(data.po_ref || data.order_po_number || '')
  const totalQty = items.reduce((s: number, i: any) => s + num(i.qty), 0)

  const itemRows = items.map((item: any, i: number) => {
    return [
      '<tr>',
      '<td style="text-align:center">' + (i+1) + '</td>',
      '<td class="col-order" style="font-family:monospace;font-size:10px;color:#1a56db">' + txt(item.po_ref || orderRef) + '</td>',
      '<td class="col-material" style="font-family:monospace;font-size:10px;color:#1a56db">' + txt(item.material_code) + '</td>',
      '<td class="col-name">' + txt(item.item_name) + '</td>',
      '<td class="col-spec" style="color:#555;font-size:10px">' + txt(item.spec) + '</td>',
      '<td class="col-unit" style="text-align:center">' + (txt(item.unit) || 'PCS') + '</td>',
      '<td class="col-qty" style="text-align:right;font-weight:600">' + fmt(item.qty) + '</td>',
      '<td class="col-remark" style="color:#666;font-size:10px">' + txt(item.remark) + '</td>',
      '</tr>',
    ].join('')
  }).join('')

  const parts: string[] = []

  parts.push('<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"/>')
  parts.push('<title>出貨單 ' + txt(data.dn_number) + '</title>')
  parts.push('<style>')
  parts.push('*{margin:0;padding:0;box-sizing:border-box}')
  parts.push('body{font-family:"Microsoft JhengHei","PingFang TC",Arial,sans-serif;font-size:11px;font-weight:400;color:#000;padding:12mm 15mm;background:#fff;line-height:1.4}')
  parts.push('.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:5mm;margin-bottom:5mm}')
  parts.push('.company{font-size:18px;font-weight:700;letter-spacing:1px;text-transform:uppercase}')
  parts.push('.subtitle{font-size:10px;color:#666;margin-top:3px}')
  parts.push('.doc-title{font-size:22px;font-weight:700;color:#1a56db;text-align:right}')
  parts.push('.doc-sub{font-size:10px;color:#666;text-align:right;margin-top:2px}')
  parts.push('.doc-no{font-size:12px;font-weight:600;text-align:right;margin-top:3px}')
  parts.push('.info-table{width:100%;border-collapse:collapse;margin-bottom:5mm}')
  parts.push('.info-table td{border:1px solid #bbb;padding:5px 8px;font-size:11px;font-weight:400;vertical-align:middle}')
  parts.push('.info-table .lbl{font-weight:600;background:#f5f5f5;white-space:nowrap;width:110px;color:#333}')
  parts.push('table.items{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:5mm}')
  parts.push('table.items th{border:1px solid #555;background:#e8e8e8;padding:6px 6px;text-align:center;font-size:10px;font-weight:600;color:#000}')
  parts.push('table.items td{border:1px solid #bbb;padding:5px 6px;font-size:11px;font-weight:400;color:#000}')
  parts.push('table.items tbody tr:nth-child(even){background:#fafafa}')
  parts.push('table.items .col-order{width:78px}')
  parts.push('table.items .col-material{width:78px}')
  parts.push('table.items .col-spec{width:72px}')
  parts.push('table.items .col-unit{width:45px}')
  parts.push('table.items .col-qty{width:60px}')
  parts.push('table.items .col-remark{width:68px}')
  parts.push('table.items .col-name{word-break:break-word;line-height:1.35}')
  parts.push('.total-row td{border:1px solid #555;background:#efefef;font-weight:600;font-size:11px;padding:6px 8px}')
  parts.push('.notes-box{border:1px solid #bbb;padding:6px 10px;margin-bottom:5mm;font-size:10px;font-weight:400}')
  parts.push('.notes-title{font-weight:600;margin-bottom:3px;font-size:10px}')
  parts.push('.footer{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:8mm}')
  parts.push('.sign-box{border:1px solid #bbb;padding:8px 10px;text-align:center;display:flex;flex-direction:column}')
  parts.push('.sign-label{font-weight:600;font-size:10px;color:#333;padding-bottom:4px;border-bottom:1px solid #eee}')
  parts.push('.sign-area{flex:1;min-height:50px;display:flex;align-items:center;justify-content:center}')
  parts.push('.sign-line{border-top:1px solid #555;padding-top:4px;font-size:10px;font-weight:400;color:#333;margin-top:4px}')
  parts.push('@media print{body{padding:8mm 12mm}@page{size:A4;margin:0}}')
  parts.push('</style></head><body>')

  // Header
  parts.push('<div class="header">')
  parts.push('<div>' + (logoUrl ? `<img src="${logoUrl}" style="max-height:40px;max-width:160px;object-fit:contain;margin-bottom:4px" onerror="this.style.display='none'"/><br/>` : '') + '<div class="company">' + txt(co.company_name) + '</div><div class="subtitle">' + txt(co.company_name_local) + '</div></div>')
  parts.push('<div><div class="doc-title">出貨單</div><div class="doc-sub">DELIVERY NOTE / PHIẾU GIAO HÀNG</div><div class="doc-no">No. ' + txt(data.dn_number) + '</div></div>')
  parts.push('</div>')

  // Info table
  parts.push('<table class="info-table">')
  parts.push('<tr><td class="lbl">客戶<br/>Khách hàng</td><td style="font-weight:600;font-size:12px" colspan="3">' + txt(data.customer_name) + '</td><td class="lbl">出貨單號<br/>Số phiếu</td><td style="font-family:monospace;font-weight:600">' + txt(data.dn_number) + '</td></tr>')
  parts.push('<tr><td class="lbl">出貨日期<br/>Ngày giao</td><td>' + txt(data.delivery_date) + '</td><td class="lbl">訂單號<br/>Mã đơn</td><td colspan="3">' + txt(orderRef) + '</td></tr>')
  if (data.address) {
    parts.push('<tr><td class="lbl">出貨地址<br/>Địa chỉ</td><td colspan="5">' + txt(data.address) + '</td></tr>')
  }
  parts.push('</table>')

  // Table
  parts.push('<table class="items">')
  parts.push('<thead><tr>')
  parts.push('<th style="width:28px">ST</th>')
  parts.push('<th class="col-order">訂單編號</th>')
  parts.push('<th class="col-material">物料編號</th>')
  parts.push('<th class="col-name">品名</th>')
  parts.push('<th class="col-spec">規格</th>')
  parts.push('<th class="col-unit">單位</th>')
  parts.push('<th class="col-qty">數量</th>')
  parts.push('<th class="col-remark">備註</th>')
  parts.push('</tr></thead>')
  parts.push('<tbody>')
  parts.push(itemRows)
  
  // Total row
  parts.push('<tr class="total-row">')
  parts.push('<td colspan="6" style="text-align:right">總計 / Tổng cộng</td>')
  parts.push('<td style="text-align:right;font-size:12px;color:#1a56db">' + fmt(totalQty) + '</td>')
  parts.push('<td></td>')
  parts.push('</tr>')
  parts.push('</tbody></table>')

  // Notes
  if (data.remark) {
    parts.push('<div class="notes-box"><div class="notes-title">備註 / Ghi chú：</div><div>' + txt(data.remark).replace(/\n/g, '<br/>') + '</div></div>')
  }

  // Footer signatures
  parts.push('<div class="footer">')
  parts.push('<div class="sign-box"><div class="sign-label">FAN YONG 確認 / Xác nhận</div><div class="sign-area">')
  if (signatureUrl) {
    parts.push('<img src="' + signatureUrl + '" style="max-height:44px;max-width:150px;object-fit:contain" />')
  }
  parts.push('</div><div class="sign-line">' + txt(co.company_name) + '</div></div>')
  parts.push('<div class="sign-box"><div class="sign-label">客戶簽收 / Khách hàng ký</div><div class="sign-area"></div><div class="sign-line">' + txt(data.customer_name) + '</div></div>')
  parts.push('</div>')

  parts.push('</body></html>')
  return parts.join('')
}
