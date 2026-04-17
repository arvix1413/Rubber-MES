import { type CompanySettings } from './useCompany'
import { buildPrintStyles, cleanText, formatDate, formatMoney, formatQty, toNum } from './printUtils'

export function generateInvoiceHTML(data: any, signatureUrl?: string, company?: CompanySettings): string {
  const txt = cleanText
  const num = toNum
  const money = formatMoney
  const qty = formatQty

  const co = company || {
    company_name: 'RUBBER MES COMPANY',
    company_name_local: '',
    address: '',
    phone: '',
    contact_person: '',
    tax_id: '',
    logo_url: null,
  }

  const items: any[] = Array.isArray(data.items) ? data.items : []
  const invoiceType = txt(data.invoice_type) === 'supplier' ? 'supplier' : 'customer'
  const title = invoiceType === 'supplier' ? '供應商發票 / SUPPLIER INVOICE' : '客戶發票 / CUSTOMER INVOICE'

  const rows = items.map((item, idx) => `
      <tr>
        <td class="c">${idx + 1}</td>
        <td class="mono c">${txt(item.po_number)}</td>
        <td class="mono c">${txt(item.material_code)}</td>
        <td class="left">${txt(item.material_name)}</td>
        <td class="c">${txt(item.unit) || 'PCS'}</td>
        <td class="right">${qty(item.qty)}</td>
        <td class="right">${money(item.unit_price)}</td>
        <td class="right">${money(item.amount)}</td>
      </tr>
    `).join('')

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<title>發票 ${txt(data.invoice_no)}</title>
<style>${buildPrintStyles()}</style>
</head>
<body>
<div class="page">
  <div class="title">發票</div>
  <div class="subtitle">${title}</div>

  <div class="meta-grid">
    <div class="card">
      <div class="row"><span class="label">公司</span><span>${txt(co.company_name)}</span></div>
      <div class="row"><span class="label">地址</span><span>${txt(co.address)}</span></div>
      <div class="row"><span class="label">電話</span><span>${txt(co.phone)}</span></div>
      <div class="row"><span class="label">稅號</span><span>${txt((co as any).tax_id)}</span></div>
    </div>
    <div class="card">
      <div class="row"><span class="label">發票號</span><span class="mono">${txt(data.invoice_no)}</span></div>
      <div class="row"><span class="label">發票日期</span><span>${formatDate(data.invoice_date)}</span></div>
      <div class="row"><span class="label">對象</span><span>${txt(data.party_name)}</span></div>
      <div class="row"><span class="label">幣別</span><span>${txt(data.currency) || 'VND'}</span></div>
      <div class="row"><span class="label">狀態</span><span>${txt(data.status)}</span></div>
      <div class="row"><span class="label">驗證碼</span><span class="mono">${txt(data.verification_code)}</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:38px">#</th>
        <th style="width:86px">PO NO</th>
        <th style="width:78px">MTL NO</th>
        <th>DESCRIPTION</th>
        <th style="width:56px">UNIT</th>
        <th style="width:66px">QTY</th>
        <th style="width:82px">UNIT PRICE</th>
        <th style="width:92px">AMOUNT</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="summary">
    <div class="summary-row"><span>Subtotal</span><span>${money(data.total_amount)}</span></div>
    <div class="summary-row"><span>Tax ${num(data.tax_rate)}%</span><span>${money(data.tax_amount)}</span></div>
    <div class="summary-row"><span>Grand Total</span><span>${money(data.grand_total)}</span></div>
  </div>

  <div class="note"><b>備註 Remark:</b> ${txt(data.remark)}<br/><b>QR Payload:</b> ${txt(data.qr_payload)}</div>

  <div class="sign-grid">
    <div class="sign-box">
      <div class="sign-title">${invoiceType === 'supplier' ? '供應商簽章' : '客戶簽章'}</div>
      <div class="sign-line">${txt(data.party_name)}</div>
    </div>
    <div class="sign-box">
      <div class="sign-title">我方確認</div>
      <div class="sign-img-wrap">${signatureUrl ? `<img src="${signatureUrl}" style="max-height:30px;max-width:120px;object-fit:contain"/>` : ''}</div>
      <div class="sign-line">${txt(co.contact_person || co.company_name)}</div>
    </div>
  </div>
</div>
</body>
</html>`
}
