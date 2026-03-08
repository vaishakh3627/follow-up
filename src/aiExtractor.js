const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const DEFAULT_MODELS = ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"];

function detectChannel(text) {
  const value = (text || "").toLowerCase();
  const wantsSms = /\b(sms|text|message me|whatsapp)\b/.test(value);
  const wantsEmail = /\b(email|mail)\b/.test(value);

  if (wantsSms && wantsEmail) return "both";
  if (wantsSms) return "sms";
  if (wantsEmail) return "email";
  return "email";
}

function detectTiming(text) {
  const value = (text || "").toLowerCase();
  if (/\b(one day before|day before|previous day)\b/.test(value)) {
    return "one_day_before";
  }
  return "morning_of";
}

function fallbackExtract(quickInput) {
  const text = (quickInput || "").trim();
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = text.match(/(\+?\d[\d\s-]{7,}\d)/);
  const clientMatch = text.match(
    /\b(?:client|customer|lead)\s+([a-zA-Z][a-zA-Z0-9 .&-]{1,40}?)(?=\s+\b(?:about|for|to|and|after|next|tomorrow|on)\b|[.,]|$)/i
  );

  return {
    usedAi: false,
    aiReason: "Gemini API key missing or AI extraction unavailable. Used local fallback rules.",
    clientName: clientMatch ? clientMatch[1].trim() : "",
    email: emailMatch ? emailMatch[0] : "",
    phone: phoneMatch ? phoneMatch[0].replace(/\s+/g, "") : "",
    noteText: text,
    reminderPhrase: text,
    reminderDateIso: "",
    notifyChannel: detectChannel(text),
    notifyTiming: detectTiming(text),
  };
}

function parseJsonText(value) {
  if (!value) return null;
  const trimmed = value.trim();
  const cleaned = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    return null;
  }
}

function getAiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { genAI: null, modelNames: [] };
  const genAI = new GoogleGenerativeAI(apiKey);
  const preferred = (process.env.GEMINI_MODEL || "").trim();
  const modelNames = [...new Set([preferred, ...DEFAULT_MODELS].filter(Boolean))];
  return { genAI, modelNames };
}

function isModelNotFoundError(error) {
  const message = error?.message || "";
  return message.includes("404") || message.toLowerCase().includes("no longer available");
}

async function generateWithModelFallback(parts) {
  const { genAI, modelNames } = getAiModel();
  if (!genAI || !modelNames.length) {
    return { text: "", modelUsed: "", error: new Error("Gemini API key missing.") };
  }

  let lastError = null;
  for (const modelName of modelNames) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(parts);
      return { text: result.response.text(), modelUsed: modelName, error: null };
    } catch (error) {
      lastError = error;
      if (!isModelNotFoundError(error)) break;
    }
  }

  return { text: "", modelUsed: "", error: lastError || new Error("Gemini call failed.") };
}

async function extractReminderDetails({ quickInput, audioFilePath, audioMimeType }) {
  const localFallback = fallbackExtract(quickInput);
  const { genAI } = getAiModel();
  if (!genAI) return localFallback;

  try {
    const prompt = `
Extract reminder scheduling fields from the user input.
Return ONLY strict JSON with this shape:
{
  "clientName": "string",
  "email": "string",
  "phone": "string",
  "noteText": "string",
  "reminderPhrase": "string",
  "reminderDateIso": "ISO-8601 datetime string or empty",
  "notifyChannel": "email|sms|both",
  "notifyTiming": "morning_of|one_day_before"
}
Rules:
- reminderPhrase should contain date intent like "after monday", "after ramzan", "next friday 10am".
- If the user mentions named events/festivals (onam, vishu, ramzan, etc), resolve and return an exact future date/time in reminderDateIso when possible.
- If the user gives weekday phrases with spelling mistakes (like moday), normalize and return reminderDateIso.
- If no explicit channel is mentioned, use "email".
- If no "day before" style phrase exists, use "morning_of".
- noteText should be a concise summary of the intent.
`.trim();

    const parts = [{ text: prompt }];
    if (quickInput && quickInput.trim()) {
      parts.push({ text: `User note:\n${quickInput.trim()}` });
    }
    if (audioFilePath) {
      const audioBytes = fs.readFileSync(audioFilePath);
      parts.push({
        inlineData: {
          data: audioBytes.toString("base64"),
          mimeType: audioMimeType || "audio/mpeg",
        },
      });
      parts.push({ text: "Also use the audio message to infer the reminder fields." });
    }

    const generated = await generateWithModelFallback(parts);
    if (generated.error) {
      throw generated.error;
    }
    const raw = generated.text;
    const parsed = parseJsonText(raw);
    if (!parsed) return localFallback;

    return {
      usedAi: true,
      aiReason: `Extracted using Gemini (${generated.modelUsed}).`,
      clientName: parsed.clientName || localFallback.clientName,
      email: parsed.email || localFallback.email,
      phone: parsed.phone || localFallback.phone,
      noteText: parsed.noteText || localFallback.noteText,
      reminderPhrase: parsed.reminderPhrase || localFallback.reminderPhrase,
      reminderDateIso: parsed.reminderDateIso || "",
      notifyChannel: ["email", "sms", "both"].includes(parsed.notifyChannel)
        ? parsed.notifyChannel
        : localFallback.notifyChannel,
      notifyTiming: ["morning_of", "one_day_before"].includes(parsed.notifyTiming)
        ? parsed.notifyTiming
        : localFallback.notifyTiming,
    };
  } catch (error) {
    return {
      ...localFallback,
      aiReason: `AI extraction failed (${error.message}). Used local fallback rules.`,
    };
  }
}

async function resolveReminderDateWithAi({ reminderText, nowIso }) {
  const { genAI } = getAiModel();
  if (!genAI || !reminderText || !reminderText.trim()) return "";

  try {
    const prompt = `
You are a reminder date resolver.
Return ONLY strict JSON:
{
  "reminderDateIso": "ISO-8601 datetime string in the future or empty"
}
Rules:
- Interpret flexible human phrases and events (festivals, weekdays, colloquial wording, minor typos).
- Use this reference current datetime: ${nowIso}
- If a time is not specified, use 09:00 local time.
- Date must be in the future relative to reference datetime.
- If not inferable, return empty string.
`.trim();

    const generated = await generateWithModelFallback([
      { text: prompt },
      { text: `Reminder text:\n${reminderText.trim()}` },
    ]);
    if (generated.error) return "";
    const parsed = parseJsonText(generated.text);
    return parsed?.reminderDateIso || "";
  } catch (error) {
    return "";
  }
}

module.exports = {
  extractReminderDetails,
  resolveReminderDateWithAi,
};
