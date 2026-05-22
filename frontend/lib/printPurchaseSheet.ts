import { type CompanySettings } from './useCompany'
import { SHARED_PRINT_ITEM_TABLE_CSS } from './printItemTableStyles'
import { SHARED_PRINT_PARTY_TABLE_CSS } from './printPartyTableStyles'
import { formatDateYMD } from './datetime'
import { formatDecimal, formatQuantity } from './numberFormat'
import { getPrintSignatureConfig } from './printSignature'

export function generatePurchaseSheetHTML(data: any, signatureUrl?: string, company?: CompanySettings): string {
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
  const fmtQty = (v: any) => formatQuantity(num(v))
  const fmtMoney = (v: any) => formatDecimal(num(v))
  const fmtText = (v: any) => txt(v).replace(/\n/g, '<br/>')
  const splitPoRefs = (v: any) => txt(v)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  const summarizePoRef = (v: any) => {
    const refs = splitPoRefs(v)
    if (!refs.length) return txt(data.po_number)
    if (refs.length <= 2) return refs.join(', ')
    return `${refs.slice(0, 2).join(', ')} 等 ${refs.length} 筆`
  }

  const co = company || {
    company_name: 'KUN YI COMPANY LIMITED',
    company_name_local: '',
    address: '',
    phone: '',
    contact_person: '',
    logo_url: null,
  }
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://43.160.199.226:10102'
  const logoUrl = co.logo_url ? (String(co.logo_url).startsWith('http') ? co.logo_url : `${API_BASE}${co.logo_url}`) : null
  const signatureConfig = getPrintSignatureConfig(co)

  const items: any[] = Array.isArray(data.items) ? data.items : []
  const allPoRefs = Array.from(new Set(items.flatMap((item: any) => splitPoRefs(item.po_ref || data.po_number))))
  const taxRate = Math.max(0, num((data as any).tax_rate || 0))
  const subTotal = items.reduce((s: number, i: any) => s + num(i.total_price), 0)
  const taxAmount = Math.round(subTotal * (taxRate / 100) * 100) / 100
  const grandTotal = subTotal + taxAmount

  const rows = items.map((item: any, idx: number) => `
      <tr>
        <td class="col-st" style="text-align:center">${idx + 1}</td>
        <td class="col-code">${txt(summarizePoRef(item.po_ref || data.po_number))}</td>
        <td class="col-material">${txt(item.material_code)}</td>
        <td class="col-name">${txt(item.material_name)}</td>
        <td class="col-spec">${txt(item.spec)}</td>
        <td class="col-qty">${fmtQty(item.quantity)}</td>
        <td class="col-unit">${txt(item.unit) || 'PCS'}</td>
        <td class="col-price">${fmtMoney(item.unit_price)}</td>
        <td class="col-total">${fmtMoney(item.total_price)}</td>
        <td class="col-remark">${fmtText(item.remark)}</td>
      </tr>
    `).join('')

  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Microsoft JhengHei", "PingFang TC", Arial, sans-serif; font-size: 11px; font-weight: 400; color: #000; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 8mm 6mm; max-width: 210mm; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 5mm; margin-bottom: 5mm; }
    .company { font-size: 18px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
    .subtitle { font-size: 10px; color: #666; margin-top: 3px; }
    .doc-title { font-size: 22px; font-weight: 700; color: #1a56db; letter-spacing: 2px; text-align: right; }
    .doc-sub { font-size: 10px; color: #666; text-align: right; margin-top: 2px; }
    .doc-no { font-size: 12px; font-weight: 600; text-align: right; margin-top: 3px; }
    ${SHARED_PRINT_PARTY_TABLE_CSS}
	    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
	    .info-table td { border: 1px solid #bbb; padding: 5px 8px; font-size: 11px; font-weight: 400; vertical-align: middle; text-align: center; }
	    .info-table .lbl { font-weight: 600; background: #f5f5f5; white-space: nowrap; width: 110px; color: #333; line-height: 1.4; }
	    ${SHARED_PRINT_ITEM_TABLE_CSS}
      .po-ref-box { border: 1px solid #bbb; padding: 6px 8px; margin-bottom: 4mm; }
      .po-ref-title { font-size: 10px; font-weight: 600; color: #333; margin-bottom: 4px; }
      .po-ref-list { font-size: 10px; line-height: 1.55; color: #222; word-break: break-word; }
      table.items.po-items .col-code { min-width: 12%; font-size: 9px; }
      table.items.po-items .col-material { min-width: 6%; font-size: 10px; }
      table.items.po-items .col-name { min-width: 10%; font-size: 9px; line-height: 1.25; }
      table.items.po-items .col-spec { min-width: 6%; font-size: 9px; line-height: 1.25; }
      table.items.po-items .col-qty { font-size: 10px; }
      table.items.po-items .col-unit { font-size: 9px; }
      table.items.po-items .col-price { font-size: 9px; }
      table.items.po-items .col-total { font-size: 9px; }
      table.items.po-items .col-remark { min-width: 12%; font-size: 9px; line-height: 1.25; }
      .po-items .total-label { text-align: right; padding-right: 10px; }
      .po-items .total-value { font-size: 10px; text-align: right; }
	    .remark-box { border: 1px solid #bbb; padding: 6px 10px; min-height: 18mm; font-size: 10px; font-weight: 400; margin-top: 5mm; }
	    .remark-title { font-weight: 600; margin-bottom: 4px; font-size: 10px; }
	    .terms { border: 1px solid #ccc; padding: 6px 10px; margin-top: 4mm; font-size: 9px; font-weight: 400; line-height: 1.5; color: #555; }
    .sign-section { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-top: 8mm; }
    .sign-box { border: 1px solid #bbb; padding: 8px 10px; text-align: center; display: flex; flex-direction: column; }
    .sign-label { font-weight: 600; font-size: 10px; color: #333; padding-bottom: 4px; border-bottom: 1px solid #eee; margin-bottom: 0; }
    .sign-area { flex: 1; min-height: ${signatureConfig.areaMinHeight}px; display: flex; align-items: center; justify-content: center; }
    .sign-line { border-top: 1px solid #555; padding-top: 4px; font-size: 10px; font-weight: 400; color: #333; margin-top: 4px; }
    @media print { @page { size: A4; margin: 0; } }
  `

  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"/><title>採購單 ${txt(data.po_number)}</title><style>${css}</style></head><body>
    <div class="page">
      <div class="header">
        <div>
          ${logoUrl ? `<img src="${logoUrl}" style="max-height:40px;max-width:160px;object-fit:contain;margin-bottom:4px" onerror="this.style.display='none'"/><br/>` : ''}
          <div class="company">${txt(co.company_name)}</div>
          <div class="subtitle">${txt(co.company_name_local)}</div>
        </div>
        <div>
          <div class="doc-title">採購單</div>
          <div class="doc-sub">PURCHASE ORDER / ĐƠN ĐẶT HÀNG</div>
          <div class="doc-no">No. ${txt(data.po_number)}</div>
        </div>
      </div>

      <table class="party-table">
        <tr><td class="section" colspan="4">本公司 / Company Name</td><td class="section" colspan="4">供應商公司 / Supplier Name</td></tr>
        <tr><td class="label">公司名</td><td class="value" colspan="3">${txt(co.company_name)}</td><td class="label">公司名</td><td class="value" colspan="3">${txt(data.supplier_name)}</td></tr>
        <tr><td class="label">地址</td><td class="value" colspan="3">${txt(co.address)}</td><td class="label">地址</td><td class="value" colspan="3">${txt((data as any).supplier_address)}</td></tr>
        <tr><td class="label">電話</td><td class="value" colspan="3">${txt(co.phone)}</td><td class="label">電話</td><td class="value" colspan="3">${txt((data as any).supplier_phone)}</td></tr>
        <tr><td class="label">聯絡人</td><td class="value" colspan="3">${txt(co.contact_person)}</td><td class="label">聯絡人</td><td class="value" colspan="3">${txt((data as any).supplier_contact)}</td></tr>
      </table>

	      <table class="info-table">
        <tr>
          <td class="lbl">供應商</td><td class="val" colspan="3" style="font-weight:600;font-size:12px">${txt(data.supplier_name)}</td>
          <td class="lbl">採購單號</td><td class="val" style="font-family:monospace;font-weight:600">${txt(data.po_number)}</td>
        </tr>
        <tr>
          <td class="lbl">幣別</td><td class="val">${txt(data.currency) || 'VND'}</td>
          <td class="lbl">稅率</td><td class="val">${taxRate}%</td>
          <td class="lbl">建立日期</td><td class="val">${txt(formatDateYMD(data.created_at || ''))}</td>
	        </tr>
	      </table>

        <div class="po-ref-box">
          <div class="po-ref-title">來源客戶單 / PO NO 摘要</div>
          <div class="po-ref-list">${allPoRefs.length ? allPoRefs.map((ref) => txt(ref)).join(' / ') : txt(data.po_number)}</div>
        </div>

	      <table class="items po-items">
	        <thead><tr>
	          <th class="col-st">ST</th><th class="col-code">PO NO</th><th class="col-material">MTL NO</th><th class="col-name">材料名稱</th><th class="col-spec">規格</th><th class="col-qty">數量</th><th class="col-unit">單位</th><th class="col-price">單價</th><th class="col-total">金額</th><th class="col-remark">備註</th>
	        </tr></thead>
        <tbody>
          ${rows}
          <tr class="total-row"><td colspan="9" class="total-label">小計</td><td class="total-value">${fmtMoney(subTotal)}</td></tr>
          <tr class="total-row"><td colspan="9" class="total-label">VAT ${taxRate}%</td><td class="total-value">${fmtMoney(taxAmount)}</td></tr>
          <tr class="total-row"><td colspan="9" class="total-label">總計</td><td class="total-value">${fmtMoney(grandTotal)}</td></tr>
        </tbody>
      </table>

      <div class="remark-box"><div class="remark-title">備註：</div><div>${fmtText(data.remark)}</div></div>
      <div class="terms"><strong>注意事項：</strong> 付款條件依據合同；交期以實際通知為準；單價未含稅除非另有說明。</div>

      <div class="sign-section">
        <div class="sign-box"><div class="sign-label">供應商確認</div><div class="sign-area"></div><div class="sign-line">${txt(data.supplier_name)}</div></div>
        <div class="sign-box"><div class="sign-label">採購確認</div><div class="sign-area">${signatureUrl ? `<img src="${signatureUrl}" style="${signatureConfig.imgStyle}"/>` : ''}</div><div class="sign-line">${txt(co.company_name)}</div></div>
      </div>
    </div>
  </body></html>`
}
