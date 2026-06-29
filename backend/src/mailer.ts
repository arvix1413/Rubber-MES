import nodemailer from 'nodemailer'

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'vdc-whm-cheaphosting-1112.vinahost.org',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true, // SSL on port 465
    auth: {
      user: process.env.SMTP_USER || 'noreply@kunyi.vn',
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false, // VinaHost uses self-signed cert
    },
  })
}

export async function sendNotificationEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}) {
  if (!process.env.SMTP_PASS) {
    console.warn('[mailer] SMTP_PASS not set, skipping email')
    return
  }
  try {
    const from = process.env.SMTP_FROM || 'MES System <noreply@kunyi.vn>'
    await getTransporter().sendMail({ from, to, subject, html })
    console.log(`[mailer] Email sent to ${to}: ${subject}`)
  } catch (e: any) {
    console.error('[mailer] Failed to send email:', e?.message || e)
  }
}

export function buildPendingApprovalEmail({
  type,
  number,
  name,
  createdBy,
  amount,
  currency,
  systemUrl,
}: {
  type: '報價單' | '採購單'
  number: string
  name: string
  createdBy: string
  amount?: number
  currency?: string
  systemUrl?: string
}) {
  const now = new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })

  const isQT = type === '報價單'
  const accentColor = isQT ? '#0ea5e9' : '#f59e0b'
  const accentLight = isQT ? '#e0f2fe' : '#fef3c7'
  const typeLabel = isQT ? '報價單' : '採購單'
  const partyLabel = isQT ? '客戶' : '供應商'
  const loginUrl = systemUrl || 'http://43.160.199.226:10101'

  const amountFormatted = amount != null
    ? `${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency || 'VND'}`
    : null

  return {
    subject: `[待審核] ${typeLabel} ${number}`,
    html: `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#1e293b 0%,#334155 100%);border-radius:12px 12px 0 0;padding:28px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;">Rubber MES</p>
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">待審核通知</h1>
            </td>
            <td align="right">
              <span style="display:inline-block;background:${accentColor};color:#fff;font-size:12px;font-weight:700;padding:6px 14px;border-radius:20px;letter-spacing:0.5px;">
                ⏳ 待審核
              </span>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#ffffff;padding:32px;">

        <!-- Type badge + title -->
        <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td style="background:${accentLight};border-left:4px solid ${accentColor};border-radius:0 6px 6px 0;padding:12px 16px;">
              <p style="margin:0 0 2px;font-size:12px;color:${accentColor};font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">${typeLabel}</p>
              <p style="margin:0;font-size:20px;font-weight:800;color:#0f172a;font-family:'Courier New',monospace;">${number}</p>
            </td>
          </tr>
        </table>

        <!-- Info table -->
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px;">
          <tr style="background:#f8fafc;">
            <td style="padding:10px 16px;font-size:12px;color:#64748b;font-weight:600;width:100px;border-bottom:1px solid #e2e8f0;">${partyLabel}</td>
            <td style="padding:10px 16px;font-size:14px;color:#1e293b;font-weight:600;border-bottom:1px solid #e2e8f0;">${name}</td>
          </tr>
          ${amountFormatted ? `
          <tr>
            <td style="padding:10px 16px;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">金額</td>
            <td style="padding:10px 16px;font-size:14px;color:#1e293b;font-weight:700;border-bottom:1px solid #e2e8f0;">${amountFormatted}</td>
          </tr>` : ''}
          <tr style="background:#f8fafc;">
            <td style="padding:10px 16px;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">提交人</td>
            <td style="padding:10px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${createdBy}</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:12px;color:#64748b;font-weight:600;">提交時間</td>
            <td style="padding:10px 16px;font-size:13px;color:#475569;">${now}</td>
          </tr>
        </table>

        <!-- CTA Button -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td align="center">
              <a href="${loginUrl}" style="display:inline-block;background:${accentColor};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.3px;">
                前往系統審核 →
              </a>
            </td>
          </tr>
        </table>

        <!-- Divider -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr><td style="border-top:1px solid #e2e8f0;"></td></tr>
        </table>

        <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;text-align:center;">
          此郵件由系統自動發送，請勿直接回覆。<br>
          如有疑問，請聯繫系統管理員。
        </p>

      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f8fafc;border-radius:0 0 12px 12px;border-top:1px solid #e2e8f0;padding:16px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:11px;color:#94a3b8;">Rubber MES &copy; ${new Date().getFullYear()}</td>
            <td align="right" style="font-size:11px;color:#cbd5e1;">${now.split(' ')[0]}</td>
          </tr>
        </table>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`,
  }
}
