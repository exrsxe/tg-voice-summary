import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { enqueueJob } from "../../src/lib/qstash";
import { checkRateLimit } from "../../src/lib/rateLimit";
import { isMessageProcessed, markMessageProcessed } from "../../src/lib/redis";
import { logEvent, logError } from "../../src/utils/logger";
import { processJob } from "../../src/lib/processJob";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET_TOKEN = process.env.SECRET_WEBHOOK_TOKEN;
const MAX_DURATION = Number(process.env.MAX_AUDIO_DURATION_SEC ?? 600);
const RATE_LIMIT_MESSAGE =
  "Вы превысили лимит: 10 голосовых в час. Попробуйте позже.";

type TelegramMessage = any;
type Update = { message?: TelegramMessage };

function isVoiceOrAudio(message: any): boolean {
  return !!(message?.voice || message?.audio);
}

async function sendInitialResponse(chatId: number): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: chatId,
      text: "Принял. Расшифровываю...",
    });
  } catch {
    // ignore
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // 1) Validate secret
  const headerToken = (req.headers["x-telegram-bot-api-secret-token"] ||
    req.headers["X-Telegram-Bot-Api-Secret-Token"]) as string;
  if (SECRET_TOKEN && headerToken !== SECRET_TOKEN) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  // 2) Quick 200 response to Telegram for webhook
  // Admin toggle: bot can be disabled via env
  if ((process.env.BOT_DISABLED ?? "false") === "true") {
    res.status(200).json({ ok: true, disabled: true });
    return;
  }
  res.status(200).json({ ok: true });

  try {
    const body: Update = req.body;
    const message = body?.message;
    if (!message) {
      logEvent("received_update", { type: "no_message" });
      return;
    }
    if (!isVoiceOrAudio(message)) {
      logEvent("received_update", { type: "no_audio" });
      return;
    }
    const chatId = message.chat?.id;
    const messageId = message.message_id;
    const userId = message.from?.id;
    // Validate essential identifiers
    if (!chatId || !messageId) {
      logEvent("webhook_invalid_payload", {
        chat_id: chatId,
        message_id: messageId,
        reason: "missing_chat_or_message_id",
      });
      return;
    }
    if (!userId) {
      logEvent("webhook_missing_user", {
        chat_id: chatId,
        message_id: messageId,
      });
      return;
    }
    logEvent("webhook_processing_start", {
      chat_id: chatId,
      user_id: userId,
      message_id: messageId,
    });
    // Idempotency: skip already processed message
    const alreadyProcessed = await isMessageProcessed(chatId, messageId);
    if (alreadyProcessed) {
      logEvent("duplicate_update", { chat_id: chatId, message_id: messageId });
      return;
    }
    // Do not mark processed yet; will mark after successful enqueue or processing
    const fileId = message.voice?.file_id ?? message.audio?.file_id;
    if (!fileId) {
      logEvent("webhook_invalid_payload", {
        chat_id: chatId,
        message_id: messageId,
        reason: "missing_file_id",
      });
      return;
    }
    const duration = message.voice?.duration ?? message.audio?.duration ?? 0;
    if (duration > MAX_DURATION) {
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
      await axios.post(url, {
        chat_id: chatId,
        text: `Файл слишком длинный (${duration}s). Максимум ${MAX_DURATION}s. Пожалуйста, разбейте на части.`,
      });
      return;
    }
    // Rate limit check per user (only if userId exists)
    const canProceed = await (async () => {
      if (!userId) return false;
      return await checkRateLimit(String(userId));
    })();
    if (!canProceed) {
      logEvent("rate_limited", { user_id: userId });
      try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
          chat_id: chatId,
          text: RATE_LIMIT_MESSAGE,
        });
      } catch {
        // ignore
      }
      return;
    }

    const payload = {
      chat_id: chatId,
      message_id: messageId,
      file_id: fileId,
      duration,
      user_id: userId,
    };

    const enqueueOk = await enqueueJob(payload);

    if (enqueueOk) {
      logEvent("enqueued_job", { chat_id: chatId, user_id: userId });
      await markMessageProcessed(chatId, messageId, 86400);
    } else {
      logError("enqueue_failed", "Failed to enqueue job", {
        chat_id: chatId,
        user_id: userId,
      });

      // fallback inline (optional)
      await sendInitialResponse(chatId);

      try {
        await processJob(payload);
        // ✅ важно: отметить processed и после успешной inline-обработки
        await markMessageProcessed(chatId, messageId, 86400);
      } catch (e) {
        logError("inline_process_failed", (e as Error).message, {
          chat_id: chatId,
          user_id: userId,
        });
      }
    }
  } catch (err) {
    logError("telegram_webhook_error", (err as Error).message, {
      stack: (err as Error).stack,
    });
  }
}
