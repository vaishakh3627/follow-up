const form = document.getElementById("reminderForm");
const list = document.getElementById("reminderList");
const message = document.getElementById("message");
const startRecordBtn = document.getElementById("startRecordBtn");
const stopRecordBtn = document.getElementById("stopRecordBtn");
const clearRecordBtn = document.getElementById("clearRecordBtn");
const recordStatus = document.getElementById("recordStatus");
const recordedPreview = document.getElementById("recordedPreview");
const audioFileInput = form.elements.audio;
const lastSaved = document.getElementById("lastSaved");

let mediaRecorder = null;
let recordingStream = null;
let audioChunks = [];
let recordedBlob = null;
let recordedObjectUrl = "";
let recordedMimeType = "";

function renderMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#c53030" : "#18794e";
}

function escapeHtml(value) {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTiming(value) {
  return value === "one_day_before" ? "1 day before (9 AM)" : "Morning of date";
}

function updateRecorderState({ isRecording = false, canClear = false }) {
  startRecordBtn.disabled = isRecording;
  stopRecordBtn.disabled = !isRecording;
  clearRecordBtn.disabled = !canClear;
}

function getPreferredMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
}

function extensionFromMimeType(mimeType) {
  if (!mimeType) return "webm";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function resetRecorderState() {
  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop());
    recordingStream = null;
  }

  audioChunks = [];
  recordedBlob = null;
  recordedMimeType = "";
  if (recordedObjectUrl) {
    URL.revokeObjectURL(recordedObjectUrl);
    recordedObjectUrl = "";
  }
  recordedPreview.src = "";
  recordedPreview.classList.add("hidden");
  recordStatus.textContent = "Recorder idle.";
  updateRecorderState({ isRecording: false, canClear: false });
}

function reminderCard(reminder) {
  const dateText = new Date(reminder.reminder_at).toLocaleString();
  const note = reminder.note_text ? `<p><strong>Note:</strong> ${escapeHtml(reminder.note_text)}</p>` : "";
  const audio = reminder.audio_path
    ? `<audio controls src="${reminder.audio_path}" style="margin-top:6px;width:100%"></audio>`
    : "";
  const errorText = reminder.last_error ? `<p style="color:#c53030"><strong>Error:</strong> ${escapeHtml(reminder.last_error)}</p>` : "";

  return `
    <article class="item">
      <p><strong>${escapeHtml(reminder.client_name || "Unnamed client")}</strong></p>
      <p class="meta">When: ${dateText}</p>
      <p class="meta">Extracted phrase: ${escapeHtml(reminder.reminder_input)}</p>
      <p class="meta">Notify: ${reminder.notify_email ? "Email" : ""} ${reminder.notify_sms ? "SMS" : ""} (${formatTiming(reminder.notify_timing)})</p>
      ${note}
      ${audio}
      ${errorText}
      <p class="meta">Status: ${escapeHtml(reminder.status)}</p>
    </article>
  `;
}

function renderSavedDetails(saved, extraction) {
  const parsed = extraction?.extracted || {};
  const when = saved?.reminder_at ? new Date(saved.reminder_at).toLocaleString() : "N/A";
  const channel = parsed.notifyChannel || (saved?.notify_sms ? (saved?.notify_email ? "both" : "sms") : "email");
  const timing = formatTiming(parsed.notifyTiming || saved?.notify_timing || "morning_of");

  lastSaved.innerHTML = `
    <h3>Saved Reminder Details</h3>
    <p><strong>AI Used:</strong> ${extraction?.aiUsed ? "Yes (Gemini)" : "Fallback parser"}</p>
    <p><strong>AI Details:</strong> ${escapeHtml(extraction?.details || "N/A")}</p>
    <p><strong>Client:</strong> ${escapeHtml(parsed.clientName || saved?.client_name || "Not provided")}</p>
    <p><strong>Reminder Phrase:</strong> ${escapeHtml(parsed.reminderPhrase || saved?.reminder_input || "")}</p>
    <p><strong>Scheduled At:</strong> ${when}</p>
    <p><strong>Notification Channel:</strong> ${escapeHtml(channel)}</p>
    <p><strong>Notification Timing:</strong> ${escapeHtml(timing)}</p>
    <p><strong>Saved Note:</strong> ${escapeHtml(parsed.noteText || saved?.note_text || "")}</p>
  `;
  lastSaved.classList.remove("hidden");
}

async function loadReminders() {
  const response = await fetch("/api/reminders");
  const reminders = await response.json();
  const pending = reminders.filter((item) => item.status === "pending");
  list.innerHTML = pending.length ? pending.map(reminderCard).join("") : "<p>No pending reminders.</p>";
}

startRecordBtn.addEventListener("click", async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
      renderMessage("Audio recording is not supported in this browser.", true);
      return;
    }

    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredMimeType = getPreferredMimeType();
    mediaRecorder = preferredMimeType
      ? new MediaRecorder(recordingStream, { mimeType: preferredMimeType })
      : new MediaRecorder(recordingStream);
    audioChunks = [];

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("error", (event) => {
      const reason = event?.error?.message || "Unknown recorder error";
      renderMessage(`Recording failed: ${reason}`, true);
      resetRecorderState();
    });

    mediaRecorder.addEventListener("stop", () => {
      if (audioChunks.length) {
        recordedMimeType = mediaRecorder.mimeType || preferredMimeType || "audio/webm";
        recordedBlob = new Blob(audioChunks, { type: recordedMimeType });
        if (recordedObjectUrl) {
          URL.revokeObjectURL(recordedObjectUrl);
        }
        recordedObjectUrl = URL.createObjectURL(recordedBlob);
        recordedPreview.src = recordedObjectUrl;
        recordedPreview.classList.remove("hidden");
        recordStatus.textContent = "Recording ready. It will be sent when you save.";
        updateRecorderState({ isRecording: false, canClear: true });
      } else {
        resetRecorderState();
      }

      if (recordingStream) {
        recordingStream.getTracks().forEach((track) => track.stop());
        recordingStream = null;
      }
      mediaRecorder = null;
    });

    mediaRecorder.start(1000);
    recordStatus.textContent = "Recording... click Stop when done.";
    updateRecorderState({ isRecording: true, canClear: false });
  } catch (error) {
    renderMessage(`Microphone access failed: ${error.message}`, true);
    resetRecorderState();
  }
});

stopRecordBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.requestData();
    mediaRecorder.stop();
  }
});

clearRecordBtn.addEventListener("click", () => {
  resetRecorderState();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (mediaRecorder && mediaRecorder.state === "recording") {
    renderMessage("Please stop recording before saving.", true);
    return;
  }
  renderMessage("Analyzing note/audio with AI and saving...");

  const data = new FormData(form);
  if (recordedBlob) {
    audioFileInput.value = "";
    const extension = extensionFromMimeType(recordedMimeType);
    const filename = `recorded-note-${Date.now()}.${extension}`;
    data.set("audio", recordedBlob, filename);
  }

  const response = await fetch("/api/reminders", {
    method: "POST",
    body: data,
  });
  const result = await response.json();

  if (!response.ok) {
    const extra = result.details ? ` (${result.details})` : "";
    renderMessage((result.error || "Failed to save reminder.") + extra, true);
    return;
  }

  const saved = result.reminder || result;
  const mode = result.extraction?.aiUsed ? "Gemini AI" : "fallback parser";
  form.reset();
  resetRecorderState();
  renderMessage(`Reminder saved for ${new Date(saved.reminder_at).toLocaleString()} (${mode}).`);
  renderSavedDetails(saved, result.extraction);
  await loadReminders();
});

loadReminders().catch(() => {
  renderMessage("Failed to load reminders.", true);
});
