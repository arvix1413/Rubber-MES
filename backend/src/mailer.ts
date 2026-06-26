import { Resend } from 'resend'

let _resend: Resend | null = null
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
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
  if (!process.env.RESEND_API_KEY) {
    console.warn('[mailer] RESEND_API_KEY not set, skipping email')
    return
  }
  try {
    const from = process.env.RESEND_FROM || 'MES System <onboarding@resend.dev>'
    const { error } = await getResend().emails.send({ from, to, subject, html })
    if (error) console.error('[mailer] Resend error:', error)
    else console.log(`[mailer] Email sent to ${to}: ${subject}`)
  } catch (e) {
    console.error('[mailer] Failed to send email:', e)
  }
}

export function buildPendingApprovalEmail({
  type,
  number,
  name,
  createdBy,
  amount,
  currency,
}: {
  type: '報價單' | '採購單'
  number: string
  name: string
  createdBy: string
  amount?: number
  currency?: string
}) {
  const amountStr = amount != null
    ? `<tr><td style="padding:6px 16px;color:#64748b;font-size:13px">金額</td><td style="padding:6px 16px;font-weight:600;font-size:13px">${Number(amount).toLocaleString()} ${currency || ''}</td></tr>`
    : ''

  return {
    subject: `[待審核] ${type} ${number} 需要審核`,
    html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#f8fafc;padding:24px">
  <div style="background:#fff;border-radius:10px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
      <div style="width:8px;height:8px;border-radius:50%;background:#f59e0b;flex-shrink:0"></div>
      <h2 style="margin:0;font-size:17px;font-weight:700;color:#1e293b">新${type}待審核</h2>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;background:#f8fafc;border-radius:8px;overflow:hidden">
      <tr>
        <td style="padding:10px 16px;color:#64748b;font-size:13px;width:90px">單號</td>
        <td style="padding:10px 16px;font-weight:700;font-size:14px;color:#0f172a">${number}</td>
      </tr>
      <tr style="background:#fff">
        <td style="padding:10px 16px;color:#64748b;font-size:13px">${type === '報價單' ? '客戶' : '供應商'}</td>
        <td style="padding:10px 16px;font-size:13px;color:#1e293b">${name}</td>
      </tr>
      ${amountStr}
      <tr style="background:#fff">
        <td style="padding:10px 16px;color:#64748b;font-size:13px">建立人</td>
        <td style="padding:10px 16px;font-size:13px;color:#1e293b">${createdBy}</td>
      </tr>
    </table>

    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0 0 20px">
      請登入 MES 系統進行審核。
    </p>

  </div>
  <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:16px">
    此郵件由 MES 系統自動發送，請勿回覆
  </p>
</div>`,
  }
}
