import { type CompanySettings } from './useCompany'
import { cleanText, formatDate, formatMoney, formatQty, toNum } from './printUtils'

export function generateOrderHTML(data: any, signatureUrl?: string, company?: CompanySettings): string {
  const txt = cleanText
  const num = toNum
  const fmt = formatMoney

  const co = company || {
    company_name: 'VUNG TAU ORIENT CO., LTD. - TO2',
    company_name_local: '',
    address: '',
    phone: '',
    contact_person: '',
    tax_id: '',
    logo_url: null,
  }

  const items: any[] = Array.isArray(data.items) ? data.items : []
  const total = items.reduce((sum, i) => sum + num(i.qty) * num(i.unit_price), 0)
  const vendor = txt(data.customer_name)
  const currency = txt(data.currency) || 'VND'

  const rows = items.map((item: any) => {
    const desc = `${txt(item.product_name || item.item_name)} ${txt(item.spec)}`.trim()
    return `
      <tr>
        <td class="mono">${txt(data.po_number)}</td>
        <td class="mono">${txt(item.product_sku || item.material_code)}</td>
        <td>${desc}</td>
        <td class="r">${formatQty(item.qty)}</td>
        <td class="c">${txt(item.unit) || 'SH'}</td>
        <td class="r">${fmt(item.unit_price)}</td>
        <td class="r">${fmt(num(item.qty) * num(item.unit_price))}</td>
        <td class="c">${formatDate(item.rta_date || data.delivery_date)}</td>
      </tr>
    `
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Purchase Order ${txt(data.po_number)}</title>
<style>
*{box-sizing:border-box}
body{font-family:"PingFang TC","Noto Sans TC","Microsoft JhengHei",Arial,sans-serif;font-size:10.5px;color:#111;margin:0;background:#fff}
.page{width:210mm;min-height:297mm;padding:8.5mm 9mm 9mm;margin:0 auto}
.h{display:flex;justify-content:space-between;align-items:flex-start}
.title{font-size:32px;font-weight:800;text-align:center;line-height:1.02;margin-bottom:5px;letter-spacing:.3px}
.small{font-size:10.5px;line-height:1.35}
.mono{font-family:Consolas,Menlo,monospace}
table{width:100%;border-collapse:collapse;margin-top:6px}
th,td{border:1px solid #333;padding:4px 5px;vertical-align:top}
th{background:#f2f2f2;font-size:9.8px;text-align:center}
.c{text-align:center}
.r{text-align:right}
.note{margin-top:7px;border:1px solid #333;padding:5px 7px;line-height:1.36;min-height:66px}
.foot{display:grid;grid-template-columns:1fr 1fr;gap:9mm;margin-top:15mm}
.box{border:1px solid #333;min-height:82px;padding:6px;text-align:center}
.box .t{font-weight:700}
.box .line{margin-top:52px;border-top:1px solid #333;padding-top:4px;font-size:10px}
@media print{@page{size:A4;margin:0}body{margin:0}}
</style>
</head>
<body>
<div class="page">
  <div class="title">Purchase Order</div>
  <div class="h small">
    <div>
      <div><b>To Vendor:</b> ${vendor}</div>
      <div><b>Address:</b> ${txt(data.delivery_address || data.address)}</div>
      <div><b>Company:</b> ${txt(co.company_name)}</div>
      <div><b>Tax No:</b> ${txt((co as any).tax_id)}</div>
      <div><b>Tel No:</b> ${txt(co.phone)}</div>
    </div>
    <div>
      <div><b>Slip No:</b> <span class="mono">${txt(data.po_number)}</span></div>
      <div><b>PO Date:</b> ${formatDate(data.po_date)}</div>
      <div><b>Currency:</b> ${currency}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:86px">PO No</th>
        <th style="width:78px">Mtl No</th>
        <th>Description / Spec / Color</th>
        <th style="width:64px">Qty</th>
        <th style="width:44px">Unit</th>
        <th style="width:84px">Price</th>
        <th style="width:92px">Amount</th>
        <th style="width:80px">RTA</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr>
        <td colspan="6" class="r"><b>Total</b></td>
        <td class="r"><b>${fmt(total)}</b></td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <div class="note">
    <div><b>Remark:</b></div>
    <div>1. Deliver to: ${txt(data.delivery_address || co.address)}</div>
    <div>2. Delivery during working time; contact purchase department for any abnormal case.</div>
    <div>3. Price does not include tax unless explicitly stated.</div>
    <div>4. The Purchase Order Receiving Method: Email / Paper / Fax</div>
    <div style="margin-top:4px">${txt(data.remark)}</div>
  </div>

  <div class="foot">
    <div class="box">
      <div class="t">Vendor Confirmation</div>
      <div class="line">${vendor}</div>
    </div>
    <div class="box">
      <div class="t">Buyer Confirmation</div>
      <div style="height:34px;display:flex;align-items:center;justify-content:center">${signatureUrl ? `<img src="${signatureUrl}" style="max-height:30px;max-width:120px;object-fit:contain"/>` : ''}</div>
      <div class="line">${txt(co.contact_person || co.company_name)}</div>
    </div>
  </div>
</div>
</body>
</html>`
}
