import type { DiaryEntry } from '../types';

function formatPlaceName(place: NonNullable<DiaryEntry['place']>): string {
  if (place.city) return place.city;
  if (place.label) return place.label.split(/[，,]/)[0]?.trim() || place.label;
  return '';
}

export function formatDiaryContext(entry: Pick<DiaryEntry, 'weather' | 'place'>): string {
  const parts: string[] = [];

  if (entry.place) {
    const placeName = formatPlaceName(entry.place);
    if (placeName) parts.push(placeName);
  }

  if (entry.weather) {
    const temperature = Math.round(entry.weather.temperatureC);
    parts.push(`${entry.weather.conditionLabel} · ${temperature}°C`);
  }

  return parts.join(' · ');
}
