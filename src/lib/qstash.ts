import axios from 'axios'
import { logEvent, logError } from '../utils/logger'

const QSTASH_ENABLED = (process.env.QSTASH_ENABLED ?? 'false') === 'true'
const QSTASH_URL = process.env.QSTASH_URL
const QSTASH_TOKEN = process.env.QSTASH_TOKEN

export async function enqueueJob(payload: any): Promise<boolean> {
  if (!QSTASH_ENABLED || !QSTASH_URL) {
    logEvent('enqueue_fallback', payload)
    return true
  }
  try {
    await axios.post(QSTASH_URL, payload, {
      headers: {
        'Authorization': `Bearer ${QSTASH_TOKEN}`,
        'Content-Type': 'application/json'
      }
    })
    logEvent('enqueue_ok', payload)
    return true
  } catch (err) {
    logError('enqueue_failed', (err as Error).message, payload)
    return false
  }
}
