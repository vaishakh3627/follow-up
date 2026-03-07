# Follow-Up Reminder Web App

Quick-capture reminder app for sales follow-ups.
You only provide:
- a short text note, and/or
- an audio note

AI (Gemini) extracts:
- client details (if present),
- reminder date phrase (for example `after monday`, `after ramzan`),
- preferred channel (`email` / `sms` / `both`),
- timing preference (`morning_of` or `one_day_before`).

The app then schedules and sends reminders to **you** by email/SMS.

## What is implemented

- One-step capture form (quick note + optional audio)
- AI extraction with Gemini (`@google/generative-ai`)
- AI fallback date resolver for open-ended phrases/events
- Local fallback extraction when AI key is not configured
- Natural language date parser with automatic festival/weekday support (`after ramzan`, `after onam`, `after vishu`, `after sunday`, typo-tolerant weekday phrases)
- Background scheduler (every minute)
- Email and SMS notifications
- SQLite persistence + pending reminders dashboard

## How reminders are delivered

Reminders are sent to your configured contact in `.env`:
- `ALERT_EMAIL_TO`
- `ALERT_PHONE_TO`

This means you do not need to enter destination contact each time.

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create env file:
   ```bash
   cp .env.example .env
   ```
3. Fill `.env`:
   - `GEMINI_API_KEY`
   - `ALERT_EMAIL_TO` and/or `ALERT_PHONE_TO`
   - SMTP and Twilio credentials
4. Start app:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000)

## Example input notes

- `after monday remind me to call imran about pricing, sms me`
- `after ramzan follow up with arif for final approval`
- `next friday 10am send email reminder for Acme contract`

## Notes

- If Gemini is unavailable, local parsing rules are used automatically.
- Audio files are uploaded and passed to Gemini as inline audio.
- For `after ramzan`, date is calculated automatically from Hijri calendar conversion.
- For `onam` and `vishu`, parser uses built-in upcoming festival dates and schedules reminders accordingly.
