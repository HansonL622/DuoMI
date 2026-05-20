import type { PlaceSnapshot, WeatherSnapshot } from '../types';
import { supabase } from './supabaseClient';

type Coordinates = {
  latitude: number;
  longitude: number;
};

type DiaryContextResult = {
  weather?: WeatherSnapshot;
  place?: PlaceSnapshot;
  warning?: string;
};

const LOCATION_TIMEOUT_MS = 12000;
const CONTEXT_TIMEOUT_MS = 18000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}

function getCurrentPosition(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('当前浏览器不支持定位'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => reject(new Error('无法获取位置')),
      {
        enableHighAccuracy: false,
        maximumAge: 10 * 60 * 1000,
        timeout: LOCATION_TIMEOUT_MS,
      },
    );
  });
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };

  return {
    'Content-Type': 'application/json',
    ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
  };
}

async function fetchDiaryContext(coordinates: Coordinates): Promise<DiaryContextResult> {
  const response = await fetch('/api/diary-context', {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(coordinates),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || '天气和地点背景获取失败');
  }

  return {
    weather: payload?.weather,
    place: payload?.place,
    warning: typeof payload?.warning === 'string' ? payload.warning : '',
  };
}

export async function collectDiaryContext(): Promise<DiaryContextResult> {
  let coordinates: Coordinates;
  try {
    coordinates = await getCurrentPosition();
  } catch (locationError) {
    return {
      warning: locationError instanceof Error ? `未记录天气和地点：${locationError.message}` : '未获得定位权限，所以没有记录天气和地点背景。',
    };
  }

  try {
    return await withTimeout(fetchDiaryContext(coordinates), CONTEXT_TIMEOUT_MS, '天气和地点服务响应超时');
  } catch (contextError) {
    return {
      warning: contextError instanceof Error ? `天气和地点背景暂时获取失败：${contextError.message}` : '天气和地点背景暂时获取失败。',
    };
  }
}
