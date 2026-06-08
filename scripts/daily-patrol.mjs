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

const checks = []

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail })
}

async function fetchStatus(url, opts = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 15000)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal })
    return { ok: res.ok, status: res.status, res }
  } catch (e) {
    return { ok: false, status: 0, error: e.message }
  } finally {
    clearTimeout(timer)
  }
}

async function checkFrontend() {
  const { ok, status, error } = await fetchStatus(FRONTEND)
  record('前端页面', ok && status === 200, error || `HTTP ${status}`)
}

async function checkBackendRoot() {
  const { ok, status, res, error } = await fetchStatus(`${API}/`)
  if (!ok) {
    record('后端服务', false, error || `HTTP ${status}`)
    return
  }
  let body = {}
  try { body = await res.json() } catch { /* ignore */ }
  const nameOk = body?.name?.includes('RUBBER') || body?.name?.includes('Rubber')
  record('后端服务', nameOk, body?.name || `HTTP ${status}`)
}

async function checkCompanyApi() {
  const { ok, status, res, error } = await fetchStatus(`${API}/api/company`)
  if (!ok) {
    record('公司设定 API', false, error || `HTTP ${status}`)
    return
  }
  let body = {}
  try { body = await res.json() } catch { /* ignore */ }
  record('公司设定 API', !!body.company_name, body.company_name || `HTTP ${status}`)
}

async function checkAuthAndOrders() {
  if (!PASSWORD) {
    record('登入与订单 API', false, '未设置 RUBBER_PATROL_PASSWORD')
    return
  }
  let loginRes
  try {
    loginRes = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
  } catch (e) {
    record('登入与订单 API', false, e.message)
    return
  }
  if (!loginRes.ok) {
    record('登入与订单 API', false, `登入 HTTP ${loginRes.status}`)
    return
  }
  const login = await loginRes.json()
  const token = login?.token
  if (!token) {
    record('登入与订单 API', false, '未取得 token')
    return
  }
  const { ok, status, res, error } = await fetchStatus(`${API}/api/customer-orders`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!ok) {
    record('登入与订单 API', false, error || `订单列表 HTTP ${status}`)
    return
  }
  let orders = []
  try { orders = await res.json() } catch { /* ignore */ }
  const count = Array.isArray(orders) ? orders.length : 0
  record('登入与订单 API', Array.isArray(orders), `订单 ${count} 笔`)
}

function buildReport() {
  const now = new Date()
  const tz = 'Asia/Taipei'
  const timeStr = now.toLocaleString('zh-TW', { timeZone: tz, hour12: false })
  const allOk = checks.every((c) => c.ok)
  const header = allOk ? '✅ Rubber-MES 每日巡查 — 全部正常' : '⚠️ Rubber-MES 每日巡查 — 有异常'
  const lines = [
    header,
    '',
    `时间: ${timeStr} (${tz})`,
    `前端: ${FRONTEND}`,
    `后端: ${API}`,
    '',
    '检查项:',
    ...checks.map((c) => {
      const mark = c.ok ? '✓' : '✗'
      const detail = c.detail ? ` — ${c.detail}` : ''
      return `${mark} ${c.name}${detail}`
    }),
  ]
  if (!allOk) {
    lines.push('', '请尽快登录服务器或 GitHub Actions 查看详情。')
  }
  return lines.join('\n')
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('Telegram 未配置，仅输出报告:\n')
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
  await checkFrontend()
  await checkBackendRoot()
  await checkCompanyApi()
  await checkAuthAndOrders()

  const report = buildReport()
  console.log(report)
  console.log('')

  await sendTelegram(report)

  const failed = checks.filter((c) => !c.ok)
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
