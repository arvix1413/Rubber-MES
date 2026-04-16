#!/usr/bin/env node

// Test script to manually verify order creation
const BASE_URL = process.env.API_URL || 'http://43.133.56.234:3001'

async function login() {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin', password: 'admin123' })
  })
  const data = await response.json()
  if (!data.token) throw new Error('Login failed: ' + JSON.stringify(data))
  console.log('✓ Login successful')
  return data.token
}

async function getSuppliers(token) {
  const response = await fetch(`${BASE_URL}/api/suppliers`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await response.json()
  console.log(`✓ Found ${data.length} suppliers`)
  return data
}

async function getCustomers(token) {
  const response = await fetch(`${BASE_URL}/api/customers`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await response.json()
  console.log(`✓ Found ${data.length} customers`)
  return data
}

async function getBOMs(token) {
  const response = await fetch(`${BASE_URL}/api/bom`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await response.json()
  console.log(`✓ Found ${data.length} BOMs`)
  return data
}

async function createPO(token, supplier, bom) {
  console.log('\n--- Testing PO Creation ---')
  const payload = {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    currency: supplier.currency || 'VND',
    remark: 'Test PO from script',
    items: [{
      bom_id: bom.id,
      material_code: bom.product_sku,
      material_name: bom.product_name,
      spec: bom.spec || '',
      unit: bom.unit || 'PCS',
      quantity: 100,
      unit_price: bom.supplier_price || 50,
      total_price: 100 * (bom.supplier_price || 50),
      currency: bom.currency || 'VND',
      remark: '',
      po_ref: `TEST-${Date.now()}`,
      thickness: ''
    }]
  }
  
  console.log('Payload:', JSON.stringify(payload, null, 2))
  
  const response = await fetch(`${BASE_URL}/api/po`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  
  const data = await response.json()
  if (response.ok) {
    console.log('✓ PO created successfully:', data)
  } else {
    console.error('✗ PO creation failed:', data)
  }
  return data
}

async function createCustomerOrder(token, customer, bom) {
  console.log('\n--- Testing Customer Order Creation ---')
  const today = new Date().toISOString().split('T')[0]
  const payload = {
    po_date: today,
    po_number: `TEST-CO-${Date.now()}`,
    customer_id: customer.id,
    remark: 'Test customer order from script',
    tax_rate: 8,
    currency: 'VND',
    delivery_date: today,
    delivery_address: 'Test Address 123',
    person_in_charge: 'Test Person',
    payment_terms: 'Net 30',
    items: [{
      bom_id: bom.id,
      qty: 200,
      unit_price: bom.company_price || 100,
      rta_date: today,
      spec: bom.spec || '',
      unit: bom.unit || 'PCS'
    }]
  }
  
  console.log('Payload:', JSON.stringify(payload, null, 2))
  
  const response = await fetch(`${BASE_URL}/api/customer-orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  
  const data = await response.json()
  if (response.ok) {
    console.log('✓ Customer order created successfully:', data)
  } else {
    console.error('✗ Customer order creation failed:', data)
  }
  return data
}

async function main() {
  try {
    console.log('Testing Order Creation...\n')
    console.log('API URL:', BASE_URL)
    
    const token = await login()
    const suppliers = await getSuppliers(token)
    const customers = await getCustomers(token)
    const boms = await getBOMs(token)
    
    if (suppliers.length === 0) {
      console.error('✗ No suppliers found')
      return
    }
    if (customers.length === 0) {
      console.error('✗ No customers found')
      return
    }
    if (boms.length === 0) {
      console.error('✗ No BOMs found')
      return
    }
    
    // Find a BOM with supplier_id matching first supplier
    const supplier = suppliers[0]
    const supplierBom = boms.find(b => b.supplier_id === supplier.id) || boms[0]
    
    console.log(`\nUsing supplier: ${supplier.name} (ID: ${supplier.id})`)
    console.log(`Using BOM: ${supplierBom.product_sku} - ${supplierBom.product_name}`)
    
    // Test PO creation
    await createPO(token, supplier, supplierBom)
    
    // Test Customer Order creation
    const customer = customers[0]
    console.log(`\nUsing customer: ${customer.customer_name} (ID: ${customer.id})`)
    await createCustomerOrder(token, customer, boms[0])
    
    console.log('\n✓ All tests completed')
  } catch (error) {
    console.error('\n✗ Error:', error.message)
    console.error(error.stack)
  }
}

main()
