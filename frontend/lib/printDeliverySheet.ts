import { type CompanySettings } from './useCompany'
import { SHARED_PRINT_ITEM_TABLE_CSS } from './printItemTableStyles'

export function generateDeliverySheetHTML(data: any, signatureUrl?: string, company?: CompanySettings): string {
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
    company_name: 'CÔNG TY TNHH ĐÔNG PHƯƠNG VŨNG TÀU (TO2)',
    company_name_local: '',
    address: '',
    phone: '',
    contact_person: '',
    email: '',
    logo_url: null,
  }
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://43.133.56.234:10102'
  const logoUrl = co.logo_url ? (String(co.logo_url).startsWith('http') ? co.logo_url : `${API_BASE}${co.logo_url}`) : null
  const items: any[] = Array.isArray(data.items) ? data.items : []
  const totalQty = items.reduce((s, i) => s + num(i.qty), 0)

  const rows = items.map((item, idx) => `
    <tr>
      <td style="text-align:center">${idx + 1}</td>
      <td class="col-material" style="font-family:monospace">${txt(item.material_code)}</td>
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
    body{font-family:"Microsoft JhengHei","PingFang TC",Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:6mm 4mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
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
    ${SHARED_PRINT_ITEM_TABLE_CSS}
    table.items th{background:#f5f5f5;font-weight:700}
    .sub{display:block;font-size:10px;font-weight:500;color:#333;margin-top:1px}
    .qty{text-align:center;font-weight:400}
    .right{text-align:center}
    .footer{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:8mm}
    .sign-box{border:1px solid #bbb;padding:8px 10px;text-align:center;display:flex;flex-direction:column}
    .sign-label{font-weight:600;font-size:10px;color:#333;padding-bottom:4px;border-bottom:1px solid #eee}
    .sign-area{flex:1;min-height:50px;display:flex;align-items:center;justify-content:center}
    .sign-line{border-top:1px solid #555;padding-top:4px;font-size:10px;font-weight:400;color:#333;margin-top:4px}
    @media print{@page{size:A4;margin:4mm}}
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
        <div><b>Ngày giao：</b>${txt(data.delivery_date)}</div>
        <div><b>出貨單號：</b>${txt(data.dn_number)}</div>
        <div><b>Số phiếu：</b>${txt(data.dn_number)}</div>
      </div>
    </div>

    <div class="title">送貨單</div>
    <div class="title-sub">Phiếu giao hàng</div>

    <div class="cust">客戶：${txt(data.customer_name)}</div>
    <div class="addr">${txt(data.address)}</div>

    <table class="items">
      <thead>
        <tr>
          <th style="width:48px">序號<span class="sub">SỐ TT</span></th>
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
        <tr class="total-row">
          <td colspan="5" class="right">Total</td>
          <td class="qty">${fmt(totalQty)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      <div class="sign-box"><div class="sign-label">收貨方簽章</div><div class="sign-area"></div><div class="sign-line">${txt(data.customer_name)}</div></div>
      <div class="sign-box"><div class="sign-label">交貨方簽章</div><div class="sign-area">${signatureUrl ? `<img src="${signatureUrl}" style="max-height:44px;max-width:150px;object-fit:contain"/>` : ''}</div><div class="sign-line">${txt(co.contact_person || co.company_name)}</div></div>
    </div>
  </div></body></html>`

  return html
}
