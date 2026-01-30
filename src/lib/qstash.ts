import { logEvent, logError } from '../utils/logger'

const QSTASH_ENABLED = (process.env.QSTASH_ENABLED ?? 'false') === 'true'
const QSTASH_TOKEN = process.env.QSTASH_TOKEN
const TARGET_URL = process.env.QSTASH_URL // https://.../api/process-job

// ✅ Региональный endpoint QStash (из Request Builder), иначе fallback на глобальный
const QSTASH_BASE_URL = (process.env.QSTASH_BASE_URL ?? 'https://qstash.upstash.io').replace(/\/$/, '')
const QSTASH_PUBLISH_URL = `${QSTASH_BASE_URL}/v2/publish`

export async function enqueueJob(payload: any): Promise<boolean> {
  logEvent('qstash_env_check', {
    QSTASH_ENABLED: process.env.QSTASH_ENABLED,
    HAS_TOKEN: Boolean(process.env.QSTASH_TOKEN),
    HAS_URL: Boolean(process.env.QSTASH_URL),
    URL_VALUE: process.env.QSTASH_URL,
    BASE_URL: QSTASH_BASE_URL,
  })

  if (!QSTASH_ENABLED || !QSTASH_TOKEN || !TARGET_URL) {
    logEvent('enqueue_fallback', {
      reason: {
        enabled: QSTASH_ENABLED,
        hasToken: Boolean(QSTASH_TOKEN),
        hasUrl: Boolean(TARGET_URL),
      },
    })
    return false
  }

  const publishUrl = `${QSTASH_PUBLISH_URL}/${encodeURIComponent(TARGET_URL)}`
  logEvent('before_qstash_publish', { publishUrl })

  // ✅ Таймаут, чтобы не зависало навсегда
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(publishUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logError('enqueue_failed', `QStash publish failed: ${res.status} ${text}`, {
        status: res.status,
        target: TARGET_URL,
        baseUrl: QSTASH_BASE_URL,
      })
      return false
    }

    logEvent('enqueued_job', { target: TARGET_URL, baseUrl: QSTASH_BASE_URL })
    return true
  } catch (err) {
    logError('enqueue_failed', (err as Error).message, {
      target: TARGET_URL,
      baseUrl: QSTASH_BASE_URL,
    })
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}
