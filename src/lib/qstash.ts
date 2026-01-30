import { logEvent, logError } from '../utils/logger'

const QSTASH_ENABLED = (process.env.QSTASH_ENABLED ?? 'false') === 'true'
const QSTASH_TOKEN = process.env.QSTASH_TOKEN
const TARGET_URL = process.env.QSTASH_URL // https://.../api/process-job

const QSTASH_PUBLISH_URL = 'https://qstash.upstash.io/v2/publish'

export async function enqueueJob(payload: any): Promise<boolean> {
  logEvent('qstash_env_check', {
    QSTASH_ENABLED: process.env.QSTASH_ENABLED,
    HAS_TOKEN: Boolean(process.env.QSTASH_TOKEN),
    HAS_URL: Boolean(process.env.QSTASH_URL),
    URL_VALUE: process.env.QSTASH_URL,
  })

  if (!QSTASH_ENABLED || !QSTASH_TOKEN || !TARGET_URL) {
    logEvent('enqueue_fallback', {
      reason: {
        enabled: QSTASH_ENABLED,
        hasToken: Boolean(QSTASH_TOKEN),
        hasUrl: Boolean(TARGET_URL),
      },
      payload,
    })
    return false // <-- важно: это НЕ enqueue, пусть webhook решает fallback
  }

  const publishUrl = `${QSTASH_PUBLISH_URL}/${encodeURIComponent(TARGET_URL)}`
  logEvent('before_qstash_publish', { publishUrl })

  try {
    const res = await fetch(publishUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logError('enqueue_failed', `QStash publish failed: ${res.status} ${text}`, {
        target: TARGET_URL,
        status: res.status,
      })
      return false
    }

    // QStash обычно возвращает JSON, но нам не обязательно его парсить
    logEvent('enqueued_job', { target: TARGET_URL })
    return true
  } catch (err) {
    logError('enqueue_failed', (err as Error).message, { target: TARGET_URL })
    return false
  }
}
