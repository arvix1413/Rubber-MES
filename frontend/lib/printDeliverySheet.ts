import { type CompanySettings } from './useCompany'
import { buildPrintStyles, cleanText, formatDate, formatQty, toNum } from './printUtils'

export function generateDeliverySheetHTML(data: any, signatureUrl?: string, company?: CompanySettings): string {
  const txt = cleanText
  const num = toNum
  const fmt = formatQty

  const co = company || {
    company_name: 'CÔNG TY TNHH ĐÔNG PHƯƠNG VŨNG TÀU (TO2)',
    company_name_local: '',
    address: '',
    phone: '',
    contact_person: '',
    logo_url: null,
  }

  const items: any[] = Array.isArray(data.items) ? data.items : []
  const totalQty = items.reduce((sum, i) => sum + num(i.qty), 0)

  const rows = items.map((item, idx) => {
    return `
      <tr>
        <td class="c">${idx + 1}</td>
        <td class="c mono">${txt(item.material_code)}</td>
        <td>${txt(item.item_name)}</td>
        <td class="c">${fmt(item.qty)}</td>
        <td class="c">${txt(item.unit) || 'SH'}</td>
        <td class="c mono">${txt(item.po_ref || data.po_ref || data.order_po_number)}</td>
      </tr>
    `
  }).join('')

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>DELIVERY SHEET ${txt(data.dn_number)}</title>
<style>${buildPrintStyles()}</style>
</head>
<body>
<div class="page">
  <div class="title">送貨單</div>
  <div class="subtitle">PHIẾU GIAO HÀNG / DELIVERY SHEET</div>

  <div class="meta-grid">
    <div class="card">
      <div class="row"><span class="label">收貨方</span><span>${txt(data.customer_name)}</span></div>
      <div class="row"><span class="label">出貨公司</span><span>${txt(co.company_name)}</span></div>
      <div class="row"><span class="label">地址</span><span>${txt(data.address || co.address)}</span></div>
      <div class="row"><span class="label">電話</span><span>${txt(co.phone)}</span></div>
    </div>
    <div class="card">
      <div class="row"><span class="label">單號</span><span class="mono">${txt(data.dn_number)}</span></div>
      <div class="row"><span class="label">日期</span><span>${formatDate(data.delivery_date)}</span></div>
      <div class="row"><span class="label">公司代碼</span><span>2211</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:42px">STT</th>
        <th style="width:82px">Mã số</th>
        <th>Tên vật liệu</th>
        <th style="width:80px">Số lượng</th>
        <th style="width:70px">Đơn vị</th>
        <th style="width:110px">Số đơn đặt hàng</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr>
        <td colspan="3" class="right"><b>Total</b></td>
        <td class="c"><b>${fmt(totalQty)}</b></td>
        <td></td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <div class="note"><b>備註 Remark:</b> ${txt(data.remark)}</div>

  <div class="sign-grid">
    <div class="sign-box">
      <div class="sign-title">收貨方確認</div>
      <div class="sign-line">${txt(data.customer_name)}</div>
    </div>
    <div class="sign-box">
      <div class="sign-title">出貨方確認</div>
      <div class="sign-img-wrap">${signatureUrl ? `<img src="${signatureUrl}" style="max-height:30px;max-width:120px;object-fit:contain"/>` : ''}</div>
      <div class="sign-line">${txt(co.contact_person || co.company_name)}</div>
    </div>
  </div>
</div>
</body>
</html>`
}
