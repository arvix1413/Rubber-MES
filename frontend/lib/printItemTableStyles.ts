/**
 * 打印明細表共用樣式。
 * 數字列：單行不換行 + table-layout:fixed 下不撐破格線（max-width:0 + overflow:hidden）。
 */

/** 表格內數字/序號/單位等緊湊欄位（th/td） */
export const SHARED_PRINT_NUMERIC_CELL_CSS = `
  table.items :is(th,td).col-st,
  table.items :is(th,td).col-unit,
  table.items :is(th,td).col-qty,
  table.items :is(th,td).col-price,
  table.items :is(th,td).col-amt,
  table.items :is(th,td).col-total,
  table.items :is(th,td).col-moq,
  table.items.quote-items :is(th,td).col-remark {
    max-width:0;
    white-space:nowrap !important;
    overflow:hidden !important;
    overflow-wrap:normal !important;
    word-break:keep-all !important;
    text-overflow:ellipsis;
    font-variant-numeric:tabular-nums;
    vertical-align:middle;
  }

  table.items :is(td).col-moq {
    white-space:normal !important;
  }

  table.items .print-num-stack {
    display:flex;
    flex-direction:column;
    align-items:stretch;
    gap:2px;
    width:100%;
    max-width:100%;
    overflow:hidden;
  }

  table.items .print-num-line {
    display:block;
    width:100%;
    max-width:100%;
    white-space:nowrap !important;
    overflow:hidden !important;
    overflow-wrap:normal !important;
    word-break:keep-all !important;
    text-overflow:ellipsis;
    font-variant-numeric:tabular-nums;
    line-height:1.35;
  }
`

/** 表尾小計、右側摘要等表格外數字 */
export const SHARED_PRINT_NUMERIC_MISC_CSS = `
  .print-num,
  table.items .total-value,
  table.items .total-row td:not(.total-label),
  .summary-right .sum-row > span:last-child {
    white-space:nowrap !important;
    overflow:hidden !important;
    overflow-wrap:normal !important;
    word-break:keep-all !important;
    text-overflow:ellipsis;
    font-variant-numeric:tabular-nums;
    max-width:100%;
  }

  .summary-right .sum-row > span:last-child {
    flex:1;
    min-width:0;
    text-align:right;
  }
`

export const SHARED_PRINT_ITEM_TABLE_CSS = `
  table.items{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:5mm}
  table.items th{border:1px solid #555;background:#e8e8e8;padding:6px 6px;text-align:center;font-size:10px;font-weight:600;color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  table.items td{border:1px solid #bbb;padding:5px 6px;font-size:11px;font-weight:400;color:#000;white-space:normal;overflow:hidden;overflow-wrap:anywhere;word-break:break-word;vertical-align:top;text-align:center;line-height:1.3}
  table.items tbody tr:nth-child(even){background:#fafafa}

  ${SHARED_PRINT_NUMERIC_CELL_CSS}
  ${SHARED_PRINT_NUMERIC_MISC_CSS}

  table.items .col-st{width:4%;font-size:10px}
  table.items .col-code{width:12%;white-space:normal !important;overflow-wrap:anywhere !important;word-break:break-word !important;font-size:10px;max-width:none}
  table.items .col-material{width:10%;white-space:normal !important;overflow-wrap:anywhere !important;word-break:break-word !important;font-size:10px;max-width:none}
  table.items .col-spec{width:10%;white-space:normal !important;overflow-wrap:anywhere !important;word-break:break-word !important;font-size:10px;line-height:1.25;max-width:none}
  table.items .col-unit{width:7%;font-size:10px}
  table.items .col-qty{width:8%;font-size:10px}
  table.items .col-price{width:10%;font-size:10px}
  table.items .col-amt{width:10%;font-size:10px}
  table.items .col-total{width:10%;font-size:10px}
  table.items .col-moq{width:8%;font-size:10px}

  table.items .col-name{width:auto;white-space:normal !important;overflow-wrap:anywhere !important;word-break:break-word !important;line-height:1.25;max-width:none}
  table.items .col-remark{white-space:normal !important;overflow-wrap:anywhere !important;word-break:break-word !important;max-width:none}

  table.items .total-row td{border:1px solid #555;background:#efefef;font-weight:600;font-size:10px;padding:6px 8px}
  table.items .total-row .total-label{white-space:nowrap !important;overflow:hidden;text-overflow:ellipsis;max-width:none;text-align:right}
`

/** 報價單明細表：僅覆寫列寬；數字列規則沿用 SHARED_PRINT_NUMERIC_* */
export const SHARED_PRINT_QUOTATION_ITEM_TABLE_CSS = `
  table.items.quote-items .col-st{width:4%}
  table.items.quote-items .col-name{width:30%;white-space:normal !important;overflow-wrap:anywhere !important;word-break:break-word !important;line-height:1.25;max-width:none}
  table.items.quote-items .col-spec{width:9%;max-width:none}
  table.items.quote-items .col-color{width:7%;white-space:normal !important;overflow-wrap:anywhere !important;word-break:break-word !important;font-size:10px;max-width:none}
  table.items.quote-items .col-unit{width:5%;font-size:10px}
  table.items.quote-items .col-moq{width:14%;font-size:9.5px}
  table.items.quote-items .col-price{width:8%;font-size:10px}
  table.items.quote-items .col-amt{width:9%;font-size:10px}
  table.items.quote-items .col-remark{width:14%;font-size:10px}

  table.items.quote-items th{white-space:pre-line;line-height:1.25;max-width:none}
  table.items.quote-items th.col-st,
  table.items.quote-items th.col-unit,
  table.items.quote-items th.col-moq,
  table.items.quote-items th.col-price,
  table.items.quote-items th.col-amt,
  table.items.quote-items th.col-remark {
    max-width:0;
    overflow:hidden;
  }
  table.items.quote-items td{min-height:28px}
`

/** MOQ 多檔：每檔單行不換行，檔與檔之間換行 */
export function htmlPrintNumericStack(lines: string[], escape: (line: string) => string): string {
  if (!lines.length) return ''
  const inner = lines.map((line) => `<span class="print-num-line">${escape(line)}</span>`).join('')
  return `<div class="print-num-stack">${inner}</div>`
}
