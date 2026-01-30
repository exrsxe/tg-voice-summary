import type { NextApiRequest, NextApiResponse } from 'next'
import { processJob } from '../../src/lib/processJob'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await processJob(req.body)
  res.status(200).json({ ok: true })
}
