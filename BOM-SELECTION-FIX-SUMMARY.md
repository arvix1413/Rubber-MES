# BOM Selection Bug - Fixed ✅

## Problem
When selecting a BOM from the dropdown in Purchase Orders or Customer Orders pages, the form fields (material name, spec, unit, unit price) were not being auto-filled.

## Root Cause
The `onClick` event handler in the SearchableSelect component was not being triggered. This is a known issue with React when using `onClick` on fixed-positioned elements - the event doesn't propagate correctly.

## Solution
Changed from `onClick` to `onMouseDown` event handler in the SearchableSelect component.

### Code Change
**File**: `frontend/components/SearchableSelect.tsx`

**Before**:
```typescript
<div
  onClick={() => {
    onChange(String(opt.id))
    setIsOpen(false)
    setSearchTerm('')
  }}
>
```

**After**:
```typescript
<div
  onMouseDown={(e) => {
    e.preventDefault()
    e.stopPropagation()
    onChange(String(opt.id))
    setIsOpen(false)
    setSearchTerm('')
  }}
>
```

## Why onMouseDown Works
- `onMouseDown` fires before `onClick` in the event chain
- It's not affected by focus changes or fixed positioning issues
- `e.preventDefault()` prevents the default behavior (like text selection)
- `e.stopPropagation()` prevents the event from bubbling up

## Testing
Tested locally with Playwright E2E tests:
- ✅ Dropdown opens correctly
- ✅ BOM options are displayed
- ✅ Clicking a BOM option triggers the selection
- ✅ Form fields are auto-filled with correct values:
  - Material name
  - Spec (e.g., "50*86mm")
  - Unit (e.g., "PCS")
  - Unit price
  - Image URL

## Files Modified
1. `frontend/components/SearchableSelect.tsx` - Changed onClick to onMouseDown
2. `frontend/app/dashboard/po/page.tsx` - Removed debug console.log
3. `frontend/app/dashboard/customer-orders/page.tsx` - Removed debug console.log

## Deployment
- Code pushed to GitHub: commit `a43d4cf`
- GitHub Actions will automatically build and deploy
- Deployment takes approximately 150 seconds
- After deployment, the fix will be live on production

## Verification Steps
After deployment, verify by:
1. Login to the system
2. Go to Purchase Orders or Customer Orders
3. Click "Create" button
4. Select a supplier (for PO) or skip (for CO)
5. Click on the BOM dropdown
6. Select a BOM option
7. Verify that the form fields are automatically filled

## Additional Notes
- This fix applies to all pages using SearchableSelect component
- The component is used in:
  - Purchase Orders (PO) page
  - Customer Orders page
  - Any other page that uses the SearchableSelect component
