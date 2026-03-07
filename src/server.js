require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
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
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "follow-up-reminder" });
});

app.get("/api/reminders", async (req, res) => {
  try {
    const reminders = await all(
      `
      SELECT *
      FROM reminders
      ORDER BY datetime(created_at) DESC
      `
    );
    res.json(reminders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/reminders", upload.single("audio"), async (req, res) => {
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
        client_name, email, phone, note_text, audio_path,
        reminder_input, reminder_at, notify_email, notify_sms, notify_timing
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
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

app.patch("/api/reminders/:id/complete", async (req, res) => {
  try {
    await run("UPDATE reminders SET status = 'completed' WHERE id = ?", [req.params.id]);
    const updated = await get("SELECT * FROM reminders WHERE id = ?", [req.params.id]);
    if (!updated) return res.status(404).json({ error: "Reminder not found" });
    return res.json(updated);
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
  await runNotificationCycle();
});
