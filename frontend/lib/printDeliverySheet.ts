import { type CompanySettings } from './useCompany'
import { cleanText, formatDate, formatQty, toNum } from './printUtils'

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
<style>
*{box-sizing:border-box}
body{font-family:"PingFang TC","Noto Sans TC","Microsoft JhengHei",Arial,sans-serif;font-size:11px;color:#111;margin:0;background:#fff}
.page{width:210mm;min-height:297mm;padding:10mm;margin:0 auto}
.title{font-size:40px;font-weight:800;text-align:center;line-height:1.05}
.sub{font-size:14px;text-align:center;font-weight:700;margin-top:2px}
.head{display:flex;justify-content:space-between;align-items:flex-start;margin-top:8px}
.left{font-size:11px;line-height:1.45}
.right{font-size:11px;line-height:1.5;text-align:right}
.mono{font-family:Consolas,Menlo,monospace}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{border:1px solid #333;padding:5px;vertical-align:middle}
th{background:#f2f2f2;text-align:center;font-size:10px}
.c{text-align:center}
.r{text-align:right}
.note{margin-top:8px;border:1px solid #333;padding:6px 8px;min-height:36px;line-height:1.45}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:12mm}
.box{border:1px solid #333;min-height:82px;padding:6px;text-align:center}
.box .t{font-weight:700}
.box .line{margin-top:52px;border-top:1px solid #333;padding-top:4px;font-size:10px}
@media print{@page{size:A4;margin:0}body{margin:0}}
</style>
</head>
<body>
<div class="page">
  <div class="title">PHIẾU GIAO HÀNG</div>
  <div class="sub">送貨單 / DELIVERY SHEET</div>

  <div class="head">
    <div class="left">
      <div><b>Địa điểm nhận hàng:</b> ${txt(data.customer_name)}</div>
      <div><b>Công ty giao hàng:</b> ${txt(co.company_name)}</div>
      <div><b>Địa chỉ:</b> ${txt(data.address || co.address)}</div>
      <div><b>Điện thoại:</b> ${txt(co.phone)}</div>
    </div>
    <div class="right">
      <div><b>Số phiếu / No:</b> <span class="mono">${txt(data.dn_number)}</span></div>
      <div><b>Ngày:</b> ${formatDate(data.delivery_date)}</div>
      <div><b>Mã số Cty giao hàng:</b> 2211</div>
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
        <td colspan="3" class="r"><b>Total</b></td>
        <td class="c"><b>${fmt(totalQty)}</b></td>
        <td></td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <div class="note"><b>Ghi chú / 備註:</b> ${txt(data.remark)}</div>

  <div class="sign">
    <div class="box">
      <div class="t">Người nhận hàng</div>
      <div class="line">${txt(data.customer_name)}</div>
    </div>
    <div class="box">
      <div class="t">Người giao hàng</div>
      <div style="height:34px;display:flex;align-items:center;justify-content:center">${signatureUrl ? `<img src="${signatureUrl}" style="max-height:30px;max-width:120px;object-fit:contain"/>` : ''}</div>
      <div class="line">${txt(co.contact_person || co.company_name)}</div>
    </div>
  </div>
</div>
</body>
</html>`
}
