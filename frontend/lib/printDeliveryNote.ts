import { type CompanySettings } from './useCompany'
import { SHARED_PRINT_ITEM_TABLE_CSS } from './printItemTableStyles'
import { formatQuantity } from './numberFormat'
import { getPrintSignatureConfig } from './printSignature'

export function generateDeliveryNoteHTML(data: any, signatureUrl?: string, company?: CompanySettings): string {
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
  const fmt = (v: any) => formatQuantity(num(v))

  const co = company || {
    company_name: 'CÔNG TY TNHH ĐÔNG PHƯƠNG VŨNG TÀU (TO2)',
    company_name_local: '',
    address: '',
    phone: '',
    contact_person: '',
    logo_url: null,
  }
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://43.133.56.234:10102'
  const logoUrl = co.logo_url ? (String(co.logo_url).startsWith('http') ? co.logo_url : `${API_BASE}${co.logo_url}`) : null
  const signatureConfig = getPrintSignatureConfig(co)
  const items: any[] = Array.isArray(data.items) ? data.items : []
  const orderRef = txt(data.po_ref || data.order_po_number || '')
  const totalQty = items.reduce((s: number, i: any) => s + num(i.qty), 0)

  const itemRows = items.map((item: any, i: number) => {
    return `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td class="col-material">${txt(item.material_code)}</td>
        <td class="col-name">${txt(item.item_name)}</td>
        <td class="col-spec">${txt(item.spec)}</td>
        <td class="col-unit" style="text-align:center">${txt(item.unit) || 'PCS'}</td>
        <td class="col-qty">${fmt(item.qty)}</td>
        <td class="col-remark">${txt(item.remark)}</td>
      </tr>
    `
  }).join('')

  const css = `
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:"Microsoft JhengHei","PingFang TC",Arial,sans-serif;font-size:11px;font-weight:400;color:#000;padding:8mm 6mm;background:#fff;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:5mm;margin-bottom:5mm}
    .company{font-size:18px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
    .subtitle{font-size:10px;color:#666;margin-top:3px}
    .doc-title{font-size:22px;font-weight:700;color:#1a56db;text-align:right}
    .doc-sub{font-size:10px;color:#666;text-align:right;margin-top:2px}
    .doc-no{font-size:12px;font-weight:600;text-align:right;margin-top:3px}
    .info-table{width:100%;border-collapse:collapse;margin-bottom:5mm}
    .info-table td{border:1px solid #bbb;padding:5px 8px;font-size:11px;font-weight:400;vertical-align:middle;text-align:center}
    .info-table .lbl{font-weight:600;background:#f5f5f5;white-space:nowrap;width:110px;color:#333}
    ${SHARED_PRINT_ITEM_TABLE_CSS}
    .notes-box{border:1px solid #bbb;padding:6px 10px;margin-bottom:5mm;font-size:10px;font-weight:400}
    .notes-title{font-weight:600;margin-bottom:3px;font-size:10px}
    .footer{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:8mm}
    .sign-box{border:1px solid #bbb;padding:8px 10px;text-align:center;display:flex;flex-direction:column}
    .sign-label{font-weight:600;font-size:10px;color:#333;padding-bottom:4px;border-bottom:1px solid #eee}
    .sign-area{flex:1;min-height:${signatureConfig.areaMinHeight}px;display:flex;align-items:center;justify-content:center}
    .sign-line{border-top:1px solid #555;padding-top:4px;font-size:10px;font-weight:400;color:#333;margin-top:4px}
    @media print{@page{size:A4;margin:0}}
  `

  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"/><title>出貨單 ${txt(data.dn_number)}</title><style>${css}</style></head><body>
    <div class="header">
      <div>
        ${logoUrl ? `<img src="${logoUrl}" style="max-height:40px;max-width:160px;object-fit:contain;margin-bottom:4px" onerror="this.style.display='none'"/><br/>` : ''}
        <div class="company">${txt(co.company_name)}</div>
        <div class="subtitle">${txt(co.company_name_local)}</div>
      </div>
      <div>
        <div class="doc-title">出貨單</div>
        <div class="doc-sub">DELIVERY NOTE / PHIẾU GIAO HÀNG</div>
        <div class="doc-no">No. ${txt(data.dn_number)}</div>
      </div>
    </div>

    <table class="info-table">
      <tr><td class="lbl">客戶</td><td style="font-weight:600;font-size:12px" colspan="3">${txt(data.customer_name)}</td><td class="lbl">出貨單號</td><td style="font-family:monospace;font-weight:600">${txt(data.dn_number)}</td></tr>
      <tr><td class="lbl">出貨日期</td><td>${txt(data.delivery_date)}</td><td class="lbl">訂單號</td><td colspan="3">${orderRef}</td></tr>
      ${data.address ? `<tr><td class="lbl">出貨地址</td><td colspan="5">${txt(data.address)}</td></tr>` : ''}
    </table>

    <table class="items">
      <thead><tr>
        <th style="width:28px">ST</th>
        <th class="col-material">物料編號</th>
        <th class="col-name">品名</th>
        <th class="col-spec">規格</th>
        <th class="col-unit">單位</th>
        <th class="col-qty">數量</th>
        <th class="col-remark">備註</th>
      </tr></thead>
      <tbody>
        ${itemRows}
        <tr class="total-row"><td colspan="5">總計</td><td>${fmt(totalQty)}</td><td></td></tr>
      </tbody>
    </table>

    ${data.remark ? `<div class="notes-box"><div class="notes-title">備註：</div><div>${txt(data.remark).replace(/\n/g, '<br/>')}</div></div>` : ''}

    <div class="footer">
      <div class="sign-box"><div class="sign-label">我方簽章</div><div class="sign-area">${signatureUrl ? `<img src="${signatureUrl}" style="${signatureConfig.imgStyle}"/>` : ''}</div><div class="sign-line">${txt(co.company_name)}</div></div>
      <div class="sign-box"><div class="sign-label">客戶簽收</div><div class="sign-area"></div><div class="sign-line">${txt(data.customer_name)}</div></div>
    </div>
  </body></html>`
}
