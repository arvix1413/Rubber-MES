const fs = require('fs');
const path = require('path');

const pagesDir = 'frontend/app/dashboard';
const pages = fs.readdirSync(pagesDir).filter(f => {
  const fullPath = path.join(pagesDir, f);
  return fs.statSync(fullPath).isDirectory();
});

let fixedCount = 0;

pages.forEach(page => {
  const filePath = path.join(pagesDir, page, 'page.tsx');
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Pattern 1: setEditing(null); load() -> setEditing(null)\n      await load()
  if (content.includes('; load()')) {
    content = content.replace(/; load\(\)/g, '\n      await load()');
    modified = true;
  }

  // Pattern 2: setCreating(false); load() -> setCreating(false)\n      await load()
  if (content.includes('setCreating(false); load()')) {
    content = content.replace(/setCreating\(false\); load\(\)/g, 'setCreating(false)\n      await load()');
    modified = true;
  }

  // Pattern 3: resetForm(); load() -> resetForm()\n      await load()
  if (content.includes('resetForm(); load()')) {
    content = content.replace(/resetForm\(\); load\(\)/g, 'resetForm()\n      await load()');
    modified = true;
  }

  // Pattern 4: }); load() -> })\n      await load()
  const pattern4 = /\}\); load\(\)/g;
  if (pattern4.test(content)) {
    content = content.replace(pattern4, '})\n      await load()');
    modified = true;
  }

  // Pattern 5: DELETE request followed by load() without await
  const deletePattern = /await apiFetch\([^)]+DELETE[^)]+\)\s*;\s*load\(\)/g;
  if (deletePattern.test(content)) {
    content = content.replace(deletePattern, (match) => {
      return match.replace('load()', 'await load()');
    });
    modified = true;
  }

  // Pattern 6: Single line with load() at the end (not already awaited)
  const singleLinePattern = /([^a]wait\s+[^;]+;\s*)load\(\)/g;
  if (singleLinePattern.test(content)) {
    content = content.replace(singleLinePattern, '$1await load()');
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Fixed: ${page}/page.tsx`);
    fixedCount++;
  } else {
    console.log(`⏭️  Skipped: ${page}/page.tsx (no changes needed)`);
  }
});

console.log(`\n🎉 Fixed ${fixedCount} files!`);
