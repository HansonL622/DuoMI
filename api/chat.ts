import { getAiProvider } from './_lib/aiProvider';
import { requireUser } from './_lib/auth';
import { checkRateLimit, RateLimitError } from './_lib/rateLimit';
import type { ChatMessage, ChatRuntimeContext, DiaryEntry, UserProfile } from '../src/types';

type ApiRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
};

type ApiResponse = {
  status: (code: number) => { json: (body: unknown) => void };
  setHeader: (name: string, value: string) => void;
  write: (chunk: string) => void;
  end: () => void;
  headersSent?: boolean;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    await requireUser(req);
    const { profile, history, message, relatedDiaryEntries, runtimeContext } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: '消息不能为空' });
      return;
    }
    await checkRateLimit('chat', req);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    await getAiProvider().streamCompanionMessage(
      (profile || null) as UserProfile | null,
      (Array.isArray(history) ? history : []) as ChatMessage[],
      message,
      (Array.isArray(relatedDiaryEntries) ? relatedDiaryEntries : []) as DiaryEntry[],
      (runtimeContext || null) as ChatRuntimeContext | null,
      (delta) => res.write(delta),
    );

    res.end();
  } catch (error) {
    if (error instanceof RateLimitError) {
      res.status(429).json({ error: error.message });
      return;
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'DuoMi 暂时没有回应' });
  }
}
