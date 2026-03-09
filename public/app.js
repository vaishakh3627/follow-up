const authCard = document.getElementById("authCard");
const appContainer = document.getElementById("appContainer");
const authMessage = document.getElementById("authMessage");
const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const showRegisterBtn = document.getElementById("showRegisterBtn");
const showLoginBtn = document.getElementById("showLoginBtn");
const profileForm = document.getElementById("profileForm");
const logoutBtn = document.getElementById("logoutBtn");
const navDashboard = document.getElementById("navDashboard");
const navProfile = document.getElementById("navProfile");
const dashboardPage = document.getElementById("dashboardPage");
const profilePage = document.getElementById("profilePage");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileInitials = document.getElementById("profileInitials");
const profileMessage = document.getElementById("profileMessage");

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

let currentUser = null;
let mediaRecorder = null;
let micStream = null;
let recordedBlob = null;
let recordedMimeType = "";
let audioChunks = [];
let previewUrl = "";
const PAGE_SIZE = 10;
let currentOffset = 0;

function renderMessage(text, isError = false) {
  if (!message) return;
  message.textContent = text;
  message.style.color = isError ? "#dc2626" : "#166534";
  if (text) {
    message.style.background = isError ? "#fee2e2" : "#f0fdf4";
    message.style.border = isError ? "1px solid #fecaca" : "1px solid #bbf7d0";
  }
}

function renderAuthMessage(text, isError = false) {
  if (!authMessage) return;
  authMessage.textContent = text;
  authMessage.style.color = isError ? "#dc2626" : "#166534";
  if (text) {
    authMessage.style.background = isError ? "#fee2e2" : "#f0fdf4";
    authMessage.style.border = isError ? "1px solid #fecaca" : "1px solid #bbf7d0";
    authMessage.style.padding = "8px 12px";
    authMessage.style.borderRadius = "8px";
  }
}

function setAppAuthenticated(isAuthenticated) {
  authCard.classList.toggle("hidden", isAuthenticated);
  appContainer.classList.toggle("hidden", !isAuthenticated);
  if (!isAuthenticated) {
    savedCard?.classList.add("hidden");
    showPage("dashboard");
  }
}

function showPage(page) {
  const isDashboard = page === "dashboard";
  dashboardPage.classList.toggle("hidden", !isDashboard);
  profilePage.classList.toggle("hidden", isDashboard);
  navDashboard.classList.toggle("active-nav-tab", isDashboard);
  navProfile.classList.toggle("active-nav-tab", !isDashboard);
}

function showAuthMode(mode) {
  const isRegister = mode === "register";
  registerForm.classList.toggle("hidden", !isRegister);
  loginForm.classList.toggle("hidden", isRegister);
  showRegisterBtn.classList.toggle("active-tab", isRegister);
  showLoginBtn.classList.toggle("active-tab", !isRegister);
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

function updateRecordButtons() {
  const state = mediaRecorder?.state || "inactive";
  pauseBtn.disabled = state === "inactive";
  stopBtn.disabled = state === "inactive";
  pauseBtn.textContent = state === "paused" ? "Resume" : "Pause";
}

function reminderCard(reminder) {
  const title = reminder.client_name || reminder.note_text || "Reminder";
  return `
    <article class="reminder-item">
      <p class="reminder-title">${escapeHtml(title)}</p>
      <p class="reminder-note">${escapeHtml(reminder.reminder_input || "")}</p>
      <p class="reminder-when">🔔 ${formatReminderTime(reminder.reminder_at)}</p>
      <div class="audio-tools">
        <button type="button" class="btn-secondary delete-reminder-btn" data-id="${reminder.id}">Delete</button>
      </div>
    </article>
  `;
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function fetchMe() {
  try {
    const data = await apiFetch("/api/auth/me");
    currentUser = data.user;
    return data.user;
  } catch (error) {
    currentUser = null;
    return null;
  }
}

function bindProfile(user) {
  currentUser = user;
  // Update profile page display
  if (profileName) profileName.textContent = user.name || "User";
  if (profileEmail) profileEmail.textContent = user.email || "";
  if (profileInitials) {
    const initials = (user.name || "U")
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
    profileInitials.textContent = initials || "U";
  }
  // Update profile form
  if (profileForm) {
    const nameInput = document.getElementById("profileNameInput");
    const emailInput = document.getElementById("profileEmailInput");
    const alertEmailInput = document.getElementById("profileAlertEmailInput");
    const alertPhoneInput = document.getElementById("profileAlertPhoneInput");
    if (nameInput) nameInput.value = user.name || "";
    if (emailInput) emailInput.value = user.email || "";
    if (alertEmailInput) alertEmailInput.value = user.alert_email_to || "";
    if (alertPhoneInput) alertPhoneInput.value = user.alert_phone_to || "";
  }
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
  if (!currentUser) return;
  const [activePayload, remindedPayload] = await Promise.all([
    apiFetch(`/api/reminders?view=active&limit=${PAGE_SIZE}&offset=${currentOffset}`),
    apiFetch("/api/reminders?view=reminded&limit=10&offset=0"),
  ]);

  const items = activePayload.items || [];
  const total = activePayload.total || 0;
  const limit = activePayload.limit || PAGE_SIZE;
  const offset = activePayload.offset || 0;
  const remindedItems = remindedPayload.items || [];

  upcomingCount.textContent = String(total);
  reminderList.innerHTML = items.length ? items.map(reminderCard).join("") : "<p>No active reminders.</p>";
  remindedList.innerHTML = remindedItems.length ? remindedItems.map(reminderCard).join("") : "<p>No reminded items yet.</p>";

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

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = {
      name: registerForm.elements.name.value.trim(),
      email: registerForm.elements.email.value.trim(),
      password: registerForm.elements.password.value,
      alertEmail: registerForm.elements.alertEmail.value.trim(),
      alertPhone: registerForm.elements.alertPhone.value.trim(),
    };
    const data = await apiFetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    currentUser = data.user;
    bindProfile(currentUser);
    setAppAuthenticated(true);
    renderAuthMessage("Registration successful.");
    await loadReminders();
  } catch (error) {
    renderAuthMessage(error.message, true);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = {
      email: loginForm.elements.email.value.trim(),
      password: loginForm.elements.password.value,
    };
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    currentUser = data.user;
    bindProfile(currentUser);
    setAppAuthenticated(true);
    renderAuthMessage("Login successful.");
    await loadReminders();
  } catch (error) {
    renderAuthMessage(error.message, true);
  }
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = {
      name: profileForm.elements.name.value.trim(),
      alertEmail: profileForm.elements.alertEmail.value.trim(),
      alertPhone: profileForm.elements.alertPhone.value.trim(),
    };
    const data = await apiFetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    currentUser = data.user;
    bindProfile(currentUser);
    if (profileMessage) {
      profileMessage.textContent = "Profile updated successfully!";
      profileMessage.style.color = "#166534";
      profileMessage.style.background = "#f0fdf4";
      profileMessage.style.border = "1px solid #bbf7d0";
      profileMessage.style.padding = "8px 12px";
      profileMessage.style.borderRadius = "8px";
      setTimeout(() => {
        profileMessage.textContent = "";
        profileMessage.style.background = "";
        profileMessage.style.border = "";
        profileMessage.style.padding = "";
      }, 3000);
    }
  } catch (error) {
    if (profileMessage) {
      profileMessage.textContent = error.message;
      profileMessage.style.color = "#dc2626";
      profileMessage.style.background = "#fee2e2";
      profileMessage.style.border = "1px solid #fecaca";
      profileMessage.style.padding = "8px 12px";
      profileMessage.style.borderRadius = "8px";
    }
  }
});

logoutBtn.addEventListener("click", async () => {
  await apiFetch("/api/auth/logout", { method: "POST" });
  currentUser = null;
  setAppAuthenticated(false);
  renderAuthMessage("Logged out.");
});

showRegisterBtn.addEventListener("click", () => showAuthMode("register"));
showLoginBtn.addEventListener("click", () => showAuthMode("login"));

navDashboard.addEventListener("click", () => showPage("dashboard"));
navProfile.addEventListener("click", () => showPage("profile"));

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
uploadBtn.addEventListener("click", () => audioUpload.click());
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
  if (!id || !window.confirm("Delete this pending reminder?")) return;
  try {
    await apiFetch(`/api/reminders/${id}`, { method: "DELETE" });
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
    const result = await apiFetch("/api/reminders", { method: "POST", body: data });
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

window.addEventListener("beforeunload", () => {
  if (micStream) micStream.getTracks().forEach((track) => track.stop());
});

(async () => {
  updateRecordButtons();
  showAuthMode("register");
  const user = await fetchMe();
  if (!user) {
    setAppAuthenticated(false);
    return;
  }
  setAppAuthenticated(true);
  bindProfile(user);
  await loadReminders();
})();
