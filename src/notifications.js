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

  const targetEmail = process.env.ALERT_EMAIL_TO || process.env.SMTP_USER;
  if (!targetEmail) {
    throw new Error("No ALERT_EMAIL_TO configured for reminder notifications.");
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: targetEmail,
    subject: `Follow-up reminder: ${reminder.client_name || "Client"}`,
    text: buildMessage(reminder),
  });
}

async function sendSms(reminder) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error("SMS is not configured. Add TWILIO_* values in .env.");
  }

  const targetPhone = process.env.ALERT_PHONE_TO;
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
