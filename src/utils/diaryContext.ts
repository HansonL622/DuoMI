import type { DiaryEntry } from '../types';

export function formatDiaryContext(entry: Pick<DiaryEntry, 'weather' | 'place'>): string {
  const parts: string[] = [];

  if (entry.place?.label) {
    parts.push(entry.place.label);
  }

  if (entry.weather) {
    const temperature = Math.round(entry.weather.temperatureC);
    parts.push(`${entry.weather.conditionLabel} · ${temperature}°C`);
  }

  return parts.join(' · ');
}
