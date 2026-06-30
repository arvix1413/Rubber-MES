# kunyi.vn DNS SPF 记录修复指南

## 📊 当前问题

kunyi.vn 域名有 **3 条 SPF 记录**，但 DNS 规范只允许一条。这导致邮件发送可能被标记为 spam 或被拒收。

### 当前记录（2026-06-30）

```
Line 9:  v=spf1 +a +mx +ip4:103.9.76.10 +ip4:123.30.129.241 ~all
Line 27: v=spf1 +a +mx include:vinahost.vn include:vinahost.org ~all
Line 28: v=spf1 include:spf.vinahost.vn ~all  ← 这是正确的
```

**需要删除 Line 9 和 Line 27，只保留 Line 28。**

---

## 🔧 修复步骤（手动操作）

cPanel DNS API 的 `mass_edit_zone` 功能有限制，无法直接通过 API 删除记录。需要手动在 cPanel 界面操作。

### Step 1: 登录 cPanel

**URL:** https://vdc-whm-cheaphosting-1112.vinahost.org:2083

**凭据：**
```bash
User: thamhth
Password: ZW?dJrk$I@cKNgv5
```

> 💡 密码在 `scripts/.secrets.env` 文件中的 `VINAHOST_CPANEL_PASSWORD`

---

### Step 2: 进入 Zone Editor

1. 登录后在 cPanel 首页搜索 **"Zone"**
2. 点击 **"Zone Editor"** 或 **"高级 Zone 编辑器"**
3. 找到 **kunyi.vn** 域名
4. 点击右侧的 **"Manage"** 或 **"管理"** 按钮

---

### Step 3: 删除重复的 SPF 记录

在 Zone Editor 页面，你会看到所有 DNS 记录。找到 **TXT 类型** 的记录：

#### ❌ 删除这两条记录：

**第一条（Line 9）：**
```
Type: TXT
Name: kunyi.vn
Record: v=spf1 +a +mx +ip4:103.9.76.10 +ip4:123.30.129.241 ~all
TTL: 14400
```
→ 点击右侧 **"Delete"** 或 **"删除"** 按钮

**第二条（Line 27）：**
```
Type: TXT
Name: kunyi.vn
Record: v=spf1 +a +mx include:vinahost.vn include:vinahost.org ~all
TTL: 300
```
→ 点击右侧 **"Delete"** 或 **"删除"** 按钮

#### ✅ 保留这一条记录：

**第三条（Line 28）：**
```
Type: TXT
Name: kunyi.vn
Record: v=spf1 include:spf.vinahost.vn ~all
TTL: 300
```
→ **不要删除这条！** 这是唯一正确的 SPF 记录

---

### Step 4: 保存并等待生效

1. 确认只保留了 `v=spf1 include:spf.vinahost.vn ~all` 这一条 SPF 记录
2. DNS 修改会自动保存
3. 等待 **5-10 分钟** 让 DNS 传播（TTL=300 秒）

---

## ✅ 验证修复结果

修改完成后，运行以下命令验证：

```bash
# 查询 VinaHost 权威 DNS
dig TXT kunyi.vn @ns3.vinahost.vn +short

# 查询 Google DNS
dig TXT kunyi.vn @8.8.8.8 +short
```

**期望结果：**
```
"v=spf1 include:spf.vinahost.vn ~all"
```

应该 **只看到一条 SPF 记录**，不再有重复。

---

## 📧 测试邮件发送

DNS 修复后，发送测试邮件验证：

```bash
python3 -c "
import smtplib, ssl
from email.mime.text import MIMEText

msg = MIMEText('DNS SPF 已修复测试', 'plain', 'utf-8')
msg['Subject'] = 'SPF Fixed - Test from kunyi.vn'
msg['From'] = 'KunYi System <noreply@kunyi.vn>'
msg['To'] = 'wxfaigl@gmail.com'

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

with smtplib.SMTP_SSL('vdc-whm-cheaphosting-1112.vinahost.org', 465, context=ctx) as s:
    s.login('noreply@kunyi.vn', 'Notify@Kunyi2026!')
    s.sendmail('noreply@kunyi.vn', ['wxfaigl@gmail.com'], msg.as_string())
    print('✅ 邮件发送成功')
"
```

检查 Gmail 收件箱，邮件应该：
- ✅ 正常收到
- ✅ 不在垃圾邮件文件夹
- ✅ 邮件头显示 `SPF: PASS`

---

## 🔍 为什么会有 3 条 SPF 记录？

1. **Line 9**：VinaHost 系统自动创建的默认 SPF（系统保护，不容易删除）
2. **Line 27**：之前尝试修复时错误添加的（include 错误域名）
3. **Line 28**：正确的 SPF 记录（最近添加）

---

## 📚 相关文档

- **cPanel 凭据**: `scripts/.secrets.env`
- **SMTP 配置**: `Rubber-MES/backend/src/mailer.ts`
- **环境变量**: `/opt/rubber/.env` (服务器上)
- **README**: `Rubber-MES/README.md` (Section 14)

---

## ⚠️ 注意事项

1. **只能保留一条 SPF 记录**，这是 RFC 7208 规定
2. **TTL=300** 意味着 DNS 修改会在 5 分钟内生效
3. **不要删除 Line 28**，那是唯一正确的记录
4. 修改后记得更新 `Rubber-MES/README.md` 的状态

---

## 🎯 修复完成后的更新

修复完成后，更新 `Rubber-MES/README.md` 第 14 节：

```markdown
### 当前状态（2026-06-30）

**已完成：**
- ✅ 所有 DNS 修复完成
- ✅ 只保留一条正确的 SPF 记录
- ✅ 邮件发送正常，SPF 验证通过

**验证方法：**
```bash
dig TXT kunyi.vn @ns3.vinahost.vn +short
# 应该只看到: "v=spf1 include:spf.vinahost.vn ~all"
```
\```

---

**创建时间**: 2026-06-30
**最后更新**: 2026-06-30
**操作人员**: Leo
