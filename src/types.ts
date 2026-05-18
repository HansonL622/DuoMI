export type Mood = 'happy' | 'angry' | 'sad' | 'naughty' | 'surprised' | 'sleepy' | 'shy' | 'proud' | 'scared';
export type ResponseTone = 'mature' | 'gentle' | 'direct' | 'reflective';

export interface UserSettings {
  responseTone: ResponseTone;
}

export interface UserProfile {
  key_facts: string[];
  recent_mood: string;
  current_stressors: string[];
  deep_fears: string[];
  rejected_memories?: string[];
  nickname?: string;
  settings?: UserSettings;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'model';
  content: string;
  created_at?: string;
}

export interface DiaryEntry {
  id: string;
  date: string;
  timestamp: number;
  content: string;
  mood?: Mood;
  created_at?: string;
  updated_at?: string;
}

export interface ProfileRecord {
  id: string;
  user_id: string;
  profile: UserProfile;
  created_at: string;
  updated_at: string;
}
