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
const audioUpload = document.getElementById("audioUpload");
const uploadBtn = document.getElementById("uploadBtn");
const clearAudioBtn = document.getElementById("clearAudioBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");

let mediaRecorder = null;
let micStream = null;
let recordedBlob = null;
let recordedMimeType = "";
let audioChunks = [];
let previewUrl = "";
const PAGE_SIZE = 10;
let currentOffset = 0;

function updateRecordButtons() {
  const state = mediaRecorder?.state || "inactive";
  pauseBtn.disabled = state === "inactive";
  stopBtn.disabled = state === "inactive";
  pauseBtn.textContent = state === "paused" ? "Resume" : "Pause";
}

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
      <div class="audio-tools">
        <button type="button" class="page-btn delete-reminder-btn" data-id="${reminder.id}">Delete</button>
      </div>
    </article>
  `;
}

function clearRecordedAudio() {
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
  updateRecordButtons();
}

async function getOrCreateMicStream() {
  if (micStream && micStream.active) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({
    // Lower-latency capture: disable heavy voice processing that can cause startup clipping.
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      latency: 0,
    },
  });
  return micStream;
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
  if (mediaRecorder && mediaRecorder.state !== "inactive") return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
    renderMessage("Audio recording is not supported in this browser.", true);
    return;
  }

  try {
    clearRecordedAudio();
    recordStatus.textContent = "Starting recorder...";
    const stream = await getOrCreateMicStream();
    const preferred = getPreferredMimeType();
    mediaRecorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.addEventListener("start", () => {
      recordStatus.textContent = "Recording started. Speak now.";
    });

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

      micBtn.classList.remove("recording");
      mediaRecorder = null;
      updateRecordButtons();
    });

    // Start without timeslice to avoid browser-specific delayed chunk behavior.
    mediaRecorder.start();
    micBtn.classList.add("recording");
    renderMessage("");
    updateRecordButtons();
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
pauseBtn.addEventListener("click", () => {
  if (!mediaRecorder) return;
  if (mediaRecorder.state === "recording") {
    mediaRecorder.pause();
    recordStatus.textContent = "Recording paused.";
  } else if (mediaRecorder.state === "paused") {
    mediaRecorder.resume();
    recordStatus.textContent = "Recording resumed.";
  }
  updateRecordButtons();
});

stopBtn.addEventListener("click", () => {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  mediaRecorder.requestData();
  mediaRecorder.stop();
  recordStatus.textContent = "Processing recording...";
  updateRecordButtons();
});
uploadBtn.addEventListener("click", () => {
  audioUpload.click();
});

clearAudioBtn.addEventListener("click", () => {
  clearRecordedAudio();
  renderMessage("Audio cleared. Record or upload again.");
});

audioUpload.addEventListener("change", () => {
  const file = audioUpload.files?.[0];
  if (!file) return;

  clearRecordedAudio();
  recordedBlob = file;
  recordedMimeType = file.type || "audio/webm";
  previewUrl = URL.createObjectURL(file);
  recordedPreview.src = previewUrl;
  recordedPreview.classList.remove("hidden");
  recordStatus.textContent = `Using uploaded audio: ${file.name}`;
  renderMessage("");
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest(".delete-reminder-btn");
  if (!button) return;
  const id = button.dataset.id;
  if (!id) return;
  if (!window.confirm("Delete this pending reminder?")) return;

  try {
    const response = await fetch(`/api/reminders/${id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Failed to delete reminder.");
    }
    renderMessage("Pending reminder deleted.");
    await loadReminders();
  } catch (error) {
    renderMessage(error.message, true);
  }
});
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

window.addEventListener("beforeunload", () => {
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
  }
});

updateRecordButtons();
