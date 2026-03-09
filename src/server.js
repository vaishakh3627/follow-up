require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { initializeDb, run, all, get } = require("./db");
const { parseReminderDate } = require("./dateParser");
const { startScheduler, runNotificationCycle } = require("./scheduler");
const { extractReminderDetails, resolveReminderDateWithAi } = require("./aiExtractor");

const app = express();
const PORT = Number(process.env.PORT || 3000);

function parseAiDateIso(value, { mustBeFuture = false } = {}) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T09:00:00` : raw;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return null;
  if (mustBeFuture && date.getTime() <= Date.now()) return null;
  return date;
}

const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(null, `${Date.now()}_${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const allowedExtensions = new Set([".webm", ".wav", ".ogg", ".m4a", ".mp3", ".mp4", ".aac"]);
    const hasAudioMime = (file.mimetype || "").startsWith("audio/");
    const hasKnownAudioExt = allowedExtensions.has(extension);

    if (!hasAudioMime && !hasKnownAudioExt) {
      cb(new Error("Only audio files are allowed."));
      return;
    }
    cb(null, true);
  },
});

initializeDb();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "follow-up-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(path.join(__dirname, "..", "public")));

function withoutSensitiveUserFields(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    alert_email_to: user.alert_email_to,
    alert_phone_to: user.alert_phone_to,
    created_at: user.created_at,
  };
}

async function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const user = await get("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) {
    req.session.userId = null;
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.currentUser = user;
  return next();
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "follow-up-reminder" });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, alertEmail, alertPhone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required." });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const existing = await get("SELECT id FROM users WHERE email = ?", [String(email).trim().toLowerCase()]);
    if (existing) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const result = await run(
      `
      INSERT INTO users (name, email, password_hash, alert_email_to, alert_phone_to)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        String(name).trim(),
        String(email).trim().toLowerCase(),
        passwordHash,
        String(alertEmail || email).trim().toLowerCase(),
        String(alertPhone || "").trim() || null,
      ]
    );

    req.session.userId = result.lastID;
    const user = await get("SELECT * FROM users WHERE id = ?", [result.lastID]);
    return res.status(201).json({ user: withoutSensitiveUserFields(user) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await get("SELECT * FROM users WHERE email = ?", [String(email).trim().toLowerCase()]);
    if (!user) return res.status(401).json({ error: "Invalid credentials." });

    const isValid = await bcrypt.compare(String(password), user.password_hash);
    if (!isValid) return res.status(401).json({ error: "Invalid credentials." });

    req.session.userId = user.id;
    return res.json({ user: withoutSensitiveUserFields(user) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const user = await get("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  return res.json({ user: withoutSensitiveUserFields(user) });
});

app.patch("/api/auth/profile", requireAuth, async (req, res) => {
  try {
    const { name, alertEmail, alertPhone } = req.body;
    const resolvedName = String(name || req.currentUser.name).trim();
    const resolvedAlertEmail = String(alertEmail || req.currentUser.alert_email_to).trim().toLowerCase();
    const resolvedAlertPhone = String(alertPhone || "").trim() || null;
    if (!resolvedName || !resolvedAlertEmail) {
      return res.status(400).json({ error: "Name and alert email are required." });
    }

    await run(
      `
      UPDATE users
      SET name = ?, alert_email_to = ?, alert_phone_to = ?
      WHERE id = ?
      `,
      [resolvedName, resolvedAlertEmail, resolvedAlertPhone, req.currentUser.id]
    );
    const updated = await get("SELECT * FROM users WHERE id = ?", [req.currentUser.id]);
    return res.json({ user: withoutSensitiveUserFields(updated) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/reminders", requireAuth, async (req, res) => {
  try {
    const view = String(req.query.view || "all").toLowerCase();
    const limitRaw = Number(req.query.limit);
    const offsetRaw = Number(req.query.offset);
    const hasPagination = Number.isFinite(limitRaw) || Number.isFinite(offsetRaw);

    const whereParts = ["user_id = ?"];
    const whereParams = [req.currentUser.id];
    if (view === "active") {
      whereParts.push("status = 'pending'");
      whereParts.push("datetime(reminder_at) >= datetime('now')");
    } else if (view === "reminded") {
      whereParts.push("status = 'reminded'");
    } else if (view === "failed") {
      whereParts.push("status = 'failed'");
    }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    if (!hasPagination) {
      const reminders = await all(
        `
        SELECT *
        FROM reminders
        ${whereClause}
        ORDER BY datetime(created_at) DESC
        `,
        whereParams
      );
      return res.json(reminders);
    }

    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 10;
    const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0;
    const items = await all(
      `
      SELECT *
      FROM reminders
      ${whereClause}
      ORDER BY datetime(created_at) DESC
      LIMIT ? OFFSET ?
      `,
      [...whereParams, limit, offset]
    );
    const totalRow = await get(
      `
      SELECT COUNT(*) as total
      FROM reminders
      ${whereClause}
      `,
      whereParams
    );
    const total = totalRow?.total || 0;

    return res.json({
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/reminders", requireAuth, upload.single("audio"), async (req, res) => {
  try {
    const { quickInput = "" } = req.body;
    if (!quickInput.trim() && !req.file) {
      return res.status(400).json({ error: "Please add a quick note or an audio message." });
    }

    const aiData = await extractReminderDetails({
      quickInput,
      audioFilePath: req.file ? req.file.path : null,
      audioMimeType: req.file ? req.file.mimetype : null,
    });

    const isAudioOnlyRequest = !quickInput.trim() && Boolean(req.file);
    if (isAudioOnlyRequest && !aiData.usedAi) {
      return res.status(502).json({
        error:
          "Audio transcription failed because AI extraction is unavailable right now. Please retry or add a short text note with the audio.",
        details: aiData.aiReason,
      });
    }

    const reminderSource = aiData.reminderPhrase || quickInput;
    const aiResolvedDate = parseAiDateIso(aiData.reminderDateIso, { mustBeFuture: true });
    const parsed = parseReminderDate(reminderSource);
    const aiFallbackDateIso =
      !aiResolvedDate && !parsed.date
        ? await resolveReminderDateWithAi({
            reminderText: `${quickInput}\n${reminderSource}`,
            nowIso: new Date().toISOString(),
          })
        : "";
    const aiFallbackDate = parseAiDateIso(aiFallbackDateIso, { mustBeFuture: true });
    const finalDate = aiResolvedDate || parsed.date || aiFallbackDate;
    const acceptedAiDateIso = aiResolvedDate ? aiResolvedDate.toISOString() : aiFallbackDate ? aiFallbackDate.toISOString() : "";
    if (!finalDate) {
      return res.status(400).json({
        error: "Could not extract a reminder date. Please include any time hint, festival, weekday, or date phrase.",
        details: aiData.aiReason,
      });
    }

    const wantsEmail = aiData.notifyChannel === "email" || aiData.notifyChannel === "both";
    const wantsSms = aiData.notifyChannel === "sms" || aiData.notifyChannel === "both";
    const notifyEmail = wantsEmail || !wantsSms ? 1 : 0;
    const notifySms = wantsSms ? 1 : 0;

    const filePath = req.file ? `/uploads/${req.file.filename}` : null;
    const resolvedNote = aiData.noteText || quickInput || "Audio follow-up reminder";

    const result = await run(
      `
      INSERT INTO reminders (
        user_id, client_name, email, phone, note_text, audio_path,
        reminder_input, reminder_at, notify_email, notify_sms, notify_timing, alert_email_to, alert_phone_to
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        req.currentUser.id,
        aiData.clientName || null,
        aiData.email || null,
        aiData.phone || null,
        resolvedNote,
        filePath,
        reminderSource,
        finalDate.toISOString(),
        notifyEmail,
        notifySms,
        aiData.notifyTiming || "morning_of",
        req.currentUser.alert_email_to,
        req.currentUser.alert_phone_to || null,
      ]
    );

    const saved = await get("SELECT * FROM reminders WHERE id = ?", [result.lastID]);
    const extracted = {
      clientName: aiData.clientName || "",
      email: aiData.email || "",
      phone: aiData.phone || "",
      noteText: resolvedNote,
      reminderPhrase: reminderSource,
      reminderAt: finalDate.toISOString(),
      reminderDateIsoFromAi: acceptedAiDateIso,
      notifyChannel: wantsEmail && wantsSms ? "both" : wantsSms ? "sms" : "email",
      notifyTiming: aiData.notifyTiming || "morning_of",
    };

    return res.status(201).json({
      reminder: saved,
      extraction: {
        aiUsed: aiData.usedAi,
        details: aiData.aiReason,
        extracted,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.patch("/api/reminders/:id/complete", requireAuth, async (req, res) => {
  try {
    await run("UPDATE reminders SET status = 'reminded', notified_at = datetime('now') WHERE id = ? AND user_id = ?", [
      req.params.id,
      req.currentUser.id,
    ]);
    const updated = await get("SELECT * FROM reminders WHERE id = ? AND user_id = ?", [req.params.id, req.currentUser.id]);
    if (!updated) return res.status(404).json({ error: "Reminder not found" });
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/api/reminders/:id", requireAuth, async (req, res) => {
  try {
    const existing = await get("SELECT * FROM reminders WHERE id = ? AND user_id = ?", [req.params.id, req.currentUser.id]);
    if (!existing) return res.status(404).json({ error: "Reminder not found" });

    await run("DELETE FROM reminders WHERE id = ? AND user_id = ?", [req.params.id, req.currentUser.id]);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/reminders/cleanup-past", requireAuth, async (req, res) => {
  try {
    const before = await get("SELECT COUNT(*) as total FROM reminders WHERE user_id = ?", [req.currentUser.id]);
    await run("DELETE FROM reminders WHERE user_id = ? AND datetime(reminder_at) < datetime('now')", [req.currentUser.id]);
    const after = await get("SELECT COUNT(*) as total FROM reminders WHERE user_id = ?", [req.currentUser.id]);
    const removed = Math.max((before?.total || 0) - (after?.total || 0), 0);
    return res.json({ ok: true, removed });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message || "Upload failed." });
  }
  return next();
});

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startScheduler();
  try {
    await runNotificationCycle();
  } catch (error) {
    console.error("Initial notification cycle failed:", error.message);
  }
});
