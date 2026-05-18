import { getAiProvider } from './_lib/aiProvider';
import { requireUser } from './_lib/auth';
import type { ChatMessage, DiaryEntry, UserProfile } from '../src/types';

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
    const { profile, history, message, relatedDiaryEntries } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: '消息不能为空' });
      return;
    }

    const reply = await getAiProvider().sendCompanionMessage(
      (profile || null) as UserProfile | null,
      (Array.isArray(history) ? history : []) as ChatMessage[],
      message,
      (Array.isArray(relatedDiaryEntries) ? relatedDiaryEntries : []) as DiaryEntry[],
    );

    res.status(200).json({ message: reply });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'DuoMi 暂时没有回应' });
  }
}
