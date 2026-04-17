import { type CompanySettings } from './useCompany'
import { buildPrintStyles, cleanText, formatDate, formatMoney, formatQty, toNum } from './printUtils'

export function generatePurchaseSheetHTML(data: any, signatureUrl?: string, company?: CompanySettings): string {
  const txt = cleanText
  const num = toNum
  const money = formatMoney
  const qty = formatQty

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
<style>${buildPrintStyles()}</style>
</head>
<body>
<div class="page">
  <div class="title">採購單</div>
  <div class="subtitle">PURCHASE SHEET</div>
  <div class="meta-grid">
    <div class="card">
      <div class="row"><span class="label">公司名稱</span><span>${txt(co.company_name)}</span></div>
      <div class="row"><span class="label">地址</span><span>${txt(co.address)}</span></div>
      <div class="row"><span class="label">電話</span><span>${txt(co.phone)}</span></div>
      <div class="row"><span class="label">聯絡人</span><span>${txt(co.contact_person)}</span></div>
      <div class="row"><span class="label">稅號</span><span>${txt((co as any).tax_id)}</span></div>
    </div>
    <div class="card">
      <div class="row"><span class="label">採購號碼</span><span class="mono">${txt(data.po_number)}</span></div>
      <div class="row"><span class="label">採購日期</span><span>${formatDate(data.created_at)}</span></div>
      <div class="row"><span class="label">供應商</span><span>${txt(data.supplier_name)}</span></div>
      <div class="row"><span class="label">聯絡人</span><span>${txt((data as any).supplier_contact || '')}</span></div>
      <div class="row"><span class="label">幣別 / 稅率</span><span>${txt(data.currency || 'VND')} / ${taxRate}%</span></div>
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

  <div class="summary">
    <div class="summary-row"><span>Total</span><span>${money(subTotal)}</span></div>
    <div class="summary-row"><span>VAT ${taxRate}%</span><span>${money(taxAmount)}</span></div>
    <div class="summary-row"><span>總金額 VND</span><span>${money(grandTotal)}</span></div>
  </div>

  <div class="note">
    <div><b>備註 Remark</b></div>
    <div>1. 付款條件依據合同。The payment way according by sales contract.</div>
    <div>2. 交貨日期：三天。Good finish within 3 days.</div>
    <div>3. 交貨方式：越南胡志明本地 Ex-Work.</div>
    <div>4. 單價不含 VAT。Price not include VAT.</div>
    <div>5. 任合問題根據合同上的效法討論。</div>
    <div style="margin-top:4px">${txt(data.remark)}</div>
  </div>

  <div class="sign-grid">
    <div class="sign-box">
      <div class="sign-title">供應商確認</div>
      <div class="sign-line">${txt(data.supplier_name)}</div>
    </div>
    <div class="sign-box">
      <div class="sign-title">採購確認</div>
      <div class="sign-img-wrap">${signatureUrl ? `<img src="${signatureUrl}" style="max-height:30px;max-width:120px;object-fit:contain"/>` : ''}</div>
      <div class="sign-line">${txt(co.company_name)}</div>
    </div>
  </div>
</div>
</body>
</html>`
}
