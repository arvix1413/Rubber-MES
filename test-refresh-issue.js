/**
 * 测试页面刷新问题
 * 检查修改后列表是否立即更新
 */

const API = 'http://43.133.56.234:3001'

async function testRefresh() {
  console.log('🧪 Testing Page Refresh After Edit...\n')

  // 1. Login
  console.log('1️⃣ Logging in...')
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@oms.com', password: 'admin123' })
  })
  const { token } = await loginRes.json()
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
  console.log('✅ Login successful\n')

  // 2. Get initial BOM list
  console.log('2️⃣ Fetching initial BOM list...')
  const initialRes = await fetch(`${API}/api/bom`, { headers })
  const initialBoms = await initialRes.json()
  const testBom = initialBoms[0]
  console.log(`✅ Found BOM: ${testBom.product_sku} - ${testBom.product_name}`)
  console.log(`   Current image_url: ${testBom.image_url || '(empty)'}\n`)

  // 3. Update the BOM
  console.log('3️⃣ Updating BOM with new image URL...')
  const newImageUrl = `/uploads/test-${Date.now()}.jpg`
  const updateRes = await fetch(`${API}/api/bom/${testBom.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      ...testBom,
      image_url: newImageUrl
    })
  })
  await updateRes.json()
  console.log(`✅ Updated with image_url: ${newImageUrl}\n`)

  // 4. Immediately fetch the list again (simulating what frontend should do)
  console.log('4️⃣ Fetching BOM list again (simulating page refresh)...')
  const updatedRes = await fetch(`${API}/api/bom`, { headers })
  const updatedBoms = await updatedRes.json()
  const updatedBom = updatedBoms.find(b => b.id === testBom.id)

  console.log(`📦 Updated BOM:`)
  console.log(`   ID: ${updatedBom.id}`)
  console.log(`   SKU: ${updatedBom.product_sku}`)
  console.log(`   Image URL: ${updatedBom.image_url}\n`)

  // 5. Verify
  if (updatedBom.image_url === newImageUrl) {
    console.log('✅ SUCCESS: Image URL is immediately updated in the list!')
  } else {
    console.log('❌ FAIL: Image URL not updated')
    console.log(`   Expected: ${newImageUrl}`)
    console.log(`   Got: ${updatedBom.image_url}`)
  }

  console.log('\n✅ Test completed!')
}

testRefresh().catch(err => {
  console.error('❌ Test failed:', err.message)
  process.exit(1)
})
