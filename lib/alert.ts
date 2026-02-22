import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY 
  ? new Resend(process.env.RESEND_API_KEY)
  : null

const ALERT_EMAIL = process.env.ALERT_EMAIL

export interface AlertData {
  offerId: string
  offerName: string
  previousLastConv: string | null
  currentLastConv: string | null
  previousMinutes: number | null
  currentMinutes: number | null
}

export async function sendAlertEmail(alertData: AlertData): Promise<boolean> {
  if (!resend) {
    console.log('Resend not configured, skipping email alert')
    console.log('Alert data:', alertData)
    return false
  }

  if (!ALERT_EMAIL) {
    console.error('ALERT_EMAIL not configured')
    return false
  }

  const { offerId, offerName, previousLastConv, currentLastConv, previousMinutes, currentMinutes } = alertData

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #d97706;">⚠️ Offer 转化异常告警</h2>
      
      <div style="background: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p><strong>Offer:</strong> ${offerName}</p>
        <p><strong>Offer ID:</strong> ${offerId}</p>
      </div>

      <h3 style="color: #374151;">转化时间变化:</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr style="background: #f3f4f6;">
          <th style="padding: 8px; text-align: left; border: 1px solid #e5e7eb;">时间点</th>
          <th style="padding: 8px; text-align: left; border: 1px solid #e5e7eb;">最后转化</th>
          <th style="padding: 8px; text-align: left; border: 1px solid #e5e7eb;">换算</th>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">之前</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${previousLastConv || '无'}</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${previousMinutes !== null ? `${previousMinutes} 分钟` : '无'}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">现在</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${currentLastConv || '无'}</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${currentMinutes !== null ? `${currentMinutes} 分钟` : '无'}</td>
        </tr>
      </table>

      <p style="color: #dc2626; font-weight: bold;">
        警告: 转化时间从 ${previousMinutes} 分钟变为 ${currentMinutes} 分钟，可能存在问题！
      </p>

      <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">
        此邮件由 Mobipium Monitor 自动发送
      </p>
    </div>
  `

  try {
    const result = await resend.emails.send({
      from: 'Mobipium Alerts <alerts@yourdomain.com>',
      to: ALERT_EMAIL,
      subject: `⚠️ Offer 异常告警: ${offerName}`,
      html,
    })

    console.log('Alert email sent:', result)
    return true
  } catch (error) {
    console.error('Failed to send alert email:', error)
    return false
  }
}

export async function sendTestEmail(): Promise<boolean> {
  if (!resend || !ALERT_EMAIL) {
    console.log('Cannot send test email: Resend or ALERT_EMAIL not configured')
    return false
  }

  try {
    await resend.emails.send({
      from: 'Mobipium Alerts <alerts@yourdomain.com>',
      to: ALERT_EMAIL,
      subject: '测试邮件 - Mobipium Monitor',
      html: '<p>这是一封测试邮件，确认邮件告警配置正常。</p>',
    })
    return true
  } catch (error) {
    console.error('Failed to send test email:', error)
    return false
  }
}
