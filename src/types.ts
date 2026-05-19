export type Mood = 'happy' | 'angry' | 'sad' | 'naughty' | 'surprised' | 'sleepy' | 'shy' | 'proud' | 'scared';
export type ResponseTone = 'mature' | 'gentle' | 'direct' | 'reflective' | 'cuddly' | 'custom';

export interface UserSettings {
  responseTone: ResponseTone;
  customToneRequest?: string;
  customTonePrompt?: string;
  brainLockEnabled?: boolean;
  brainPasscodeHash?: string;
  brainRecoveryQuestion?: string;
  brainRecoveryAnswerHash?: string;
}

export type MemorySeverity = 1 | 2 | 3 | 4 | 5;

export interface MemoryEvent {
  id: string;
  content: string;
  severity: MemorySeverity;
  source?: 'stress' | 'experience' | 'fear' | 'fact';
  created_at?: string;
  updated_at?: string;
}

export interface UserProfile {
  key_facts: string[];
  recent_mood: string;
  current_stressors: string[];
  deep_fears: string[];
  memory_events?: MemoryEvent[];
  rejected_memories?: string[];
  nickname?: string;
  settings?: UserSettings;
}

export interface ChatMessage {
  id?: string;
  conversation_id?: string;
  role: 'user' | 'model';
  content: string;
  created_at?: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at?: string;
  message_count?: number;
}

export interface WeatherSnapshot {
  temperatureC: number;
  conditionCode: number;
  conditionLabel: string;
  windSpeed: number;
  precipitation: number;
  timezone: string;
  source: 'open-meteo';
  capturedAt: string;
}

export interface PlaceSnapshot {
  city: string;
  region: string;
  country: string;
  label: string;
  source: 'nominatim';
  capturedAt: string;
}

export interface DiaryEntry {
  id: string;
  date: string;
  timestamp: number;
  content: string;
  mood?: Mood;
  weather?: WeatherSnapshot;
  place?: PlaceSnapshot;
  created_at?: string;
  updated_at?: string;
}

export interface ChatRuntimeContext {
  currentDate: string;
  currentDateTime: string;
  timeZone: string;
}

export interface ProfileRecord {
  id: string;
  user_id: string;
  profile: UserProfile;
  created_at: string;
  updated_at: string;
}
