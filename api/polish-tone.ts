import { getAiProvider } from './_lib/aiProvider.js';
import { requireUser } from './_lib/auth.js';
import { checkRateLimit, RateLimitError } from './_lib/rateLimit.js';

type ApiRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
};

type ApiResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    await requireUser(req);
    const { userRequest } = req.body || {};
    if (typeof userRequest !== 'string' || !userRequest.trim()) {
      res.status(400).json({ error: '请先写下你想要的语气' });
      return;
    }
    await checkRateLimit('polish-tone', req);

    const prompt = await getAiProvider().polishToneInstruction(userRequest);
    res.status(200).json({ prompt });
  } catch (error) {
    if (error instanceof RateLimitError) {
      res.status(429).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : '专属语气生成失败' });
  }
}
