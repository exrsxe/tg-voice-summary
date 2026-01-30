# Voice → Summary Bot (MVP) – Production Readiness

Overview
- Telegram bot accepts voice/audio, returns concise summary, theses, next steps, and tone.
- MVP architecture: Next.js API routes on Vercel; asynchronous job processing via QStash (or equivalent); transcription and summarization via OpenAI.
- Production stabilization focuses on robust webhook handling, retries, Redis-backed rate limiting, idempotency, and clear logging.

Environment variables (required)
- TELEGRAM_BOT_TOKEN: bot token from Telegram
- OPENAI_API_KEY: API key for OpenAI
- SECRET_WEBHOOK_TOKEN: secret token to validate Telegram webhook requests
- REDIS_URL: Redis connection URL (for Upstash/Redis-backed rate limits and deduplication)
- QSTASH_ENABLED: if true, enable QStash enqueue (default false)
- QSTASH_URL: QStash webhook URL (if QSTASH_ENABLED)
- QSTASH_TOKEN: QStash token (if QSTASH_ENABLED)
- MAX_AUDIO_DURATION_SEC: max duration of input audio in seconds (default 600)
- RATE_LIMIT_PER_HOUR: number of allowed requests per user (default 10) [used only if Redis is unavailable]

Webhook setup notes
- When configuring Telegram webhook, pass a secret token. The webhook validates the header X-Telegram-Bot-Api-Secret-Token against SECRET_WEBHOOK_TOKEN. Use setWebhook with secret_token parameter, e.g.:
- curl -F secret_token=YOUR_SECRET -F url=https://<vercel-url>/api/telegram-webhook https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook
- Do not rely on ?secret= query params; prefer the secret_token parameter for security.

What to deploy (Vercel)
- Create a Next.js project (the repo already contains src/apis)
- Configure environment variables in Vercel
- Set up Telegram webhook endpoint to your Vercel URL with SECRET_WEBHOOK_TOKEN
- Ensure Redis is accessible (Upstash URL) if enabling Redis rate limiting

How to test locally
- Install dependencies: npm i
- Start dev server: npm run dev
- Use ngrok or similar to expose local port for Telegram webhook, or deploy to Vercel for testing with real webhook
- Send a voice message to the bot and verify the flow: initial acknowledgement, then summary via /api/process-job behavior is handled in the background

Operational notes
- Webhook responses: Telegram should always receive 200 OK. Heavy processing is offloaded to a queue (QStash) or process-job path; webhook responds immediately after validation and enqueuing.
- Logging: logs events and error codes in a structured manner; sensitive transcripts are not logged in production; debug mode can log more details.
- Idempotency: processed message IDs are deduplicated to avoid repeated work on retries or duplicate deliveries.

- Next steps (post-MVP): add DB for history, admin panel, and paid tiers, as per your plan.
