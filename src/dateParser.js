const chrono = require("chrono-node");
const moment = require("moment-hijri");

const WEEKDAY_MAP = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const WEEKDAY_TYPOS = {
  moday: "monday",
  mondy: "monday",
  monady: "monday",
  tuesdy: "tuesday",
  tusday: "tuesday",
  wednsday: "wednesday",
  wednesdy: "wednesday",
  thrusday: "thursday",
  thurday: "thursday",
  frday: "friday",
  satarday: "saturday",
  saturdy: "saturday",
  sundy: "sunday",
};

const ONAM_DATES = {
  2025: "2025-09-05",
  2026: "2026-08-26",
  2027: "2027-09-12",
  2028: "2028-09-01",
  2029: "2029-08-22",
  2030: "2030-09-09",
};

const VISHU_DATES = {
  2025: "2025-04-14",
  2026: "2026-04-15",
  2027: "2027-04-15",
  2028: "2028-04-14",
  2029: "2029-04-14",
  2030: "2030-04-14",
};

function setToMorning(dateObj) {
  const date = new Date(dateObj);
  date.setHours(9, 0, 0, 0);
  return date;
}

function parseIsoDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T09:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeText(input) {
  let normalized = (input || "").trim().toLowerCase();
  normalized = normalized.replace(/\bramzan\b/g, "ramadan");

  for (const [typo, correct] of Object.entries(WEEKDAY_TYPOS)) {
    const pattern = new RegExp(`\\b${typo}\\b`, "g");
    normalized = normalized.replace(pattern, correct);
  }

  return normalized;
}

function getRamadanEndCandidate(hijriYear) {
  // 1 Shawwal (Eid) is the day after Ramadan ends.
  const eid = moment(`${hijriYear}/10/1`, "iYYYY/iM/iD");
  if (!eid.isValid()) return null;

  const ramadanEnd = eid.clone().subtract(1, "day").toDate();
  return setToMorning(ramadanEnd);
}

function getNextRamadanEndDate(now) {
  const currentHijriYear = moment(now).iYear();
  const candidates = [currentHijriYear - 1, currentHijriYear, currentHijriYear + 1, currentHijriYear + 2]
    .map((year) => getRamadanEndCandidate(year))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  const next = candidates.find((candidate) => candidate.getTime() >= now.getTime());
  return next || candidates[candidates.length - 1] || null;
}

function getNextFestivalDateFromMap(map, now) {
  const years = Object.keys(map)
    .map((year) => Number(year))
    .sort((a, b) => a - b);
  const candidates = years
    .map((year) => parseIsoDate(map[year]))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  const next = candidates.find((candidate) => candidate.getTime() >= now.getTime());
  return next || null;
}

function getUpcomingWeekday(weekday, now) {
  const currentDay = now.getDay();
  const diff = (weekday - currentDay + 7) % 7;
  const next = new Date(now);
  next.setDate(now.getDate() + diff);
  const candidate = setToMorning(next);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate;
}

function nextWeekdayAfter(weekday, now) {
  const targetWeekday = getUpcomingWeekday(weekday, now);
  targetWeekday.setDate(targetWeekday.getDate() + 1);
  return setToMorning(targetWeekday);
}

function parseAfterWeekday(text, now) {
  const match = text.match(/after\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (!match) return null;
  const weekday = WEEKDAY_MAP[match[1]];
  return nextWeekdayAfter(weekday, now);
}

function parseOnWeekday(text, now) {
  const match = text.match(/\b(on|in)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (!match) return null;
  const weekday = WEEKDAY_MAP[match[2]];
  return getUpcomingWeekday(weekday, now);
}

function parseAfterRamadan(text, now) {
  if (!/(after)\s+ramadan/.test(text)) return null;

  const ramadanEnd = getNextRamadanEndDate(now);
  if (!ramadanEnd) return null;

  const reminder = new Date(ramadanEnd);
  reminder.setDate(reminder.getDate() + 1);
  return setToMorning(reminder);
}

function parseFestivalDate(text, now) {
  const onamMatch = text.match(/\b(after|on|in)\s+onam\b/);
  if (onamMatch) {
    const onamDate = getNextFestivalDateFromMap(ONAM_DATES, now);
    if (!onamDate) return null;
    if (onamMatch[1] === "after") {
      const reminder = new Date(onamDate);
      reminder.setDate(reminder.getDate() + 1);
      return setToMorning(reminder);
    }
    return setToMorning(onamDate);
  }

  const vishuMatch = text.match(/\b(after|on|in)\s+vishu\b/);
  if (vishuMatch) {
    const vishuDate = getNextFestivalDateFromMap(VISHU_DATES, now);
    if (!vishuDate) return null;
    if (vishuMatch[1] === "after") {
      const reminder = new Date(vishuDate);
      reminder.setDate(reminder.getDate() + 1);
      return setToMorning(reminder);
    }
    return setToMorning(vishuDate);
  }

  return null;
}

function hasExplicitTime(text) {
  return /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(text) || /\b\d{1,2}:\d{2}\b/.test(text);
}

function parseReminderDate(input, now = new Date()) {
  if (!input || !input.trim()) {
    return { date: null, reason: "Please provide a date phrase." };
  }

  const text = normalizeText(input);

  const festivalDate = parseFestivalDate(text, now);
  if (festivalDate) {
    return { date: festivalDate, reason: "Parsed using known festival calendar date." };
  }

  const ramadanDate = parseAfterRamadan(text, now);
  if (ramadanDate) {
    return { date: ramadanDate, reason: "Parsed as one day after Ramadan end date." };
  }

  const afterWeekdayDate = parseAfterWeekday(text, now);
  if (afterWeekdayDate) {
    return { date: afterWeekdayDate, reason: "Parsed as the day after the specified weekday." };
  }

  const onWeekdayDate = parseOnWeekday(text, now);
  if (onWeekdayDate) {
    return { date: onWeekdayDate, reason: "Parsed as the next occurrence of specified weekday." };
  }

  const parsed = chrono.parseDate(text, now, { forwardDate: true });
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return { date: null, reason: "Could not understand this date phrase." };
  }

  const normalized = hasExplicitTime(text) ? parsed : setToMorning(parsed);
  return { date: normalized, reason: "Parsed using natural language date parser." };
}

function computeTriggerAt(reminderAtIso, notifyTiming) {
  const reminderDate = new Date(reminderAtIso);
  if (Number.isNaN(reminderDate.getTime())) return null;
  const now = new Date();

  const isSameDayAsNow =
    reminderDate.getFullYear() === now.getFullYear() &&
    reminderDate.getMonth() === now.getMonth() &&
    reminderDate.getDate() === now.getDate();

  if (notifyTiming === "one_day_before") {
    const trigger = new Date(reminderDate);
    trigger.setDate(trigger.getDate() - 1);
    return setToMorning(trigger);
  }

  // For same-day reminders, preserve the exact requested time (e.g. 10 PM today).
  if (isSameDayAsNow) {
    return reminderDate;
  }

  return setToMorning(reminderDate);
}

module.exports = {
  parseReminderDate,
  computeTriggerAt,
};
