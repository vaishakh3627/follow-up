const cron = require("node-cron");
const { all, run } = require("./db");
const { computeTriggerAt } = require("./dateParser");
const { sendEmail, sendSms } = require("./notifications");

async function processReminder(reminder) {
  let emailSent = reminder.email_sent;
  let smsSent = reminder.sms_sent;
  let lastError = null;

  try {
    if (reminder.notify_email && !reminder.email_sent) {
      await sendEmail(reminder);
      emailSent = 1;
    }

    if (reminder.notify_sms && !reminder.sms_sent) {
      await sendSms(reminder);
      smsSent = 1;
    }
  } catch (error) {
    lastError = error.message;
  }

  const doneWithNotifications =
    (!reminder.notify_email || emailSent) && (!reminder.notify_sms || smsSent);

  await run(
    `
      UPDATE reminders
      SET email_sent = ?, sms_sent = ?, status = ?, last_error = ?
      WHERE id = ?
    `,
    [emailSent, smsSent, doneWithNotifications ? "completed" : "pending", lastError, reminder.id]
  );
}

async function runNotificationCycle() {
  const pending = await all(
    `
      SELECT *
      FROM reminders
      WHERE status = 'pending'
    `
  );

  const now = new Date();
  for (const reminder of pending) {
    const triggerAt = computeTriggerAt(reminder.reminder_at, reminder.notify_timing);
    if (!triggerAt) continue;
    if (triggerAt <= now) {
      // eslint-disable-next-line no-await-in-loop
      await processReminder(reminder);
    }
  }
}

function startScheduler() {
  cron.schedule("*/1 * * * *", async () => {
    try {
      await runNotificationCycle();
    } catch (error) {
      // Keep scheduler alive even if one cycle fails.
      console.error("Scheduler cycle failed:", error.message);
    }
  });
}

module.exports = {
  startScheduler,
  runNotificationCycle,
};
