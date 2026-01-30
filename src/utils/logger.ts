export function logEvent(event: string, payload?: any) {
  console.log(`[VOICE_SUMMARY] ${new Date().toISOString()} EVENT:${event} ${payload ? JSON.stringify(payload) : ''}`)
}

export function logError(code: string, message: string, context?: any) {
  console.error(`[VOICE_SUMMARY] ERROR:${code} ${message} ${context ? JSON.stringify(context) : ''}`)
}
