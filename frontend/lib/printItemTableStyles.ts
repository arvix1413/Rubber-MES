/**
 * 打印明細表共用樣式。
 * - 表頭：完整顯示（pre-line），不省略。
 * - 數字格：單行不換行，列寬隨內容撐開（table-layout:auto + width:1%），PDF 不出現省略號。
 */

/** 表頭：全局不省略，雙語標題用換行 */
export const SHARED_PRINT_TABLE_HEADER_CSS = `
  table.items th {
    max-width:none !important;
    white-space:pre-line !important;
    overflow:visible !important;
    overflow-wrap:normal !important;
    word-break:keep-all !important;
    text-overflow:clip !important;
    line-height:1.25;
    vertical-align:middle;
    padding:5px 4px;
  }
`

/** 數字/序號/單位：不換行，列寬隨內容自增（不用 ellipsis） */
export const SHARED_PRINT_NUMERIC_CELL_CSS = `
  table.items :is(td,th).col-st,
  table.items :is(td,th).col-unit,
  table.items :is(td,th).col-qty,
  table.items :is(td,th).col-price,
  table.items :is(td,th).col-amt,
  table.items :is(td,th).col-total,
  table.items :is(td,th).col-moq,
  table.items.quote-items :is(td,th).col-remark {
    width:1%;
    white-space:nowrap;
    overflow:visible !important;
    overflow-wrap:normal !important;
    word-break:keep-all !important;
    text-overflow:clip !important;
    font-variant-numeric:tabular-nums;
    vertical-align:middle;
  }

  table.items th.col-st,
  table.items th.col-unit,
  table.items th.col-qty,
  table.items th.col-price,
  table.items th.col-amt,
  table.items th.col-total,
  table.items th.col-moq,
  table.items.quote-items th.col-remark {
    white-space:pre-line !important;
  }

  table.items td.col-moq {
    white-space:normal !important;
  }

  table.items .print-num-stack {
    display:inline-block;
    max-width:none;
    overflow:visible;
    vertical-align:middle;
  }

  table.items .print-num-line {
    display:block;
    width:max-content;
    max-width:none;
    white-space:nowrap !important;
    overflow:visible !important;
    overflow-wrap:normal !important;
    word-break:keep-all !important;
    text-overflow:clip !important;
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
    overflow:visible !important;
    overflow-wrap:normal !important;
    word-break:keep-all !important;
    text-overflow:clip !important;
    font-variant-numeric:tabular-nums;
  }

  .summary-right .sum-row > span:last-child {
    flex:0 1 auto;
    min-width:0;
    text-align:right;
  }
`

export const SHARED_PRINT_ITEM_TABLE_CSS = `
  table.items{width:100%;border-collapse:collapse;table-layout:auto;margin-bottom:5mm}
  table.items th{border:1px solid #555;background:#e8e8e8;text-align:center;font-size:10px;font-weight:600;color:#000}
  table.items td{border:1px solid #bbb;padding:5px 6px;font-size:11px;font-weight:400;color:#000;white-space:normal;overflow:visible;overflow-wrap:anywhere;word-break:break-word;vertical-align:top;text-align:center;line-height:1.3}
  table.items tbody tr:nth-child(even){background:#fafafa}

  ${SHARED_PRINT_TABLE_HEADER_CSS}
  ${SHARED_PRINT_NUMERIC_CELL_CSS}
  ${SHARED_PRINT_NUMERIC_MISC_CSS}

  table.items .col-st{font-size:10px}
  table.items .col-code{font-size:10px;min-width:8%}
  table.items .col-material{font-size:10px;min-width:7%}
  table.items .col-spec{font-size:10px;line-height:1.25;min-width:7%}
  table.items .col-unit{font-size:10px}
  table.items .col-qty{font-size:10px}
  table.items .col-price{font-size:10px}
  table.items .col-amt{font-size:10px}
  table.items .col-total{font-size:10px}
  table.items .col-moq{font-size:10px}

  table.items .col-name{line-height:1.25;min-width:12%}
  table.items .col-remark{min-width:8%}

  table.items .total-row td{border:1px solid #555;background:#efefef;font-weight:600;font-size:10px;padding:6px 8px}
  table.items .total-row .total-label{text-align:right;white-space:nowrap !important;overflow:visible !important;text-overflow:clip !important}
`

/** 報價單：文字列給最小寬度，數字列隨內容撐開 */
export const SHARED_PRINT_QUOTATION_ITEM_TABLE_CSS = `
  table.items.quote-items .col-name{min-width:14%;line-height:1.25}
  table.items.quote-items .col-spec{min-width:6%}
  table.items.quote-items .col-color{min-width:5%;font-size:10px}
  table.items.quote-items .col-unit{font-size:10px}
  table.items.quote-items .col-moq{font-size:9.5px}
  table.items.quote-items .col-price{font-size:10px}
  table.items.quote-items .col-amt{font-size:10px}
  table.items.quote-items .col-remark{font-size:10px}
  table.items.quote-items td{min-height:28px}
`

/** MOQ 多檔：每檔單行不換行，檔與檔之間換行 */
export function htmlPrintNumericStack(lines: string[], escape: (line: string) => string): string {
  if (!lines.length) return ''
  const inner = lines.map((line) => `<span class="print-num-line">${escape(line)}</span>`).join('')
  return `<div class="print-num-stack">${inner}</div>`
}
