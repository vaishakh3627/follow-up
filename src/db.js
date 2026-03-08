const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = path.join(__dirname, "..", "data", "reminders.db");
const db = new sqlite3.Database(dbPath);

function initializeDb() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_name TEXT,
        email TEXT,
        phone TEXT,
        note_text TEXT,
        audio_path TEXT,
        reminder_input TEXT NOT NULL,
        reminder_at TEXT NOT NULL,
        notify_email INTEGER DEFAULT 1,
        notify_sms INTEGER DEFAULT 0,
        notify_timing TEXT DEFAULT 'morning_of',
        email_sent INTEGER DEFAULT 0,
        sms_sent INTEGER DEFAULT 0,
        notification_attempts INTEGER DEFAULT 0,
        next_attempt_at TEXT DEFAULT (datetime('now')),
        notified_at TEXT,
        status TEXT DEFAULT 'pending',
        last_error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    // Backward-compatible schema migration for existing databases.
    db.all("PRAGMA table_info(reminders)", [], (pragmaError, columns) => {
      if (pragmaError) return;
      const hasColumn = (name) => (columns || []).some((column) => column.name === name);

      const ensureAttempts = (done) => {
        if (hasColumn("notification_attempts")) return done();
        return db.run("ALTER TABLE reminders ADD COLUMN notification_attempts INTEGER DEFAULT 0", () => done());
      };

      const ensureNextAttempt = (done) => {
        if (hasColumn("next_attempt_at")) return done();
        return db.run("ALTER TABLE reminders ADD COLUMN next_attempt_at TEXT", () => done());
      };

      const ensureNotifiedAt = (done) => {
        if (hasColumn("notified_at")) return done();
        return db.run("ALTER TABLE reminders ADD COLUMN notified_at TEXT", () => done());
      };

      ensureAttempts(() => {
        ensureNextAttempt(() => {
          ensureNotifiedAt(() => {
            db.run("UPDATE reminders SET status = 'reminded' WHERE status = 'completed'", () => {});
            db.run("UPDATE reminders SET next_attempt_at = datetime('now') WHERE next_attempt_at IS NULL", () => {});
            db.run("UPDATE reminders SET notification_attempts = 0 WHERE notification_attempts IS NULL", () => {});
          });
        });
      });
    });
  });
}

function run(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function onResult(error) {
      if (error) return reject(error);
      return resolve(this);
    });
  });
}

function get(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (error, row) => {
      if (error) return reject(error);
      return resolve(row);
    });
  });
}

function all(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (error, rows) => {
      if (error) return reject(error);
      return resolve(rows);
    });
  });
}

module.exports = {
  db,
  initializeDb,
  run,
  get,
  all,
};
