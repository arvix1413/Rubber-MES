#!/usr/bin/env node
/**
 * Rubber-MES 每日巡查：检查 PRD 服务可用性，结果发到 Telegram
 *
 * 环境变量:
 *   RUBBER_FRONTEND_URL  默认 http://43.160.199.226:10101
 *   RUBBER_API_URL       默认 http://43.160.199.226:10102
 *   RUBBER_PATROL_EMAIL / RUBBER_PATROL_PASSWORD
 *   TELEGRAM_PATROL_BOT_TOKEN / TELEGRAM_BOT_TOKEN
 *   TELEGRAM_PATROL_CHAT_ID / TELEGRAM_CHAT_ID
 */
const FRONTEND = process.env.RUBBER_FRONTEND_URL || 'http://43.160.199.226:10101'
const API = process.env.RUBBER_API_URL || 'http://43.160.199.226:10102'
const EMAIL = process.env.RUBBER_PATROL_EMAIL || 'admin@rubber.local'
const PASSWORD = process.env.RUBBER_PATROL_PASSWORD || ''
const BOT_TOKEN = process.env.TELEGRAM_PATROL_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID = process.env.TELEGRAM_PATROL_CHAT_ID || process.env.TELEGRAM_CHAT_ID

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts)
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  return { ok: res.ok, status: res.status, data }
}

async function buildPatrolText() {
  const now = new Date()
  const tz = 'Asia/Taipei'
  const date = now.toLocaleDateString('zh-TW', { timeZone: tz })
  const time = now.toLocaleTimeString('zh-TW', { timeZone: tz, hour12: false })

  // 先簡單健康檢查，避免整個後端掛掉時報錯
  const root = await fetchJson(`${API}/`)
  if (!root.ok) {
    return [
      '【ERP 每日巡檢報告】',
      `巡檢日期：${date}`,
      `巡檢時間：${time}`,
      '',
      '後端服務目前無法連線或回應非 2xx 狀態，請盡快檢查 Rubber-MES PRD 服務狀態。',
      `API：${API}（HTTP ${root.status}）`,
    ].join('\n')
  }

  if (!PASSWORD) {
    return [
      '【ERP 每日巡檢報告】',
      `巡檢日期：${date}`,
      `巡檢時間：${time}`,
      '',
      '無法取得每日巡檢報告（未設定 RUBBER_PATROL_PASSWORD），請在 GitHub Secrets / 環境變數補齊登入資料。',
    ].join('\n')
  }

  // /api/daily-patrol-report 有 authMiddleware，需要先登录取 token
  const login = await fetchJson(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const token = login?.data?.token
  if (!login.ok || !token) {
    return [
      '【ERP 每日巡檢報告】',
      `巡檢日期：${date}`,
      `巡檢時間：${time}`,
      '',
      '無法取得每日巡檢報告（登入失敗），請檢查 RUBBER_PATROL_EMAIL / RUBBER_PATROL_PASSWORD。',
      `登入 HTTP 狀態：${login.status}`,
    ].join('\n')
  }

  const patrol = await fetchJson(`${API}/api/daily-patrol-report`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!patrol.ok) {
    return [
      '【ERP 每日巡檢報告】',
      `巡檢日期：${date}`,
      `巡檢時間：${time}`,
      '',
      '無法取得每日巡檢報告（/api/daily-patrol-report 呼叫失敗），請檢查後端日檢邏輯與資料庫狀態。',
      `HTTP 狀態：${patrol.status}`,
    ].join('\n')
  }

  const r = patrol.data || {}
  const severe = Array.isArray(r.severe) ? r.severe : []
  const needReview = Array.isArray(r.need_review) ? r.need_review : []
  const stuck = Array.isArray(r.stuck) ? r.stuck : []
  const consistency = Array.isArray(r.consistency) ? r.consistency : []
  const normals = Array.isArray(r.normals) ? r.normals : []
  const priorities = Array.isArray(r.priorities) ? r.priorities : []

  // 如果完全沒有異常，走客戶規格的「無異常」版本
  if (!severe.length && !needReview.length && !stuck.length && !consistency.some((c) => c && c.ok === false)) {
    return [
      '【ERP 每日巡檢報告】',
      `巡檢日期：${date}`,
      `巡檢時間：${time}`,
      '',
      '目前未發現嚴重異常。',
      '訂單、生產單、BOM、庫存、採購、出貨資料狀態正常。',
    ].join('\n')
  }

  const lines = []
  lines.push('【ERP 每日巡檢報告】')
  lines.push(`巡檢日期：${date}`)
  lines.push(`巡檢時間：${time}`)
  lines.push('')

  // 一、嚴重異常
  lines.push('一、嚴重異常')
  if (severe.length === 0) {
    lines.push('（本次未發現會直接影響訂單 / 生產 / 庫存 / 採購 / 出貨正確性的嚴重異常。）')
  } else {
    for (const item of severe) {
      lines.push('')
      lines.push(`* 問題類型：${item.type}`)
      lines.push(`* 相關單號 / 料號：${item.ref || '-'}`)
      lines.push(`* 異常原因：${item.reason || '-'}`)
      lines.push(`* 影響範圍：${item.impact || '-'}`)
      lines.push(`* 建議處理方式：${item.suggestion || '-'}`)
    }
  }

  // 二、需人工確認
  lines.push('')
  lines.push('二、需人工確認')
  if (needReview.length === 0) {
    lines.push('（本次未發現需要特別人工確認的可疑資料。）')
  } else {
    for (const item of needReview) {
      lines.push('')
      lines.push(`* 問題類型：${item.type}`)
      lines.push(`* 相關單號 / 料號：${item.ref || '-'}`)
      lines.push(`* 需要確認的原因：${item.reason || '-'}`)
      lines.push(`* 建議確認方式：${item.suggestion || '-'}`)
    }
  }

  // 三、流程卡住
  lines.push('')
  lines.push('三、流程卡住')
  if (stuck.length === 0) {
    lines.push('（本次未發現明顯流程長時間停留的情況。）')
  } else {
    for (const item of stuck) {
      lines.push('')
      lines.push(`* 流程：${item.flow}`)
      lines.push(`* 相關單號：${item.ref || '-'}`)
      lines.push(`* 目前狀態：${item.status || '-'}`)
      lines.push(`* 卡住原因推測：${item.cause || '-'}`)
      lines.push(`* 建議下一步：${item.next || '-'}`)
    }
  }

  // 四、資料一致性檢查
  lines.push('')
  lines.push('四、資料一致性檢查')
  if (consistency.length === 0) {
    lines.push('（本次未執行額外的一致性比對檢查。）')
  } else {
    for (const item of consistency) {
      lines.push('')
      lines.push(`* 檢查項目：${item.item}`)
      lines.push(`* 是否正常：${item.ok ? '是' : '否'}`)
      lines.push(`* 異常內容：${item.detail || (item.ok ? '—' : '-')}`)
      lines.push(`* 建議處理：${item.suggestion || '-'}`)
    }
  }

  // 五、今日正常項目
  lines.push('')
  lines.push('五、今日正常項目')
  if (!normals.length) {
    lines.push('* （無特別標記，請以上述各節為準）')
  } else {
    for (const n of normals) {
      lines.push(`* ${n}`)
    }
  }

  // 六、今日優先處理事項
  lines.push('')
  lines.push('六、今日優先處理事項')
  if (!priorities.length) {
    lines.push('* 目前沒有需要立即處理的高優先等級異常。')
  } else {
    let idx = 1
    for (const item of priorities) {
      lines.push('')
      lines.push(`(${idx}) 問題類型：${item.type}`)
      lines.push(`    相關單號 / 料號：${item.ref || '-'}`)
      lines.push(`    異常原因：${item.reason || '-'}`)
      lines.push(`    影響範圍：${item.impact || '-'}`)
      lines.push(`    建議處理方式：${item.suggestion || '-'}`)
      idx += 1
    }
  }

  return lines.join('\n')
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('Telegram 未配置，僅輸出報告文字：\n')
    console.log(text)
    return { skipped: true }
  }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text }),
  })
  const data = await res.json()
  if (!data.ok) {
    throw new Error(`Telegram 发送失败: ${JSON.stringify(data)}`)
  }
  return data
}

async function main() {
  const text = await buildPatrolText()
  console.log(text)
  console.log('')
  await sendTelegram(text)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
