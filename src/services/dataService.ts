import type { ChatConversation, ChatMessage, DiaryEntry, MemoryEvent, MemorySeverity, Mood, PlaceSnapshot, UserProfile, UserSettings, WeatherSnapshot } from '../types';
import { supabase } from './supabaseClient';

type DiaryRow = {
  id: string;
  entry_date: string;
  content: string;
  mood: Mood | null;
  weather?: WeatherSnapshot | null;
  place?: PlaceSnapshot | null;
  created_at: string;
  updated_at: string;
};

type ChatRow = {
  id: string;
  conversation_id: string | null;
  role: ChatMessage['role'];
  content: string;
  created_at: string;
};

type ChatConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  message_count: number | null;
};

const emptyProfile = (): UserProfile => ({
  key_facts: [],
    recent_mood: '',
    current_stressors: [],
    deep_fears: [],
    memory_events: [],
    rejected_memories: [],
  settings: {
    responseTone: 'mature',
  },
});

function normalizeSettings(settings: Partial<UserSettings> | null | undefined): UserSettings {
  const responseTone: string | undefined = typeof settings?.responseTone === 'string' ? settings.responseTone : undefined;
  const normalizedTone =
    responseTone === 'gentle' || responseTone === 'direct' || responseTone === 'reflective' || responseTone === 'cuddly' || responseTone === 'custom'
      ? responseTone
      : responseTone === 'doggy'
        ? 'cuddly'
        : 'mature';

  return {
    responseTone: normalizedTone,
    customToneRequest: typeof settings?.customToneRequest === 'string' ? settings.customToneRequest : '',
    customTonePrompt: typeof settings?.customTonePrompt === 'string' ? settings.customTonePrompt : '',
    brainLockEnabled: settings?.brainLockEnabled === true,
    brainPasscodeHash: typeof settings?.brainPasscodeHash === 'string' ? settings.brainPasscodeHash : '',
    brainRecoveryQuestion: typeof settings?.brainRecoveryQuestion === 'string' ? settings.brainRecoveryQuestion : '',
    brainRecoveryAnswerHash: typeof settings?.brainRecoveryAnswerHash === 'string' ? settings.brainRecoveryAnswerHash : '',
  };
}

function normalizeSeverity(value: unknown): MemorySeverity {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : 2;
}

function normalizeMemoryEvents(events: unknown): MemoryEvent[] {
  if (!Array.isArray(events)) return [];

  return events
    .filter((event): event is Partial<MemoryEvent> => typeof event === 'object' && event !== null)
    .map((event, index) => ({
      id: typeof event.id === 'string' && event.id ? event.id : `memory-${Date.now()}-${index}`,
      content: typeof event.content === 'string' ? event.content.trim() : '',
      severity: normalizeSeverity(event.severity),
      source: event.source,
      source_diary_id: typeof event.source_diary_id === 'string' ? event.source_diary_id : undefined,
      created_at: typeof event.created_at === 'string' ? event.created_at : undefined,
      updated_at: typeof event.updated_at === 'string' ? event.updated_at : undefined,
    }))
    .filter((event) => event.content);
}

function normalizeProfile(profile: Partial<UserProfile> | null | undefined): UserProfile {
  return {
    ...emptyProfile(),
    ...(profile || {}),
    key_facts: Array.isArray(profile?.key_facts) ? profile.key_facts : [],
    current_stressors: Array.isArray(profile?.current_stressors) ? profile.current_stressors : [],
    deep_fears: Array.isArray(profile?.deep_fears) ? profile.deep_fears : [],
    memory_events: normalizeMemoryEvents(profile?.memory_events),
    rejected_memories: Array.isArray(profile?.rejected_memories) ? profile.rejected_memories : [],
    recent_mood: typeof profile?.recent_mood === 'string' ? profile.recent_mood : '',
    settings: normalizeSettings(profile?.settings),
  };
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase 尚未配置，请先填写环境变量');
  }
  return supabase;
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatPlaceName(place: PlaceSnapshot): string {
  return place.city || place.label.split(/[，,]/)[0]?.trim() || place.label;
}

function toDiaryEntry(row: DiaryRow): DiaryEntry {
  const timestamp = new Date(`${row.entry_date}T12:00:00`).getTime();
  return {
    id: row.id,
    date: new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    timestamp,
    content: row.content,
    mood: row.mood || undefined,
    weather: row.weather || undefined,
    place: row.place || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getOrCreateProfile(userId: string): Promise<UserProfile> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('profiles')
    .select('profile')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (data?.profile) return normalizeProfile(data.profile as Partial<UserProfile>);

  const profile = emptyProfile();
  const { error: insertError } = await client
    .from('profiles')
    .insert({ user_id: userId, profile });

  if (insertError) throw insertError;
  return profile;
}

export async function saveProfile(userId: string, profile: UserProfile): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('profiles')
    .upsert({ user_id: userId, profile, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });

  if (error) throw error;
}

export async function listDiaryEntries(): Promise<DiaryEntry[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('diary_entries')
    .select('*')
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return ((data || []) as DiaryRow[]).map(toDiaryEntry);
}

export async function createDiaryEntry(
  entryDate: Date,
  content: string,
  mood: Mood | null,
  weather?: WeatherSnapshot,
  place?: PlaceSnapshot,
): Promise<DiaryEntry> {
  const client = requireSupabase();

  const baseEntry = {
    entry_date: toLocalDateString(entryDate),
    content,
    mood,
  };
  const entryWithContext = {
    ...baseEntry,
    weather: weather || null,
    place: place || null,
  };

  let { data, error } = await client
    .from('diary_entries')
    .insert(entryWithContext)
    .select('*')
    .single();

  if (error && isMissingDiaryContextColumnError(error)) {
    console.warn('DuoMi: weather/place columns missing in Supabase — embedding context into diary content as fallback');
    const contextSuffix = [
      weather ? `天气: ${weather.conditionLabel} ${Number.isFinite(weather.temperatureC) ? `${weather.temperatureC}°C` : ''}`.trim() : '',
      place ? `地点: ${formatPlaceName(place)}` : '',
    ].filter(Boolean).join('；');
    const enrichedEntry = {
      ...baseEntry,
      content: contextSuffix ? `${baseEntry.content}\n\n---\n${contextSuffix}` : baseEntry.content,
    };
    const retry = await client
      .from('diary_entries')
      .insert(enrichedEntry)
      .select('*')
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;
  return toDiaryEntry(data as DiaryRow);
}

function isMissingDiaryContextColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const details = [
    'message' in error ? String(error.message) : '',
    'details' in error ? String(error.details) : '',
    'hint' in error ? String(error.hint) : '',
    'code' in error ? String(error.code) : '',
  ].join(' ');

  return (
    details.includes('PGRST204')
    || /weather|place/i.test(details) && /column|schema cache|could not find/i.test(details)
  );
}

export async function updateDiaryEntry(id: string, content: string, mood: Mood | null): Promise<DiaryEntry> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('diary_entries')
    .update({ content, mood, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return toDiaryEntry(data as DiaryRow);
}

export async function deleteDiaryEntry(id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('diary_entries').delete().eq('id', id);
  if (error) throw error;
}

function toChatConversation(row: ChatConversationRow): ChatConversation {
  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_message_at: row.last_message_at || undefined,
    message_count: row.message_count || 0,
  };
}

export async function listChatConversations(): Promise<ChatConversation[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('chat_conversations')
    .select('id,title,created_at,updated_at,last_message_at,message_count')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return ((data || []) as ChatConversationRow[]).map(toChatConversation);
}

export async function createChatConversation(title: string): Promise<ChatConversation> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('chat_conversations')
    .insert({ title })
    .select('id,title,created_at,updated_at,last_message_at,message_count')
    .single();

  if (error) throw error;
  return toChatConversation(data as ChatConversationRow);
}

export async function deleteChatConversation(id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('chat_conversations').delete().eq('id', id);
  if (error) throw error;
}

export async function listChatMessages(conversationId: string): Promise<ChatMessage[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) throw error;
  return ((data || []) as ChatRow[]).map((row) => ({
    id: row.id,
    conversation_id: row.conversation_id || undefined,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
  }));
}

export async function createChatMessage(conversationId: string, role: ChatMessage['role'], content: string): Promise<ChatMessage> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('chat_messages')
    .insert({ conversation_id: conversationId, role, content })
    .select('*')
    .single();

  if (error) throw error;

  await client
    .from('chat_conversations')
    .update({
      last_message_at: data.created_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return {
    id: data.id,
    conversation_id: data.conversation_id,
    role: data.role,
    content: data.content,
    created_at: data.created_at,
  };
}

export async function deleteChatMessage(id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('chat_messages').delete().eq('id', id);
  if (error) throw error;
}

export async function clearAllUserData(userId: string): Promise<void> {
  const client = requireSupabase();
  const [diary, chat, conversations, profile] = await Promise.all([
    client.from('diary_entries').delete().eq('user_id', userId),
    client.from('chat_messages').delete().eq('user_id', userId),
    client.from('chat_conversations').delete().eq('user_id', userId),
    client.from('profiles').delete().eq('user_id', userId),
  ]);

  const error = diary.error || chat.error || conversations.error || profile.error;
  if (error) throw error;
}
