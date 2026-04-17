import { type CompanySettings } from './useCompany'
import { cleanText, formatDate, formatMoney, formatQty, toNum } from './printUtils'

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

  const rows = items.map((item, idx) => {
    return `
      <tr>
        <td class="c">${idx + 1}</td>
        <td class="mono c">${txt(item.po_number)}</td>
        <td class="mono c">${txt(item.material_code)}</td>
        <td>${txt(item.material_name)}</td>
        <td class="c">${txt(item.unit) || 'PCS'}</td>
        <td class="r">${qty(item.qty)}</td>
        <td class="r">${money(item.unit_price)}</td>
        <td class="r">${money(item.amount)}</td>
      </tr>
    `
  }).join('')

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<title>Invoice ${txt(data.invoice_no)}</title>
<style>
*{box-sizing:border-box}
body{font-family:"PingFang TC","Noto Sans TC","Microsoft JhengHei",Arial,sans-serif;font-size:11px;color:#111;margin:0;background:#fff}
.page{width:210mm;min-height:297mm;padding:10mm;margin:0 auto}
.h1{font-size:36px;font-weight:800;text-align:center;line-height:1}
.h2{font-size:15px;font-weight:700;text-align:center;margin-top:3px}
.head{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.meta{border:1px solid #333;padding:6px 8px;line-height:1.45}
.lbl{display:inline-block;width:95px;color:#333;font-weight:700}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{border:1px solid #333;padding:5px;vertical-align:middle}
th{background:#f3f3f3;text-align:center;font-size:10px}
.c{text-align:center}
.r{text-align:right}
.mono{font-family:Consolas,Menlo,monospace}
.sum{margin-top:6px;margin-left:auto;width:300px;border:1px solid #333}
.sum .row{display:flex;justify-content:space-between;padding:5px 8px;border-bottom:1px solid #ddd}
.sum .row:last-child{border-bottom:none;font-weight:800}
.note{margin-top:8px;border:1px solid #333;padding:6px 8px;min-height:40px;line-height:1.4}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:12mm}
.box{border:1px solid #333;min-height:82px;padding:6px;text-align:center}
.box .t{font-weight:700}
.box .line{margin-top:52px;border-top:1px solid #333;padding-top:4px;font-size:10px}
@media print{@page{size:A4;margin:0}body{margin:0}}
</style>
</head>
<body>
<div class="page">
  <div class="h1">INVOICE</div>
  <div class="h2">${title}</div>

  <div class="head">
    <div class="meta">
      <div><span class="lbl">公司</span>${txt(co.company_name)}</div>
      <div><span class="lbl">地址</span>${txt(co.address)}</div>
      <div><span class="lbl">電話</span>${txt(co.phone)}</div>
      <div><span class="lbl">稅號</span>${txt((co as any).tax_id)}</div>
    </div>
    <div class="meta">
      <div><span class="lbl">發票號</span><span class="mono">${txt(data.invoice_no)}</span></div>
      <div><span class="lbl">發票日期</span>${formatDate(data.invoice_date)}</div>
      <div><span class="lbl">對象</span>${txt(data.party_name)}</div>
      <div><span class="lbl">幣別</span>${txt(data.currency) || 'VND'}</div>
      <div><span class="lbl">狀態</span>${txt(data.status)}</div>
      <div><span class="lbl">驗證碼</span><span class="mono">${txt(data.verification_code)}</span></div>
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

  <div class="sum">
    <div class="row"><span>Subtotal</span><span>${money(data.total_amount)}</span></div>
    <div class="row"><span>Tax ${num(data.tax_rate)}%</span><span>${money(data.tax_amount)}</span></div>
    <div class="row"><span>Grand Total</span><span>${money(data.grand_total)}</span></div>
  </div>

  <div class="note"><b>Remark:</b> ${txt(data.remark)}<br/><b>QR Payload:</b> ${txt(data.qr_payload)}</div>

  <div class="sign">
    <div class="box">
      <div class="t">${invoiceType === 'supplier' ? '供應商簽章' : '客戶簽章'}</div>
      <div class="line">${txt(data.party_name)}</div>
    </div>
    <div class="box">
      <div class="t">我方確認</div>
      <div style="height:34px;display:flex;align-items:center;justify-content:center">${signatureUrl ? `<img src="${signatureUrl}" style="max-height:30px;max-width:120px;object-fit:contain"/>` : ''}</div>
      <div class="line">${txt(co.contact_person || co.company_name)}</div>
    </div>
  </div>
</div>
</body>
</html>`
}
