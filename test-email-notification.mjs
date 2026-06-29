#!/usr/bin/env node
// 测试报价单邮件通知功能

const API = 'http://43.160.199.226:10102'
const EMAIL = 'admin@rubber.local'
const PASSWORD = 'Make$45617'
const NOTIFY_EMAIL = 'wxfaigl@gmail.com'

async function req(path, opts = {}, token) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API}${path}`, { ...opts, headers })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(data)}`)
  return data
}

async function run() {
  console.log('🧪 开始测试邮件通知功能...\n')

  // 1. 登录
  console.log('1️⃣  登录系统...')
  const loginRes = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  })
  const token = loginRes.token
  console.log('   ✅ 登录成功\n')

  // 2. 检查公司设置中的通知邮箱
  console.log('2️⃣  检查公司设置...')
  const company = await req('/api/company', {}, token)
  console.log(`   当前通知邮箱: ${company.notification_email || '（未设置）'}`)
  
  if (company.notification_email !== NOTIFY_EMAIL) {
    console.log(`   🔧 更新通知邮箱为: ${NOTIFY_EMAIL}`)
    await req('/api/company', {
      method: 'PUT',
      body: JSON.stringify({ ...company, notification_email: NOTIFY_EMAIL })
    }, token)
    console.log('   ✅ 通知邮箱已更新\n')
  } else {
    console.log('   ✅ 通知邮箱已正确配置\n')
  }

  // 3. 获取客户和BOM数据
  console.log('3️⃣  获取测试数据...')
  const customers = await req('/api/customers', {}, token)
  const boms = await req('/api/bom', {}, token)
  
  if (!customers.length) throw new Error('没有客户数据')
  if (!boms.length) throw new Error('没有BOM数据')
  
  const customer = customers[0]
  const bom = boms[0]
  console.log(`   客户: ${customer.customer_name}`)
  console.log(`   BOM: ${bom.product_name}\n`)

  // 4. 创建测试报价单
  console.log('4️⃣  创建测试报价单...')
  const quotation = await req('/api/quotations', {
    method: 'POST',
    body: JSON.stringify({
      customer_id: customer.id,
      customer_name: customer.customer_name,
      currency: 'VND',
      valid_until: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      remark: 'EMAIL-TEST-' + Date.now(),
      items: [{
        bom_id: bom.id,
        material_code: bom.product_sku,
        item_name: bom.product_name,
        spec: bom.spec || '',
        unit: bom.unit || '',
        qty: 100,
        unit_price: bom.company_price || 1000,
        total_price: 100 * (bom.company_price || 1000),
        remark: '',
        moq: null,
      }]
    })
  }, token)
  console.log(`   ✅ 报价单创建成功\n`)

  // 5. 获取报价单详情
  const allQuotations = await req('/api/quotations', {}, token)
  const testQuotation = allQuotations.find(q => q.remark && q.remark.includes('EMAIL-TEST'))
  
  if (!testQuotation) throw new Error('找不到测试报价单')
  
  console.log(`5️⃣  提交审核 (触发邮件)...`)
  console.log(`   报价单号: ${testQuotation.quotation_number}`)
  console.log(`   客户: ${testQuotation.customer_name}`)
  console.log(`   金额: ${testQuotation.total_amount} ${testQuotation.currency}`)
  console.log()

  // 6. 提交审核（触发邮件）
  await req(`/api/quotations/${testQuotation.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'pending_review' })
  }, token)
  console.log(`   ✅ 已提交审核，邮件应该已发送到: ${NOTIFY_EMAIL}\n`)

  // 7. 清理测试数据
  console.log('6️⃣  清理测试数据...')
  await req(`/api/quotations/${testQuotation.id}`, { method: 'DELETE' }, token)
  console.log(`   ✅ 测试报价单已删除\n`)

  console.log('✅ 测试完成！请检查邮箱 wxfaigl@gmail.com 是否收到通知邮件。')
  console.log('\n📧 邮件内容应包括：')
  console.log(`   - 主题: [待審核] 報價單 ${testQuotation.quotation_number} 需要審核`)
  console.log(`   - 客户: ${testQuotation.customer_name}`)
  console.log(`   - 金额: ${testQuotation.total_amount} ${testQuotation.currency}`)
}

run().catch(e => {
  console.error('❌ 测试失败:', e.message)
  process.exit(1)
})
