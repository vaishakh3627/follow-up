const nodemailer = require("nodemailer");
const twilio = require("twilio");

function formatDateTime(isoDate) {
  return new Date(isoDate).toLocaleString();
}

function buildMessage(reminder) {
  return [
    `Follow-up reminder for ${reminder.client_name || "your client"}.`,
    `Planned date: ${formatDateTime(reminder.reminder_at)}`,
    reminder.email ? `Client email: ${reminder.email}` : null,
    reminder.phone ? `Client phone: ${reminder.phone}` : null,
    reminder.note_text ? `Note: ${reminder.note_text}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function detailRow(label, value) {
  if (!value) return "";
  return `
    <tr>
      <td style="padding: 8px 0; color:#667085; font-size: 13px; width: 140px;">${escapeHtml(label)}</td>
      <td style="padding: 8px 0; color:#101828; font-size: 14px; font-weight: 600;">${escapeHtml(value)}</td>
    </tr>
  `;
}

function buildEmailHtml(reminder) {
  const clientName = reminder.client_name || "Client";
  const plannedAt = formatDateTime(reminder.reminder_at);
  const noteText = reminder.note_text || "No additional note provided.";

  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f5f9;font-family:Inter,Arial,sans-serif;color:#101828;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f9;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:14px;border:1px solid #e4e7ec;overflow:hidden;">
            <tr>
              <td style="padding:18px 22px;background:linear-gradient(135deg,#2f66f5,#6f56d9);color:#fff;">
                <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.92;">Follow-Up Reminder</div>
                <div style="font-size:22px;font-weight:700;margin-top:4px;">${escapeHtml(clientName)}</div>
                <div style="font-size:14px;opacity:0.95;margin-top:6px;">Scheduled at ${escapeHtml(plannedAt)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 22px;">
                <p style="margin:0 0 12px;font-size:14px;color:#475467;">
                  This is your reminder to follow up with <strong>${escapeHtml(clientName)}</strong>.
                </p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  ${detailRow("Reminder Time", plannedAt)}
                  ${detailRow("Client Email", reminder.email)}
                  ${detailRow("Client Phone", reminder.phone)}
                  ${detailRow("Channel", reminder.notify_sms ? (reminder.notify_email ? "Email + SMS" : "SMS") : "Email")}
                </table>
                <div style="margin-top:16px;padding:14px;border:1px solid #e4e7ec;border-radius:10px;background:#f9fafb;">
                  <div style="font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#667085;margin-bottom:6px;">Note</div>
                  <div style="font-size:14px;color:#101828;line-height:1.45;">${escapeHtml(noteText)}</div>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 22px 18px;color:#98a2b3;font-size:12px;border-top:1px solid #f0f2f5;">
                Sent by Remindly follow-up system.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `;
}

function createTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

async function sendEmail(reminder) {
  const transporter = createTransporter();
  if (!transporter) {
    throw new Error("Email is not configured. Add SMTP_* values in .env.");
  }

  const targetEmail = reminder.alert_email_to || process.env.ALERT_EMAIL_TO || process.env.SMTP_USER;
  if (!targetEmail) {
    throw new Error("No ALERT_EMAIL_TO configured for reminder notifications.");
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: targetEmail,
    subject: `Follow-up reminder: ${reminder.client_name || "Client"}`,
    text: buildMessage(reminder),
    html: buildEmailHtml(reminder),
  });
}

async function sendSms(reminder) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error("SMS is not configured. Add TWILIO_* values in .env.");
  }

  const targetPhone = reminder.alert_phone_to || process.env.ALERT_PHONE_TO;
  if (!targetPhone) {
    throw new Error("No ALERT_PHONE_TO configured for reminder notifications.");
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: TWILIO_FROM_NUMBER,
    to: targetPhone,
    body: buildMessage(reminder),
  });
}

module.exports = {
  sendEmail,
  sendSms,
};
