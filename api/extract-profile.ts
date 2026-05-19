import { getAiProvider } from './_lib/aiProvider';
import { requireUser } from './_lib/auth';
import type { PlaceSnapshot, UserProfile, WeatherSnapshot } from '../src/types';

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
    const { currentProfile, diaryContent, moodLabel, weather, place } = req.body || {};
    if (typeof diaryContent !== 'string' || !diaryContent.trim()) {
      res.status(400).json({ error: '日记内容不能为空' });
      return;
    }

    const profile = await getAiProvider().extractProfile(
      (currentProfile || null) as UserProfile | null,
      diaryContent,
      typeof moodLabel === 'string' ? moodLabel : undefined,
      (weather || undefined) as WeatherSnapshot | undefined,
      (place || undefined) as PlaceSnapshot | undefined,
    );
    res.status(200).json({ profile });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : '画像更新失败' });
  }
}
