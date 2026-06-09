#!/usr/bin/env node
/**
 * 从 Telegram getUpdates 读取群 chat_id（需先把 bot 拉进群并发送任意消息）
 *
 * TELEGRAM_PATROL_BOT_TOKEN=xxx node scripts/telegram-get-chat-id.mjs
 */
const token = process.env.TELEGRAM_PATROL_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error('请设置 TELEGRAM_PATROL_BOT_TOKEN')
  process.exit(1)
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`)
const data = await res.json()
if (!data.ok) {
  console.error('getUpdates 失败:', data)
  process.exit(1)
}

const chats = new Map()
for (const u of data.result || []) {
  const msg = u.message || u.channel_post
  if (!msg?.chat) continue
  const { id, title, type, username } = msg.chat
  chats.set(id, { id, title, type, username })
}

if (chats.size === 0) {
  console.log('暂无消息记录。请：')
  console.log('1. 把 @DailyPatrolBot 拉进你的 Telegram 群')
  console.log('2. 在群里发一条消息（例如 /start 或 ping）')
  console.log('3. 再运行本脚本')
  process.exit(1)
}

console.log('发现以下 chat：\n')
for (const c of chats.values()) {
  const label = c.title || c.username || '(私聊)'
  console.log(`  chat_id: ${c.id}  type: ${c.type}  name: ${label}`)
}
console.log('\n把群 chat_id 设为 GitHub secret: TELEGRAM_PATROL_CHAT_ID')
console.log('若与部署通知同一群，也可不设，workflow 会回退使用 TELEGRAM_CHAT_ID')
