import { type CompanySettings } from './useCompany'

export function generateDeliveryNoteHTML(data: any, signatureUrl?: string, company?: CompanySettings): string {
  const txt = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = String(v).trim()
    if (!s || s === 'null' || s === 'undefined') return ''
    return s
  }
  const num = (v: any) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  const fmt = (v: any) => (Math.round(num(v) * 10000) / 10000).toLocaleString()

  const co = company || {
    company_name: 'CÔNG TY TNHH ĐÔNG PHƯƠNG VŨNG TÀU (TO2)',
    company_name_local: '',
    address: '',
    phone: '',
    contact_person: '',
    logo_url: null,
  }

  const items: any[] = Array.isArray(data.items) ? data.items : []
  const rows = items.map((item, idx) => `
    <tr>
      <td class="c">${idx + 1}</td>
      <td class="c mono">${txt(item.material_code)}</td>
      <td>${txt(item.item_name)}</td>
      <td class="c">${fmt(item.qty)}</td>
      <td class="c">${txt(item.unit) || 'SH'}</td>
      <td class="c mono">${txt(item.po_ref || data.po_ref || data.order_po_number)}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>PHIEU GIAO HANG ${txt(data.dn_number)}</title>
<style>
*{box-sizing:border-box}
body{font-family:Arial,"Microsoft JhengHei",sans-serif;font-size:11px;color:#111;margin:0;background:#fff}
.page{width:210mm;min-height:297mm;padding:10mm;margin:0 auto}
.title{font-size:42px;font-weight:800;text-align:center;line-height:1}
.meta{display:flex;justify-content:space-between;align-items:flex-start;margin-top:6px}
.left{font-size:11px;line-height:1.45}
.right{font-size:11px;line-height:1.5;text-align:right}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{border:1px solid #333;padding:5px}
th{background:#f2f2f2;text-align:center;font-size:10px}
.c{text-align:center}
.mono{font-family:Consolas,Menlo,monospace}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:12mm}
.box{border:1px solid #333;min-height:70px;padding:6px;text-align:center}
.box .t{font-weight:700}
.box .line{margin-top:40px;border-top:1px solid #333;padding-top:4px;font-size:10px}
@media print{@page{size:A4;margin:0}body{margin:0}}
</style>
</head>
<body>
<div class="page">
  <div class="title">PHIẾU GIAO HÀNG</div>
  <div class="meta">
    <div class="left">
      <div><b>Địa điểm nhận hàng:</b> ${txt(data.customer_name)}</div>
      <div><b>Công ty giao hàng:</b> ${txt(co.company_name)}</div>
      <div><b>Địa chỉ:</b> ${txt(data.address || co.address)}</div>
    </div>
    <div class="right">
      <div><b>Số phiếu/No:</b> <span class="mono">${txt(data.dn_number)}</span></div>
      <div><b>Năm/Tháng/Ngày:</b> ${txt(data.delivery_date)}</div>
      <div><b>Mã số Công Ty giao hàng:</b> 2211</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:42px">STT</th>
        <th style="width:80px">Mã số</th>
        <th>Tên vật liệu</th>
        <th style="width:80px">Số lượng</th>
        <th style="width:70px">Đơn vị</th>
        <th style="width:110px">Số đơn đặt hàng</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="sign">
    <div class="box">
      <div class="t">Người nhận hàng</div>
      <div class="line">${txt(data.customer_name)}</div>
    </div>
    <div class="box">
      <div class="t">Người giao hàng</div>
      <div style="height:38px;display:flex;align-items:center;justify-content:center">${signatureUrl ? `<img src="${signatureUrl}" style="max-height:34px;max-width:130px;object-fit:contain"/>` : ''}</div>
      <div class="line">${txt(co.contact_person || co.company_name)}</div>
    </div>
  </div>
</div>
</body>
</html>`
}
