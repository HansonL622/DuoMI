import type { ChatMessage, ChatRuntimeContext, DiaryEntry, PlaceSnapshot, UserProfile, WeatherSnapshot } from '../types';
import { supabase } from './supabaseClient';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };

  return {
    'Content-Type': 'application/json',
    ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
  };
}

async function postJson<TResponse>(url: string, body: unknown): Promise<TResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('DuoMi 连接失败：请确认本地服务已启动，或稍后再试');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (!payload && response.status === 404) {
      throw new Error('DuoMi 的本地 API 没有启动。请使用 npm run dev:vercel，而不是 npm run dev');
    }
    throw new Error(payload?.error || 'DuoMi 暂时没有连上，请稍后再试');
  }

  return payload as TResponse;
}

async function postTextStream(url: string, body: unknown, onDelta: (delta: string) => void): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('DuoMi 连接失败：请确认本地服务已启动，或稍后再试');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    if (!payload && response.status === 404) {
      throw new Error('DuoMi 的本地 API 没有启动。请使用 npm run dev:vercel，而不是 npm run dev');
    }
    throw new Error(payload?.error || 'DuoMi 暂时没有连上，请稍后再试');
  }
  if (!response.body) {
    throw new Error('DuoMi 暂时没有返回可读取的响应');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const delta = decoder.decode(value, { stream: true });
    if (delta) {
      fullText += delta;
      onDelta(delta);
    }
  }

  const remaining = decoder.decode();
  if (remaining) {
    fullText += remaining;
    onDelta(remaining);
  }

  return fullText.trim();
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function extractProfile(
  currentProfile: UserProfile | null,
  diaryContent: string,
  moodLabel?: string,
  weather?: WeatherSnapshot,
  place?: PlaceSnapshot,
): Promise<UserProfile> {
  const response = await postJson<{ profile: UserProfile }>('/api/extract-profile', {
    currentProfile,
    diaryContent,
    moodLabel,
    weather,
    place,
  });

  return response.profile;
}

export async function polishCustomTone(userRequest: string): Promise<string> {
  const response = await postJson<{ prompt: string }>('/api/polish-tone', {
    userRequest,
  });

  return response.prompt;
}

export async function sendCompanionMessage(
  profile: UserProfile | null,
  history: ChatMessage[],
  message: string,
  relatedDiaryEntries: DiaryEntry[],
): Promise<string> {
  const now = new Date();
  const runtimeContext: ChatRuntimeContext = {
    currentDate: toLocalDateKey(now),
    currentDateTime: now.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
  };

  return postTextStream('/api/chat', {
    profile,
    history,
    message,
    relatedDiaryEntries,
    runtimeContext,
  }, () => undefined);
}

export async function streamCompanionMessage(
  profile: UserProfile | null,
  history: ChatMessage[],
  message: string,
  relatedDiaryEntries: DiaryEntry[],
  onDelta: (delta: string) => void,
): Promise<string> {
  const now = new Date();
  const runtimeContext: ChatRuntimeContext = {
    currentDate: toLocalDateKey(now),
    currentDateTime: now.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
  };

  return postTextStream('/api/chat', {
    profile,
    history,
    message,
    relatedDiaryEntries,
    runtimeContext,
  }, onDelta);
}
