import axios from 'axios'

export async function getTelegramFilePath(botToken: string, fileId: string): Promise<string> {
  const url = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
  const res = await axios.get(url)
  if (res.data?.ok && res.data?.result?.file_path) {
    return res.data.result.file_path
  }
  throw new Error('Failed to resolve Telegram file_path')
}

export async function downloadTelegramFile(botToken: string, filePath: string): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`
  const resp = await axios.get(url, { responseType: 'arraybuffer' })
  return Buffer.from(resp.data)
}

export async function sendMessage(botToken: string, chatId: any, text: string): Promise<any> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`
  return axios.post(url, { chat_id: chatId, text: text })
}
