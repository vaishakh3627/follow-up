const { all, run } = require("./db");
const { computeTriggerAt } = require("./dateParser");
const { sendEmail, sendSms } = require("./notifications");

const RETRY_MINUTES = [1, 5, 15, 60];
const MAX_ATTEMPTS = 6;
let cycleInProgress = false;

function getRetryDelayMinutes(attempt) {
  return RETRY_MINUTES[Math.min(Math.max(attempt - 1, 0), RETRY_MINUTES.length - 1)];
}

function nextAttemptIso(attempt) {
  const delayMinutes = getRetryDelayMinutes(attempt);
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
}

function isMissingColumnError(error) {
  const message = error?.message || "";
  return message.includes("no such column");
}

async function safeRunWithFallback(primaryQuery, primaryParams, fallbackQuery, fallbackParams) {
  try {
    await run(primaryQuery, primaryParams);
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    await run(fallbackQuery, fallbackParams);
  }
}

async function loadPendingReminders() {
  try {
    return await all(
      `
        SELECT *
        FROM reminders
        WHERE
          status = 'pending'
          AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
      `
    );
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    return all(
      `
        SELECT *
        FROM reminders
        WHERE status = 'pending'
      `
    );
  }
}

async function processReminder(reminder) {
  let emailSent = reminder.email_sent;
  let smsSent = reminder.sms_sent;
  let lastError = null;
  const errors = [];

  if (reminder.notify_email && !reminder.email_sent) {
    try {
      await sendEmail(reminder);
      emailSent = 1;
      await safeRunWithFallback(
        `
          UPDATE reminders
          SET email_sent = 1, last_error = NULL
          WHERE id = ?
        `,
        [reminder.id],
        `
          UPDATE reminders
          SET email_sent = 1, last_error = NULL
          WHERE id = ?
        `,
        [reminder.id]
      );
    } catch (error) {
      errors.push(`email: ${error.message}`);
    }
  }

  if (reminder.notify_sms && !reminder.sms_sent) {
    try {
      await sendSms(reminder);
      smsSent = 1;
      await safeRunWithFallback(
        `
          UPDATE reminders
          SET sms_sent = 1, last_error = NULL
          WHERE id = ?
        `,
        [reminder.id],
        `
          UPDATE reminders
          SET sms_sent = 1, last_error = NULL
          WHERE id = ?
        `,
        [reminder.id]
      );
    } catch (error) {
      errors.push(`sms: ${error.message}`);
    }
  }

  const doneWithNotifications =
    (!reminder.notify_email || emailSent) && (!reminder.notify_sms || smsSent);

  if (doneWithNotifications) {
    await safeRunWithFallback(
      `
        UPDATE reminders
        SET
          email_sent = ?,
          sms_sent = ?,
          status = 'reminded',
          last_error = NULL,
          notified_at = datetime('now'),
          notification_attempts = ?,
          next_attempt_at = NULL
        WHERE id = ?
      `,
      [emailSent, smsSent, reminder.notification_attempts || 0, reminder.id]
      ,
      `
        UPDATE reminders
        SET email_sent = ?, sms_sent = ?, status = 'reminded', last_error = NULL
        WHERE id = ?
      `,
      [emailSent, smsSent, reminder.id]
    );
    return;
  }

  lastError = errors.join(" | ") || "Notification failed";
  const attempts = (reminder.notification_attempts || 0) + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  const nextAttempt = exhausted ? null : nextAttemptIso(attempts);

  await safeRunWithFallback(
    `
      UPDATE reminders
      SET
        email_sent = ?,
        sms_sent = ?,
        status = ?,
        last_error = ?,
        notification_attempts = ?,
        next_attempt_at = ?
      WHERE id = ?
    `,
    [emailSent, smsSent, exhausted ? "failed" : "pending", lastError, attempts, nextAttempt, reminder.id]
    ,
    `
      UPDATE reminders
      SET email_sent = ?, sms_sent = ?, status = ?, last_error = ?
      WHERE id = ?
    `,
    [emailSent, smsSent, exhausted ? "failed" : "pending", lastError, reminder.id]
  );
}

async function runNotificationCycle() {
  const pending = await loadPendingReminders();

  const now = new Date();
  for (const reminder of pending) {
    const triggerAt = computeTriggerAt(reminder.reminder_at, reminder.notify_timing, reminder.reminder_input);
    if (!triggerAt) continue;
    if (triggerAt <= now) {
      const claimResult = await run(
        `
          UPDATE reminders
          SET status = 'processing'
          WHERE
            id = ?
            AND status = 'pending'
            AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
        `,
        [reminder.id]
      );
      if (!claimResult?.changes) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await processReminder({ ...reminder, status: "processing" });
    }
  }
}

function startScheduler() {
  const runSafeCycle = async () => {
    if (cycleInProgress) return;
    cycleInProgress = true;
    try {
      await runNotificationCycle();
    } catch (error) {
      // Keep scheduler alive even if one cycle fails.
      console.error("Scheduler cycle failed:", error.message);
    } finally {
      cycleInProgress = false;
    }
  };

  // Single worker loop to avoid duplicate trigger races.
  setInterval(runSafeCycle, 15000);
}

module.exports = {
  startScheduler,
  runNotificationCycle,
};
