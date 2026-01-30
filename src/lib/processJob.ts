import axios from 'axios'
import { getTelegramFilePath, sendMessage } from './telegram'
import { transcribeAudio, summarizeTranscript } from './openai'
import { logEvent, logError } from '../utils/logger'
import { acquireRateLimit, isMessageProcessed, markMessageProcessed } from './redis'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchFileBufferFromTelegram(fileId: string): Promise<Buffer> {
  const filePath = await getTelegramFilePath(BOT_TOKEN!, fileId)
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' })
    return Buffer.from(resp.data)
  } catch (e: any) {
    throw new Error(`download_failed:${e?.response?.status ?? e?.code ?? e.message}`)
  }
}

export async function processJob(payload: any): Promise<void> {
  if (!payload || !payload.file_id || !payload.chat_id) {
    logEvent('process_job_invalid_payload', { payload })
    return
  }
  const chatId = payload.chat_id
  const messageId = payload.message_id

  // Idempotency: check early to avoid duplicates
  try {
    const already = await isMessageProcessed(chatId, messageId)
    if (already) {
      logEvent('duplicate_process_job', { chat_id: chatId, message_id: messageId })
      return
    }
  } catch {
    // ignore
  }

  // Rate limit (Redis-based)
  try {
    const rateOk = await acquireRateLimit(String(chatId))
    if (!rateOk) {
      logEvent('rate_limit_exceeded', { chat_id: chatId, user_id: payload.user_id })
      await sendMessage(BOT_TOKEN!, chatId, 'Rate limit exceeded. Please try again later.')
      return
    }
  } catch {
    // Redis unavailable; continue
  }

  try {
    // 1) Download file
    const buffer = await fetchFileBufferFromTelegram(payload.file_id)

    // 2) Transcribe with retries
    let transcript = ''
    let transcribeOk = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        transcript = await transcribeAudio(buffer, OPENAI_API_KEY!, 'voice.ogg')
        transcribeOk = true
        logEvent('transcribe_ok', { chat_id: chatId, attempt })
        break
      } catch (err) {
        logError('openai_transcribe_failed', (err as Error).message, { chat_id: chatId, attempt, stack: (err as Error).stack })
        if (attempt < 3) await sleep(1000 * Math.pow(2, attempt - 1))
      }
    }
    if (!transcribeOk || !transcript) {
      await sendMessage(BOT_TOKEN!, chatId, 'Не удалось расшифровать аудио. Попробуйте позже.')
      return
    }

    // 3) Summarize with retries
    let summaryObj: any = null
    let summarizeOk = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        summaryObj = await summarizeTranscript(transcript, OPENAI_API_KEY!, 'gpt-4o-mini')
        summarizeOk = true
        logEvent('summarize_ok', { chat_id: chatId, attempt })
        break
      } catch (err) {
        logError('openai_summarize_failed', (err as Error).message, { chat_id: chatId, attempt, stack: (err as Error).stack })
        if (attempt < 3) await sleep(1000 * Math.pow(2, attempt - 1))
      }
    }
    if (!summarizeOk || !summaryObj) {
      await sendMessage(BOT_TOKEN!, chatId, 'Не удалось сформировать резюме. Попробуйте позже.')
      return
    }

    // 4) Send final message
    const bullets = (summaryObj?.bullets ?? [])
    const textParts: string[] = []
    if (summaryObj?.summary) textParts.push(`О чём речь: ${summaryObj.summary}`)
    if (bullets.length) textParts.push('Тезисы:\n' + bullets.map((b: string) => `- ${b}`).join('\n'))
    if (summaryObj?.next_steps && Array.isArray(summaryObj.next_steps)) textParts.push('Следующие шаги: ' + summaryObj.next_steps.join(', '))
    const finalText = textParts.join('\n\n')
    await sendMessage(BOT_TOKEN!, chatId, finalText)
    logEvent('send_ok', { chat_id: chatId })

    // Mark as processed after successful delivery
    try {
      await markMessageProcessed(chatId, messageId, 86400)
    } catch {
      // ignore
    }
  } catch (err) {
    logError('process_job_error', (err as Error).message, { stack: (err as Error).stack, chat_id: payload?.chat_id })
    try {
      await sendMessage(BOT_TOKEN!, payload?.chat_id, 'Не удалось обработать запрос. Попробуйте позже.')
    } catch {
      // ignore
    }
  }
}
