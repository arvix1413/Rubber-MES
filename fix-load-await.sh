#!/bin/bash

# 修复所有页面的load()调用，确保使用await

echo "🔧 Fixing load() calls to use await..."

# 查找所有需要修复的文件
files=(
  "frontend/app/dashboard/materials/page.tsx"
  "frontend/app/dashboard/products/page.tsx"
  "frontend/app/dashboard/suppliers/page.tsx"
  "frontend/app/dashboard/customers/page.tsx"
  "frontend/app/dashboard/users/page.tsx"
  "frontend/app/dashboard/po/page.tsx"
  "frontend/app/dashboard/customer-orders/page.tsx"
  "frontend/app/dashboard/delivery-notes/page.tsx"
  "frontend/app/dashboard/quotations/page.tsx"
  "frontend/app/dashboard/goods-receipts/page.tsx"
  "frontend/app/dashboard/production/page.tsx"
  "frontend/app/dashboard/stock-adjustments/page.tsx"
  "frontend/app/dashboard/payables/page.tsx"
  "frontend/app/dashboard/receivables/page.tsx"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "Processing $file..."
    # 替换 "; load()" 为 "\n      await load()"
    # 替换 " load()" 为 " await load()"
    sed -i.bak 's/; load()/\n      await load()/g' "$file"
    sed -i.bak 's/ load()/ await load()/g' "$file"
    rm "${file}.bak" 2>/dev/null
  fi
done

echo "✅ Done!"
