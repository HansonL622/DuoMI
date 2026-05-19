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

const LOCATION_TIMEOUT_MS = 8000;

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
  } catch {
    return {
      warning: '未获得定位权限，所以没有记录天气和地点背景。',
    };
  }

  try {
    return await fetchDiaryContext(coordinates);
  } catch {
    return {
      warning: '天气和地点背景暂时获取失败。',
    };
  }
}
