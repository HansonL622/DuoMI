import { requireUser } from './_lib/auth';
import { checkRateLimit, RateLimitError } from './_lib/rateLimit';
import { getEnv } from './_lib/env';
import type { PlaceSnapshot, WeatherSnapshot } from '../src/types';

type ApiRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
};

type ApiResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

const REQUEST_TIMEOUT_MS = 12000;

const weatherCodeLabels: Record<number, string> = {
  0: '晴',
  1: '大部晴朗',
  2: '局部多云',
  3: '阴',
  45: '雾',
  48: '霜雾',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '大毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨',
  81: '强阵雨',
  82: '暴阵雨',
  85: '阵雪',
  86: '强阵雪',
  95: '雷暴',
  96: '雷暴伴冰雹',
  99: '强雷暴伴冰雹',
};

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseCoordinates(body: Record<string, unknown> | undefined): Coordinates {
  const latitude = body?.latitude;
  const longitude = body?.longitude;

  if (
    !isFiniteCoordinate(latitude)
    || !isFiniteCoordinate(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    throw new Error('定位坐标无效');
  }

  return { latitude, longitude };
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function compactLocationPart(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWeather({ latitude, longitude }: Coordinates): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,weather_code,precipitation,wind_speed_10m',
    timezone: 'auto',
  });
  const response = await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);

  if (!response.ok) {
    throw new Error('天气服务暂时不可用');
  }

  const payload = await response.json();
  const current = payload?.current || {};
  const conditionCode = typeof current.weather_code === 'number' ? current.weather_code : -1;

  return {
    temperatureC: typeof current.temperature_2m === 'number' ? current.temperature_2m : 0,
    conditionCode,
    conditionLabel: weatherCodeLabels[conditionCode] || '未知天气',
    windSpeed: typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : 0,
    precipitation: typeof current.precipitation === 'number' ? current.precipitation : 0,
    timezone: typeof payload?.timezone === 'string' ? payload.timezone : '',
    source: 'open-meteo',
    capturedAt: new Date().toISOString(),
  };
}

async function fetchPlace({ latitude, longitude }: Coordinates): Promise<PlaceSnapshot | undefined> {
  const params = new URLSearchParams({
    lat: String(roundCoordinate(latitude)),
    lon: String(roundCoordinate(longitude)),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '10',
    'accept-language': 'zh-CN,zh,en',
  });
  const siteUrl = getEnv('SITE_URL') || 'https://duomi.local';
  const response = await fetchWithTimeout(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
    headers: {
      'User-Agent': `DuoMi/1.0 (${siteUrl})`,
      Referer: siteUrl,
    },
  });

  if (!response.ok) {
    throw new Error('地点服务暂时不可用');
  }

  const payload = await response.json();
  const address = payload?.address || {};
  const city = compactLocationPart(address.city) || compactLocationPart(address.town) || compactLocationPart(address.village) || compactLocationPart(address.county);
  const region = compactLocationPart(address.state) || compactLocationPart(address.province) || compactLocationPart(address.region);
  const country = compactLocationPart(address.country);
  const label = [city, region, country].filter(Boolean).join('，');

  if (!label) return undefined;

  return {
    city,
    region,
    country,
    label,
    source: 'nominatim',
    capturedAt: new Date().toISOString(),
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    await requireUser(req);
    const coordinates = parseCoordinates(req.body);
    await checkRateLimit('diary-context', req);
    const [weatherResult, placeResult] = await Promise.allSettled([
      fetchWeather(coordinates),
      fetchPlace(coordinates),
    ]);

    res.status(200).json({
      weather: weatherResult.status === 'fulfilled' ? weatherResult.value : undefined,
      place: placeResult.status === 'fulfilled' ? placeResult.value : undefined,
      warning: weatherResult.status === 'rejected' || placeResult.status === 'rejected'
        ? '天气或地点背景暂时没有记录完整。'
        : '',
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      res.status(429).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : '天气和地点背景获取失败' });
  }
}
