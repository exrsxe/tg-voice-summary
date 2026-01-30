import axios from 'axios'
import FormData from 'form-data'

export async function transcribeAudio(buffer: Buffer, openaiApiKey: string, fileName: string, model: string = 'gpt-4o-mini-transcribe') {
  const url = 'https://api.openai.com/v1/audio/transcriptions'
  const form = new FormData()
  form.append('model', model)
  form.append('file', buffer, { filename: fileName })
  const headers = { ...form.getHeaders(), Authorization: `Bearer ${openaiApiKey}` }
  const res = await axios.post(url, form, { headers })
  return res.data?.text ?? ''
}

export async function summarizeTranscript(transcript: string, openaiApiKey: string, model: string = 'gpt-4o-mini') {
  const url = 'https://api.openai.com/v1/chat/completions'
  const prompt = `Сформируй структурированное резюме для голосовой записи. Верни строго JSON без пояснений.
Поля:
- "summary" (кратко 1–2 предложения)
- "bullets" (5–8 пунктов тезисов)
- "next_steps" (договорённости/следующие шаги, список)
- "tone" (тон и настроение, одно предложение)
- "entities" (имена/даты/цифры, по желанию)

Текст:
${transcript}`
  const payload = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 1200
  }
  const res = await axios.post(url, payload, {
    headers: { 'Authorization': `Bearer ${openaiApiKey}` }
  })
  const text = res.data?.choices?.[0]?.message?.content ?? ''
  try {
    const obj = JSON.parse(text)
    return obj
  } catch {
    return { summary: text, bullets: [], next_steps: [], tone: '', entities: {} }
  }
}
