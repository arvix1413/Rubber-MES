import { type CompanySettings } from './useCompany'
import { buildPrintStyles, cleanText, formatDate, formatMoney, formatQty, toNum } from './printUtils'

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
        <td class="mono">${txt((item as any).po_no || data.po_number)}</td>
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
<style>${buildPrintStyles()}</style>
</head>
<body>
<div class="page">
  <div class="title">Purchase Order</div>
  <div class="subtitle">PURCHASE ORDER</div>

  <div class="meta-grid">
    <div class="card">
      <div class="row"><span class="label">To Vendor</span><span>${vendor}</span></div>
      <div class="row"><span class="label">Address</span><span>${txt(data.delivery_address || data.address)}</span></div>
      <div class="row"><span class="label">Company</span><span>${txt(co.company_name)}</span></div>
      <div class="row"><span class="label">Tax No</span><span>${txt((co as any).tax_id)}</span></div>
      <div class="row"><span class="label">Tel No</span><span>${txt(co.phone)}</span></div>
    </div>
    <div class="card">
      <div class="row"><span class="label">Slip No</span><span class="mono">${txt(data.po_number)}</span></div>
      <div class="row"><span class="label">PO Date</span><span>${formatDate(data.po_date)}</span></div>
      <div class="row"><span class="label">Currency</span><span>${currency}</span></div>
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
        <td colspan="6" class="right"><b>Total</b></td>
        <td class="right"><b>${fmt(total)}</b></td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <div class="note">
    <div><b>Remark</b></div>
    <div>1. Deliver to: ${txt(data.delivery_address || co.address)}</div>
    <div>2. Deliver during working time. For any abnormal case, please contact purchase department in advance.</div>
    <div>3. You can send feedback & RTA within two days after receiving this PO.</div>
    <div>4. Price does not include tax unless explicitly stated.</div>
    <div>5. Purchase Order receiving method: Email / Paper / Fax.</div>
    <div style="margin-top:4px">${txt(data.remark)}</div>
  </div>

  <div class="sign-grid">
    <div class="sign-box">
      <div class="sign-title">Vendor Confirmation</div>
      <div class="sign-img-wrap"></div>
      <div class="sign-line">${vendor}</div>
    </div>
    <div class="sign-box">
      <div class="sign-title">Buyer Confirmation</div>
      <div class="sign-img-wrap">${signatureUrl ? `<img src="${signatureUrl}" style="max-height:30px;max-width:120px;object-fit:contain"/>` : ''}</div>
      <div class="sign-line">${txt(co.contact_person || co.company_name)}</div>
    </div>
  </div>
</div>
</body>
</html>`
}
