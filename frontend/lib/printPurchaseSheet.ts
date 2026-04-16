import { type CompanySettings } from './useCompany'

export function generatePurchaseSheetHTML(data: any, signatureUrl?: string, company?: CompanySettings): string {
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
  const money = (v: any) => num(v).toLocaleString()
  const qty = (v: any) => (Math.round(num(v) * 10000) / 10000).toLocaleString()

  const co = company || {
    company_name: 'KUN YI COMPANY LIMITED',
    company_name_local: '',
    address: '',
    phone: '',
    contact_person: '',
    tax_id: '',
    logo_url: null,
  }

  const taxRate = Math.max(0, Number(data.tax_rate || 0))
  const items: any[] = Array.isArray(data.items) ? data.items : []
  const subTotal = items.reduce((sum, i) => sum + num(i.total_price), 0)
  const taxAmount = Math.round(subTotal * (taxRate / 100) * 100) / 100
  const grandTotal = subTotal + taxAmount

  const colorOf = (name: string) => {
    const x = (name || '').toUpperCase()
    if (x.includes('BLACK')) return '黑'
    if (x.includes('WHITE')) return '白'
    if (x.includes('RED')) return '紅'
    if (x.includes('BLUE')) return '藍'
    if (x.includes('GREEN')) return '綠'
    return ''
  }

  const rows = items.map((item, idx) => {
    const n = txt(item.material_name)
    const thickness = txt(item.thickness)
    return `
      <tr>
        <td class="c">${idx + 1}</td>
        <td class="c">${txt(item.po_ref || data.po_number)}</td>
        <td class="c mono">${txt(item.material_code)}</td>
        <td>${n}</td>
        <td class="c">${colorOf(n)}</td>
        <td class="c">${txt(item.spec)}</td>
        <td class="c">${thickness}</td>
        <td class="c">${txt(item.unit) || 'SH'}</td>
        <td class="r">${qty(item.quantity)}</td>
        <td class="r">${money(item.unit_price)}</td>
        <td class="r">${money(item.total_price)}</td>
        <td>${txt(item.remark)}</td>
      </tr>
    `
  }).join('')

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<title>採購單 ${txt(data.po_number)}</title>
<style>
*{box-sizing:border-box}
body{font-family:Arial,"Microsoft JhengHei",sans-serif;font-size:11px;color:#111;margin:0;background:#fff}
.page{width:210mm;min-height:297mm;padding:10mm;margin:0 auto}
.h1{font-size:42px;font-weight:800;letter-spacing:.5px;text-align:center;line-height:1}
.h2{font-size:15px;font-weight:700;text-align:center;margin-top:3px}
.head{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.meta{border:1px solid #333;padding:6px 8px;line-height:1.45}
.lbl{display:inline-block;width:95px;color:#333;font-weight:700}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{border:1px solid #333;padding:4px 5px;vertical-align:middle}
th{background:#f3f3f3;text-align:center;font-size:10px}
.c{text-align:center}
.r{text-align:right}
.mono{font-family:Consolas,Menlo,monospace}
.sum{margin-top:6px;margin-left:auto;width:260px;border:1px solid #333}
.sum .row{display:flex;justify-content:space-between;padding:5px 8px;border-bottom:1px solid #ddd}
.sum .row:last-child{border-bottom:none;font-weight:800}
.notes{margin-top:8px;border:1px solid #333;padding:6px 8px;min-height:68px;line-height:1.4}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:12mm}
.box{border:1px solid #333;min-height:72px;padding:6px;text-align:center}
.box .t{font-weight:700;font-size:11px}
.box .line{margin-top:42px;border-top:1px solid #444;padding-top:4px;font-size:10px}
@media print{@page{size:A4;margin:0}body{margin:0}}
</style>
</head>
<body>
<div class="page">
  <div class="h1">採購單 PURCHASE SHEET</div>
  <div class="head">
    <div class="meta">
      <div><span class="lbl">公司名稱</span>${txt(co.company_name)}</div>
      <div><span class="lbl">地址</span>${txt(co.address)}</div>
      <div><span class="lbl">電話</span>${txt(co.phone)}</div>
      <div><span class="lbl">聯絡人</span>${txt(co.contact_person)}</div>
      <div><span class="lbl">稅號</span>${txt((co as any).tax_id)}</div>
    </div>
    <div class="meta">
      <div><span class="lbl">採購單號</span>${txt(data.po_number)}</div>
      <div><span class="lbl">建立日期</span>${txt(String(data.created_at || '').slice(0, 10))}</div>
      <div><span class="lbl">供應商</span>${txt(data.supplier_name)}</div>
      <div><span class="lbl">幣別</span>${txt(data.currency || 'VND')}</div>
      <div><span class="lbl">稅率</span>${taxRate}%</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:32px">項目</th>
        <th style="width:78px">PO NO</th>
        <th style="width:70px">MTL NO</th>
        <th>產品 Products</th>
        <th style="width:48px">顏色</th>
        <th style="width:88px">規格 Spec</th>
        <th style="width:56px">厚度 mm</th>
        <th style="width:42px">單位</th>
        <th style="width:56px">數量</th>
        <th style="width:76px">單價</th>
        <th style="width:86px">總價</th>
        <th style="width:70px">備註</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="sum">
    <div class="row"><span>Total</span><span>${money(subTotal)}</span></div>
    <div class="row"><span>VAT ${taxRate}%</span><span>${money(taxAmount)}</span></div>
    <div class="row"><span>總金額 VNC</span><span>${money(grandTotal)}</span></div>
  </div>

  <div class="notes">
    <div><b>備註 Remark</b></div>
    <div>1. 付款條件依據合同。The payment way according by sales contract.</div>
    <div>2. 交貨日期：三天。Good finish within 3 days.</div>
    <div>3. 交貨方式：越南胡志明本地 Ex-Work.</div>
    <div>4. 單價不含 VAT。Price not include VAT.</div>
    <div>5. 任合問題根據合同上的效法討論。</div>
    <div style="margin-top:4px">${txt(data.remark)}</div>
  </div>

  <div class="sign">
    <div class="box">
      <div class="t">供應商確認</div>
      <div class="line">${txt(data.supplier_name)}</div>
    </div>
    <div class="box">
      <div class="t">採購確認</div>
      <div style="height:40px;display:flex;align-items:center;justify-content:center">${signatureUrl ? `<img src="${signatureUrl}" style="max-height:36px;max-width:140px;object-fit:contain"/>` : ''}</div>
      <div class="line">${txt(co.company_name)}</div>
    </div>
  </div>
</div>
</body>
</html>`
}
