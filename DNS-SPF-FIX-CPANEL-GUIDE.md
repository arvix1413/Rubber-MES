# cPanel DNS 修复指南 - 删除重复 SPF 记录

## 📸 您当前的界面

看到您在 Zone Editor，正在编辑 MX 记录。我们需要操作的是 **TXT 记录**。

---

## ✅ 正确操作步骤

### Step 1: 找到 TXT 类型的记录

1. 在 Zone Records 页面
2. 点击 **Filter** 下拉菜单（目前显示 "All"）
3. 不要选 MX，向下滚动查看所有记录
4. 或者搜索包含 "spf" 的记录

### Step 2: 查看所有 TXT 记录

滚动页面，找到 **Type = TXT** 的记录，应该会看到：

```
Name: kunyi.vn.
Type: TXT
TTL: 14400
Record: "v=spf1 +a +mx +ip4:103.9.76.10 +ip4:123.30.129.241 ~all"
Actions: [Edit] [Delete]
```

```
Name: kunyi.vn.
Type: TXT
TTL: 300
Record: "v=spf1 +a +mx include:vinahost.vn include:vinahost.org ~all"
Actions: [Edit] [Delete]
```

```
Name: kunyi.vn.
Type: TXT
TTL: 300
Record: "v=spf1 include:spf.vinahost.vn ~all"
Actions: [Edit] [Delete]
```

### Step 3: 尝试删除重复记录

**情况 A：如果 Delete 按钮可点击**
- 点击前两条记录右侧的 **Delete** 按钮
- 确认删除
- 只保留 `v=spf1 include:spf.vinahost.vn ~all`

**情况 B：如果 Delete 按钮灰色/禁用** ← **最可能的情况**
- 说明记录被 VinaHost 系统保护
- cPanel 用户权限无法删除
- **需要联系 VinaHost 技术支持**

---

## 🎯 如果无法删除 - 联系 VinaHost

### 方式 1: VinaHost 在线支持

1. 登录 VinaHost 客户门户
   - URL: https://secure.vinahost.vn/ac/clientarea.php
   - Email: `kuritw1976@gmail.com`
   - Password: `Ifindmyway1314`

2. 提交工单（Ticket）
   - 点击 "Support" → "Open New Ticket"
   - Department: Technical Support
   - Subject: **DNS SPF Record Cleanup for kunyi.vn**

3. 工单内容（中英文）：

```
Subject: DNS SPF Record Cleanup for kunyi.vn

Hello,

I need help cleaning up duplicate SPF records for domain kunyi.vn.

Current issue:
- There are 3 SPF (TXT) records in the DNS zone
- DNS standard only allows 1 SPF record per domain
- Some records are protected and I cannot delete them from cPanel

Please DELETE these 2 records:
1. v=spf1 +a +mx +ip4:103.9.76.10 +ip4:123.30.129.241 ~all (TTL 14400)
2. v=spf1 +a +mx include:vinahost.vn include:vinahost.org ~all (TTL 300)

Please KEEP this record:
✓ v=spf1 include:spf.vinahost.vn ~all (TTL 300)

Domain: kunyi.vn
cPanel user: thamhth

This is causing email deliverability issues.

Thank you!

---

您好，

我需要清理域名 kunyi.vn 的重复 SPF 记录。

当前问题：
- DNS 区域有 3 条 SPF (TXT) 记录
- DNS 标准只允许每个域名有 1 条 SPF 记录
- 部分记录被保护，我无法在 cPanel 中删除

请删除这 2 条记录：
1. v=spf1 +a +mx +ip4:103.9.76.10 +ip4:123.30.129.241 ~all (TTL 14400)
2. v=spf1 +a +mx include:vinahost.vn include:vinahost.org ~all (TTL 300)

请保留这条记录：
✓ v=spf1 include:spf.vinahost.vn ~all (TTL 300)

域名: kunyi.vn
cPanel 用户: thamhth

这导致了邮件发送问题。

谢谢！
```

### 方式 2: VinaHost 在线聊天

- 访问 https://www.vinahost.vn/
- 点击右下角的在线客服图标
- 用同样的内容提问

### 方式 3: 邮件支持

- 发送邮件到: support@vinahost.vn
- 使用上面的工单内容

---

## 🔍 验证权限级别

运行此命令查看您是否有 WHM 访问权限：

```bash
curl -s -H "Authorization: whm root:YOUR_ROOT_TOKEN" \
"https://vdc-whm-cheaphosting-1112.vinahost.org:2087/json-api/version" \
| python3 -m json.tool
```

如果返回错误，说明您没有 WHM (root) 权限。

---

## 📋 临时解决方案

在等待 VinaHost 删除旧记录期间：

### 选项 1: 保持现状
- 邮件发送功能目前正常
- 某些邮件服务器可能标记为 softfail
- 但不影响基本发送

### 选项 2: 修改最新的 SPF 记录

如果 Line 28 可以编辑，可以改为包含所有 IP 的版本：

```
v=spf1 +a +mx +ip4:103.9.76.10 +ip4:123.30.129.241 include:spf.vinahost.vn ~all
```

这样即使有多条记录，至少最新的这条是完整的。

**操作步骤：**
1. 找到 `v=spf1 include:spf.vinahost.vn ~all` 这条记录
2. 点击 **Edit**
3. 在 Record 字段修改为上述内容
4. TTL 保持 300
5. 点击 **Save Record**

---

## 🎯 最终目标

最终 DNS 查询应该只返回：

```bash
dig TXT kunyi.vn +short
"v=spf1 include:spf.vinahost.vn ~all"
```

**只有一条记录！**

---

## 📞 VinaHost 联系方式

- **客户门户**: https://secure.vinahost.vn/ac/clientarea.php
- **邮件**: support@vinahost.vn
- **电话**: +84 (028) 7306 6680
- **在线聊天**: https://www.vinahost.vn/

---

**创建时间**: 2026-06-30
**操作人员**: Leo
