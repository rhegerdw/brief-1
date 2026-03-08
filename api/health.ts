import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}
