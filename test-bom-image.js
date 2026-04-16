const API = 'http://43.133.56.234:3001'

async function testBomImage() {
  console.log('🧪 Testing BOM Image Upload...\n')

  // 1. Login
  console.log('1️⃣ Logging in...')
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@oms.com', password: 'admin123' })
  })
  const { token } = await loginRes.json()
  console.log('✅ Login successful\n')

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }

  // 2. Get BOM list
  console.log('2️⃣ Fetching BOM list...')
  const bomRes = await fetch(`${API}/api/bom`, { headers })
  const boms = await bomRes.json()
  console.log(`✅ Found ${boms.length} BOMs\n`)

  if (boms.length > 0) {
    const firstBom = boms[0]
    console.log('📦 First BOM:')
    console.log(`   ID: ${firstBom.id}`)
    console.log(`   SKU: ${firstBom.product_sku}`)
    console.log(`   Name: ${firstBom.product_name}`)
    console.log(`   Image URL: ${firstBom.image_url || '(empty)'}`)
    console.log()

    // 3. Update BOM with image URL
    console.log('3️⃣ Updating BOM with test image URL...')
    const testImageUrl = '/uploads/test-image.jpg'
    const updateRes = await fetch(`${API}/api/bom/${firstBom.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        ...firstBom,
        image_url: testImageUrl
      })
    })
    const updateResult = await updateRes.json()
    console.log('✅ Update response:', updateResult)
    console.log()

    // 4. Verify the update
    console.log('4️⃣ Verifying the update...')
    const verifyRes = await fetch(`${API}/api/bom`, { headers })
    const updatedBoms = await verifyRes.json()
    const updatedBom = updatedBoms.find(b => b.id === firstBom.id)
    
    if (updatedBom) {
      console.log('📦 Updated BOM:')
      console.log(`   ID: ${updatedBom.id}`)
      console.log(`   SKU: ${updatedBom.product_sku}`)
      console.log(`   Name: ${updatedBom.product_name}`)
      console.log(`   Image URL: ${updatedBom.image_url || '(empty)'}`)
      
      if (updatedBom.image_url === testImageUrl) {
        console.log('✅ Image URL updated successfully!')
      } else {
        console.log('❌ Image URL not updated correctly')
        console.log(`   Expected: ${testImageUrl}`)
        console.log(`   Got: ${updatedBom.image_url}`)
      }
    } else {
      console.log('❌ Could not find updated BOM')
    }
  } else {
    console.log('⚠️  No BOMs found to test')
  }

  console.log('\n✅ Test completed!')
}

testBomImage().catch(err => {
  console.error('❌ Test failed:', err.message)
  process.exit(1)
})
