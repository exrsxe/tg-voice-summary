// Lightweight Redis helper (uses redis v5 API)
// Falls back gracefully if Redis is unavailable
let redisClient: any = null

async function getClient(): Promise<any> {
  if (redisClient) {
    if (redisClient.isOpen) return redisClient
  }
  const { createClient } = require('redis')
  const client = createClient({ url: process.env.REDIS_URL })
  await client.connect()
  redisClient = client
  return redisClient
}

export async function isMessageProcessed(chatId: string | number, messageId: string | number): Promise<boolean> {
  try {
    const client = await getClient()
    const key = `processed:${chatId}:${messageId}`
    const val = await client.get(key)
    return val !== null
  } catch {
    return false
  }
}

export async function markMessageProcessed(chatId: string | number, messageId: string | number, ttlSeconds: number = 86400): Promise<void> {
  try {
    const client = await getClient()
    const key = `processed:${chatId}:${messageId}`
    await client.set(key, '1', { EX: ttlSeconds })
  } catch {
    // ignore
  }
}

export async function acquireRateLimit(userId: string, limit: number = 10, windowSeconds: number = 3600): Promise<boolean> {
  if (!process.env.REDIS_URL) {
    // Redis not configured; allow by default (fallback)
    return true
  }
  try {
    const client = await getClient()
    const key = `rate:${userId}`
    const current = await client.incr(key)
    if (current === 1) {
      await client.expire(key, windowSeconds)
    }
    return current <= limit
  } catch {
    // On Redis failure, allow (prefer availability over strictness)
    return true
  }
}
