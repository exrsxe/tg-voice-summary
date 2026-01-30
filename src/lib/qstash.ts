import axios from 'axios'
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
    return true
  }

  try {
    const publishUrl = `${QSTASH_PUBLISH_URL}/${encodeURIComponent(TARGET_URL)}`
    await axios.post(publishUrl, payload, {
      headers: {
        Authorization: `Bearer ${QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    })

    logEvent('enqueued_job', { target: TARGET_URL })
    return true
  } catch (err) {
    logError('enqueue_failed', (err as Error).message, { target: TARGET_URL })
    return false
  }
}
