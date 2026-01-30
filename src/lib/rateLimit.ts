import { acquireRateLimit } from './redis'

// Fallback in-memory limiter (only used if Redis is not configured)
type RateLimitStore = Map<string, { count: number; windowReset: number }>
const inMemory: RateLimitStore = new Map()
const DEFAULT_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR ?? 10)
const WINDOW_SECONDS = 60 * 60

export async function checkRateLimit(userId: string): Promise<boolean> {
  // Prefer Redis-based limiter when configured
  if (process.env.REDIS_URL) {
    try {
      const ok = await acquireRateLimit(userId, DEFAULT_LIMIT, WINDOW_SECONDS)
      return ok
    } catch {
      // fall back to in-memory if Redis call fails
    }
  }
  // In-memory fallback
  const now = Math.floor(Date.now() / 1000)
  const entry = inMemory.get(userId)
  if (!entry) {
    inMemory.set(userId, { count: 1, windowReset: now + WINDOW_SECONDS })
    return true
  }
  if (now > entry.windowReset) {
    inMemory.set(userId, { count: 1, windowReset: now + WINDOW_SECONDS })
    return true
  }
  entry.count += 1
  return entry.count <= DEFAULT_LIMIT
}
