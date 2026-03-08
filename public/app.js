const form = document.getElementById("captureForm");
const quickInput = document.getElementById("quickInput");
const micBtn = document.getElementById("micBtn");
const sendBtn = document.getElementById("sendBtn");
const recordStatus = document.getElementById("recordStatus");
const recordedPreview = document.getElementById("recordedPreview");
const message = document.getElementById("message");
const reminderList = document.getElementById("reminderList");
const remindedList = document.getElementById("remindedList");
const upcomingCount = document.getElementById("upcomingCount");
const savedCard = document.getElementById("savedCard");
const lastSaved = document.getElementById("lastSaved");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageInfo = document.getElementById("pageInfo");

let mediaRecorder = null;
let recordingStream = null;
let recordedBlob = null;
let recordedMimeType = "";
let audioChunks = [];
let previewUrl = "";
const PAGE_SIZE = 10;
let currentOffset = 0;

function renderMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#cc3b31" : "#2f6a43";
}

function escapeHtml(value) {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatReminderTime(iso) {
  const target = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrow = today + 86400000;
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const time = target.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (targetDay === today) return `Today, ${time}`;
  if (targetDay === tomorrow) return `Tomorrow, ${time}`;
  return `${target.toLocaleDateString()}, ${time}`;
}

function reminderCard(reminder) {
  const title = reminder.client_name || reminder.note_text || "Reminder";
  return `
    <article class="reminder-item">
      <p class="reminder-title">${escapeHtml(title)}</p>
      <p class="reminder-note">${escapeHtml(reminder.reminder_input || "")}</p>
      <p class="reminder-when">🔔 ${formatReminderTime(reminder.reminder_at)}</p>
    </article>
  `;
}

function clearRecordedAudio() {
  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop());
    recordingStream = null;
  }
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = "";
  }
  recordedBlob = null;
  recordedMimeType = "";
  audioChunks = [];
  recordedPreview.src = "";
  recordedPreview.classList.add("hidden");
  micBtn.classList.remove("recording");
  recordStatus.textContent = "Recorder idle.";
}

function getPreferredMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  return options.find((item) => MediaRecorder.isTypeSupported(item)) || "";
}

function extensionFromMimeType(mimeType) {
  if (!mimeType) return "webm";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

async function loadReminders() {
  const [activeResponse, remindedResponse] = await Promise.all([
    fetch(`/api/reminders?view=active&limit=${PAGE_SIZE}&offset=${currentOffset}`),
    fetch("/api/reminders?view=reminded&limit=10&offset=0"),
  ]);

  const payload = await activeResponse.json();
  const remindedPayload = await remindedResponse.json();

  const items = Array.isArray(payload) ? payload : payload.items || [];
  const total = Array.isArray(payload) ? items.length : payload.total || 0;
  const limit = Array.isArray(payload) ? PAGE_SIZE : payload.limit || PAGE_SIZE;
  const offset = Array.isArray(payload) ? currentOffset : payload.offset || 0;
  const remindedItems = Array.isArray(remindedPayload) ? remindedPayload : remindedPayload.items || [];

  upcomingCount.textContent = String(total);
  reminderList.innerHTML = items.length ? items.map(reminderCard).join("") : "<p>No active reminders.</p>";
  remindedList.innerHTML = remindedItems.length
    ? remindedItems.map(reminderCard).join("")
    : "<p>No reminded items yet.</p>";

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  prevPageBtn.disabled = offset <= 0;
  nextPageBtn.disabled = offset + items.length >= total;
}

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.requestData();
    mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
    renderMessage("Audio recording is not supported in this browser.", true);
    return;
  }

  try {
    clearRecordedAudio();
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferred = getPreferredMimeType();
    mediaRecorder = preferred ? new MediaRecorder(recordingStream, { mimeType: preferred }) : new MediaRecorder(recordingStream);
    audioChunks = [];

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) audioChunks.push(event.data);
    });

    mediaRecorder.addEventListener("stop", () => {
      if (audioChunks.length) {
        recordedMimeType = mediaRecorder.mimeType || preferred || "audio/webm";
        recordedBlob = new Blob(audioChunks, { type: recordedMimeType });
        previewUrl = URL.createObjectURL(recordedBlob);
        recordedPreview.src = previewUrl;
        recordedPreview.classList.remove("hidden");
        recordStatus.textContent = "Recording ready. Tap send to save.";
      } else {
        recordStatus.textContent = "No audio detected.";
      }

      if (recordingStream) {
        recordingStream.getTracks().forEach((track) => track.stop());
        recordingStream = null;
      }
      micBtn.classList.remove("recording");
      mediaRecorder = null;
    });

    mediaRecorder.start(1000);
    micBtn.classList.add("recording");
    recordStatus.textContent = "Recording... tap mic again to stop.";
    renderMessage("");
  } catch (error) {
    renderMessage(`Microphone error: ${error.message}`, true);
    clearRecordedAudio();
  }
}

function renderSavedDetails(saved, extraction) {
  const parsed = extraction?.extracted || {};
  lastSaved.innerHTML = `
    <p><strong>AI Used:</strong> ${extraction?.aiUsed ? "Gemini" : "Fallback parser"}</p>
    <p><strong>Phrase:</strong> ${escapeHtml(parsed.reminderPhrase || saved?.reminder_input || "")}</p>
    <p><strong>Scheduled:</strong> ${new Date(saved.reminder_at).toLocaleString()}</p>
  `;
  savedCard.classList.remove("hidden");
}

micBtn.addEventListener("click", toggleRecording);
prevPageBtn.addEventListener("click", async () => {
  currentOffset = Math.max(currentOffset - PAGE_SIZE, 0);
  await loadReminders();
});

nextPageBtn.addEventListener("click", async () => {
  currentOffset += PAGE_SIZE;
  await loadReminders();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (mediaRecorder && mediaRecorder.state === "recording") {
    renderMessage("Stop recording first.", true);
    return;
  }

  const text = quickInput.value.trim();
  if (!text && !recordedBlob) {
    renderMessage("Type a reminder or record audio first.", true);
    return;
  }

  sendBtn.disabled = true;
  renderMessage("Saving reminder...");

  try {
    const data = new FormData();
    data.set("quickInput", text);
    if (recordedBlob) {
      const ext = extensionFromMimeType(recordedMimeType);
      data.set("audio", recordedBlob, `voice-note-${Date.now()}.${ext}`);
    }

    const response = await fetch("/api/reminders", { method: "POST", body: data });
    const result = await response.json();
    if (!response.ok) {
      const extra = result.details ? ` (${result.details})` : "";
      throw new Error((result.error || "Failed to save reminder.") + extra);
    }

    const saved = result.reminder || result;
    quickInput.value = "";
    clearRecordedAudio();
    renderMessage(`Saved for ${formatReminderTime(saved.reminder_at)}.`);
    renderSavedDetails(saved, result.extraction);
    currentOffset = 0;
    await loadReminders();
  } catch (error) {
    renderMessage(error.message, true);
  } finally {
    sendBtn.disabled = false;
  }
});

loadReminders().catch(() => {
  renderMessage("Failed to load reminders.", true);
});
