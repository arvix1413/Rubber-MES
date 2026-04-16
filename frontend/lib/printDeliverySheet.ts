import { type CompanySettings } from './useCompany'

export function generateDeliverySheetHTML(data: any, company?: CompanySettings): string {
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
    address: '',
    phone: '',
    contact_person: '',
    email: '',
    logo_url: null,
    id: 1,
    tax_id: '',
  }
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://43.133.56.234'
  const logoUrl = co.logo_url ? (String(co.logo_url).startsWith('http') ? co.logo_url : `${API_BASE}${co.logo_url}`) : null
  const items: any[] = Array.isArray(data.items) ? data.items : []
  const totalQty = items.reduce((s, i) => s + num(i.qty), 0)
  const orderRef = txt(data.po_ref || data.order_po_number || '')

  const rows = items.map((item, idx) => `
    <tr>
      <td style="text-align:center">${idx + 1}</td>
      <td class="col-order" style="font-family:monospace">${txt(item.po_ref || orderRef)}</td>
      <td class="col-material" style="font-family:monospace;color:#1847b8">${txt(item.material_code)}</td>
      <td class="col-name">${txt(item.item_name)}</td>
      <td class="col-spec">${txt(item.spec)}</td>
      <td class="col-unit" style="text-align:center">${txt(item.unit) || 'PCS'}</td>
      <td class="col-qty" style="text-align:center">${fmt(item.qty)}</td>
      <td class="col-remark">${txt(item.remark)}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"/>
  <title>送貨單 ${txt(data.dn_number)}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:"Microsoft JhengHei","PingFang TC",Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:8mm}
    .wrap{max-width:210mm;margin:0 auto}
    .head{display:grid;grid-template-columns:88px 1fr 250px;align-items:start;gap:8px;margin-bottom:6px}
    .logo{height:30px;object-fit:contain;max-width:80px}
    .comp{font-size:14px;font-weight:700;text-align:center;line-height:1.2}
    .comp-sub{font-size:11px;font-weight:500;text-align:center;margin-top:2px}
    .comp-line{font-size:10px;text-align:center;color:#222;line-height:1.3}
    .title{font-size:32px;font-weight:700;text-align:center;margin:4px 0 0}
    .title-sub{font-size:18px;font-weight:700;text-align:center;margin:2px 0 6px}
    .meta{font-size:11px;line-height:1.5}
    .meta b{display:inline-block;width:92px}
    .cust{font-size:14px;font-weight:700;margin:4px 0}
    .addr{font-size:11px;margin-bottom:4px}
    table{width:100%;border-collapse:collapse;table-layout:fixed}
    th,td{border:1px solid #555;padding:5px 6px;font-size:11px;vertical-align:middle}
    th{background:#f5f5f5;font-weight:700;text-align:center}
    .sub{display:block;font-size:10px;font-weight:500;color:#333;margin-top:1px}
    .qty{text-align:center;font-weight:700}
    .total td{font-weight:700;background:#fafafa}
    .right{text-align:right}
    .col-order{width:112px}
    .col-material{width:112px}
    .col-spec{width:96px}
    .col-unit{width:72px}
    .col-qty{width:88px}
    .col-remark{width:96px}
    .col-name{word-break:break-word;line-height:1.35}
    @media print{body{padding:0}@page{size:A4;margin:8mm}}
  </style></head><body><div class="wrap">
    <div class="head">
      <div>${logoUrl ? `<img class="logo" src="${logoUrl}" onerror="this.style.display='none'"/>` : ''}</div>
      <div>
        <div class="comp">${txt(co.company_name)}</div>
        <div class="comp-sub">${txt(co.company_name_local)}</div>
        <div class="comp-line">${txt(co.address)}</div>
        <div class="comp-line">${txt(co.email)} ${txt(co.phone)}</div>
      </div>
      <div class="meta">
        <div><b>出貨日期：</b>${txt(data.delivery_date)}</div>
        <div><b>Ngày giao hàng：</b>${txt(data.delivery_date)}</div>
        <div><b>出貨單號：</b>${txt(data.dn_number)}</div>
        <div><b>Số phiếu giao hàng：</b>${txt(data.dn_number)}</div>
      </div>
    </div>

    <div class="title">送貨單</div>
    <div class="title-sub">Phiếu giao hàng</div>

    <div class="cust">客戶 Khách hàng：${txt(data.customer_name)}</div>
    <div class="addr">${txt(data.address)}</div>

    <table>
      <thead>
        <tr>
          <th style="width:48px">序號<span class="sub">SỐ TT</span></th>
          <th class="col-order">訂單編號<span class="sub">Mã đơn đặt</span></th>
          <th class="col-material">物料編號<span class="sub">Mã vật liệu</span></th>
          <th>品名<span class="sub">Tên hàng</span></th>
          <th class="col-spec">規格<span class="sub">Qui cách</span></th>
          <th class="col-unit">單位<span class="sub">Đơn vị</span></th>
          <th class="col-qty">交貨量<span class="sub">Số lượng</span></th>
          <th class="col-remark">備註<span class="sub">Ghi chú</span></th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="total">
          <td colspan="6" class="right">Total</td>
          <td class="qty">${fmt(totalQty)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div></body></html>`

  return html
}
