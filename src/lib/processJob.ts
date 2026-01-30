import axios from 'axios'
import { getTelegramFilePath, sendMessage } from './telegram'
import { transcribeAudio, summarizeTranscript } from './openai'
import { logEvent, logError } from '../utils/logger'
import { isMessageProcessed, markMessageProcessed } from './redis'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchFileBufferFromTelegram(fileId: string): Promise<Buffer> {
  if (!BOT_TOKEN) throw new Error('missing_env:TELEGRAM_BOT_TOKEN')
  const filePath = await getTelegramFilePath(BOT_TOKEN, fileId)
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`

  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30_000 })
    return Buffer.from(resp.data)
  } catch (e: any) {
    throw new Error(`download_failed:${e?.response?.status ?? e?.code ?? e?.message ?? 'unknown'}`)
  }
}

async function withRetry<T>(name: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      logError(`${name}_attempt_failed`, (e as Error).message, { attempt: i + 1 })
      await sleep(1000 * Math.pow(2, i)) // 1s, 2s, 4s
    }
  }
  throw lastErr
}

export async function processJob(payload: any) {
  // ---- validate payload
  const chatId = payload?.chat_id
  const messageId = payload?.message_id
  const fileId = payload?.file_id
  const userId = payload?.user_id

  if (!chatId || !messageId || !fileId) {
    logEvent('process_job_invalid_payload', { hasChatId: !!chatId, hasMessageId: !!messageId, hasFileId: !!fileId })
    return { ok: false, error: 'invalid_payload' }
  }

  // ---- idempotency on job side too (important with retries)
  try {
    const already = await isMessageProcessed(chatId, messageId)
    if (already) {
      logEvent('process_job_duplicate', { chat_id: chatId, message_id: messageId })
      return { ok: true, skipped: true }
    }
  } catch {
    // if redis down, continue (availability > strictness)
  }

  logEvent('process_job_start', { chat_id: chatId, message_id: messageId, user_id: userId })

  try {
    if (!OPENAI_API_KEY) throw new Error('missing_env:OPENAI_API_KEY')

    // 1) download audio from Telegram
    const audioBuffer = await withRetry('telegram_download', () => fetchFileBufferFromTelegram(String(fileId)))

    // 2) transcribe
    const transcript = await withRetry('openai_transcribe', () =>
      transcribeAudio(audioBuffer, OPENAI_API_KEY, 'audio.ogg', 'gpt-4o-mini-transcribe')
    )

    const cleanTranscript = (transcript ?? '').trim()
    if (!cleanTranscript) {
      await sendMessage(BOT_TOKEN!, chatId, 'Не получилось распознать речь 😕 Попробуйте отправить голосовое ещё раз.')
      return { ok: true, empty_transcript: true }
    }

    // 3) summarize
    const summary = await withRetry('openai_summarize', () =>
      summarizeTranscript(cleanTranscript, OPENAI_API_KEY, 'gpt-4o-mini')
    )

    const answer = (summary ?? '').trim() || 'Сделал транскрипт, но не смог собрать саммари. Попробуйте ещё раз.'

    // 4) respond to user
    await sendMessage(BOT_TOKEN!, chatId, answer)
    logEvent('process_job_done', { chat_id: chatId, message_id: messageId })

    // 5) mark processed
    try {
      await markMessageProcessed(chatId, messageId, 86400)
    } catch {
      // ignore
    }

    return { ok: true }
  } catch (e: any) {
    const msg = (e as Error)?.message ?? String(e)
    logError('process_job_error', msg, { chat_id: chatId, message_id: messageId, user_id: userId })

    // user-friendly error
    try {
      await sendMessage(BOT_TOKEN!, chatId, `❌ Ошибка при обработке голосового.\n\nПричина: ${msg}`)
    } catch {
      // ignore
    }

    return { ok: false, error: msg }
  }
}
