import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Brain,
  ChevronRight,
  Dog,
  Heart,
  Lock,
  Loader2,
  LogOut,
  Mail,
  MessageCircle,
  MessageSquare,
  PanelLeft,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { CalendarView } from './components/CalendarView';
import { DuoMiStage } from './components/DuoMiStage';
import { DuoMiFace } from './components/DuoMiFace';
import { collectDiaryContext } from './services/weatherService';
import {
  clearAllUserData,
  createChatConversation,
  createChatMessage,
  createDiaryEntry,
  deleteChatConversation,
  deleteDiaryEntry,
  deleteChatMessage,
  getOrCreateProfile,
  listChatConversations,
  listChatMessages,
  listDiaryEntries,
  saveProfile,
  updateDiaryEntry,
} from './services/dataService';
import { extractProfile, polishCustomTone, streamCompanionMessage } from './services/duomiApi';
import { isSupabaseConfigured, supabase } from './services/supabaseClient';
import type { ChatConversation, ChatMessage, DiaryEntry, MemoryEvent, MemorySeverity, Mood, PlaceSnapshot, ResponseTone, UserProfile, WeatherSnapshot } from './types';
import { formatDiaryContext } from './utils/diaryContext';

const moods: Mood[] = ['happy', 'angry', 'sad', 'naughty', 'surprised', 'sleepy', 'shy', 'proud', 'scared'];

const moodLabelMap: Record<Mood, string> = {
  happy: '开心',
  angry: '生气',
  sad: '难过',
  naughty: '调皮',
  surprised: '惊讶',
  sleepy: '困倦',
  shy: '害羞',
  proud: '得意',
  scared: '害怕',
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

const responseToneOptions: Array<{ value: ResponseTone; label: string; description: string }> = [
  { value: 'mature', label: '成熟克制', description: '稳定、清楚、不过度可爱' },
  { value: 'gentle', label: '温柔陪伴', description: '更柔和地承接情绪' },
  { value: 'direct', label: '直接清晰', description: '少铺垫，给明确建议' },
  { value: 'reflective', label: '分析反思', description: '帮助梳理触发点和需求' },
  { value: 'cuddly', label: '绒绒陪伴', description: '可爱、亲近、带一点小狗感' },
  { value: 'custom', label: '专属定制', description: '按你的描述生成语气' },
];

const severityOptions: Array<{ value: MemorySeverity; label: string; description: string }> = [
  { value: 1, label: '轻微', description: '很少主动提起' },
  { value: 2, label: '一般', description: '明确相关才参考' },
  { value: 3, label: '中等', description: '高度相关时提及' },
  { value: 4, label: '严重', description: '谨慎承接' },
  { value: 5, label: '高严重', description: '优先安全与稳定' },
];

const brainRecoveryQuestions = [
  '我小时候最喜欢的昵称是什么？',
  '我第一只宠物叫什么？',
  '我最熟悉的一位老师姓什么？',
  '我最喜欢的一道菜是什么？',
  '我最想去的城市是哪一座？',
];

type BrainUpdateState = {
  status: 'idle' | 'updating' | 'updated' | 'unchanged' | 'error';
  message?: string;
};

function normalizeRecoveryAnswer(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function hashText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return crypto.subtle.digest('SHA-256', bytes).then((hash) =>
    Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''),
  );
}

function getMemoryEvents(profile: UserProfile | null): MemoryEvent[] {
  if (!profile) return [];
  if (profile.memory_events?.length) return profile.memory_events;

  return [
    ...(profile.current_stressors || []).map((content, index) => ({
      id: `legacy-stress-${index}`,
      content,
      severity: 3 as MemorySeverity,
      source: 'stress' as const,
    })),
    ...(profile.deep_fears || []).map((content, index) => ({
      id: `legacy-fear-${index}`,
      content,
      severity: 4 as MemorySeverity,
      source: 'fear' as const,
    })),
    ...(profile.key_facts || []).map((content, index) => ({
      id: `legacy-fact-${index}`,
      content,
      severity: 2 as MemorySeverity,
      source: 'experience' as const,
    })),
  ].filter((event) => event.content);
}

function normalizeMemoryText(value: string): string {
  return value.replace(/[^\p{Letter}\p{Number}]+/gu, '').toLowerCase();
}

function getBigrams(value: string): Set<string> {
  const normalized = normalizeMemoryText(value);
  const bigrams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    bigrams.add(normalized.slice(index, index + 2));
  }
  return bigrams;
}

function isMemoryRelatedToEntry(memory: MemoryEvent, entry: DiaryEntry): boolean {
  if (memory.source_diary_id === entry.id) return true;

  const memoryText = normalizeMemoryText(memory.content);
  const entryText = normalizeMemoryText(entry.content);
  if (!memoryText || !entryText) return false;
  if (entryText.includes(memoryText.slice(0, 8)) || memoryText.includes(entryText.slice(0, 8))) return true;

  const entryBigrams = getBigrams(entry.content);
  let overlap = 0;
  getBigrams(memory.content).forEach((bigram) => {
    if (entryBigrams.has(bigram)) overlap += 1;
  });

  return overlap >= 4;
}

function tagProfileEventsFromDiary(nextProfile: UserProfile, previousProfile: UserProfile | null, diaryEntryId?: string): UserProfile {
  if (!diaryEntryId || !nextProfile.memory_events?.length) return nextProfile;

  const previousByContent = new Map((previousProfile?.memory_events || []).map((event) => [event.content, event]));
  return {
    ...nextProfile,
    memory_events: nextProfile.memory_events.map((event) => {
      const previous = previousByContent.get(event.content);
      return {
        ...event,
        source_diary_id: previous ? previous.source_diary_id || event.source_diary_id : event.source_diary_id || diaryEntryId,
      };
    }),
  };
}

function forgettingLabel(severity: MemorySeverity): string {
  if (severity <= 1) return '几天后会自然淡出';
  if (severity === 2) return '一两周无关就少提';
  if (severity === 3) return '只在高度相关时提及';
  if (severity === 4) return '谨慎保留，避免反复刺激';
  return '长期保留，优先安全边界';
}

function SetupScreen() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-[#F0EBE1] shadow-sm p-6 text-center">
        <ShieldCheck size={36} className="mx-auto text-[#F4A261] mb-4" />
        <h1 className="text-xl font-bold text-[#3D3D3D] mb-2">需要先配置云端服务</h1>
        <p className="text-sm text-[#8C8C8C] leading-relaxed">
          请在环境变量中设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。DuoMi 会把私密日记和聊天保存到你的 Supabase 项目中。
        </p>
      </div>
    </div>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [notice, setNotice] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!supabase || !email.trim() || password.length < 6) return;
    setIsSending(true);
    setError('');
    setNotice('');

    const credentials = {
      email: email.trim(),
      password,
    };

    const { data, error: authError } = authMode === 'login'
      ? await supabase.auth.signInWithPassword(credentials)
      : await supabase.auth.signUp({
        ...credentials,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

    setIsSending(false);
    if (authError) {
      setError(authError.message);
      return;
    }

    if (authMode === 'signup' && !data.session) {
      setNotice('账号已创建。若 Supabase 要求邮箱确认，请先打开邮件完成确认；之后即可用密码登录。');
      return;
    }
  };

  return (
    <div className="min-h-screen bg-[#E5E5E5] flex items-center justify-center sm:p-4 font-sans">
      <div className="w-full min-h-[100dvh] sm:min-h-0 sm:h-[844px] sm:max-w-[390px] bg-[#FDFBF7] sm:rounded-[40px] shadow-2xl relative flex flex-col overflow-hidden sm:border-[8px] border-[#333333] p-6">
        <div className="flex-1 flex flex-col justify-center">
          <div className="w-20 h-20 rounded-full bg-white border border-[#F0EBE1] flex items-center justify-center shadow-sm mb-6 overflow-hidden">
            <img src="/logo.png" alt="DuoMi" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-bold text-[#3D3D3D] mb-3">DuoMi</h1>
          <p className="text-sm text-[#8C8C8C] leading-relaxed mb-8">
            一只会认真记住你心事的小狗。登录后，你的日记、聊天和透明大脑会保存到私密云端。
          </p>

          <div className="bg-white rounded-3xl border border-[#F0EBE1] shadow-sm p-4">
            <div className="grid grid-cols-2 gap-2 mb-4 bg-[#FDFBF7] rounded-2xl p-1 border border-[#F0EBE1]">
              <button
                onClick={() => {
                  setAuthMode('login');
                  setError('');
                  setNotice('');
                }}
                className={`py-2 rounded-xl text-xs font-bold transition-colors ${authMode === 'login' ? 'bg-white text-[#F4A261] shadow-sm' : 'text-[#A0A0A0]'}`}
              >
                登录
              </button>
              <button
                onClick={() => {
                  setAuthMode('signup');
                  setError('');
                  setNotice('');
                }}
                className={`py-2 rounded-xl text-xs font-bold transition-colors ${authMode === 'signup' ? 'bg-white text-[#F4A261] shadow-sm' : 'text-[#A0A0A0]'}`}
              >
                注册
              </button>
            </div>

            <label className="text-xs font-bold uppercase tracking-widest text-[#A0A0A0]">邮箱</label>
            <div className="mt-3 flex items-center gap-2 bg-[#FDFBF7] border border-[#F0EBE1] rounded-2xl px-4 py-3">
              <Mail size={16} className="text-[#A0A0A0]" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="w-full bg-transparent outline-none text-sm text-[#3D3D3D]"
              />
            </div>
            <label className="block text-xs font-bold uppercase tracking-widest text-[#A0A0A0] mt-4">密码</label>
            <div className="mt-3 flex items-center gap-2 bg-[#FDFBF7] border border-[#F0EBE1] rounded-2xl px-4 py-3">
              <ShieldCheck size={16} className="text-[#A0A0A0]" />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleLogin();
                }}
                placeholder="至少 6 位"
                className="w-full bg-transparent outline-none text-sm text-[#3D3D3D]"
              />
            </div>
            {error && <p className="text-xs text-[#D96B52] mt-3">{error}</p>}
            {notice && <p className="text-xs text-[#5C8A61] mt-3">{notice}</p>}
            <button
              onClick={handleLogin}
              disabled={isSending || !email.trim() || password.length < 6}
              className="w-full mt-4 bg-[#F4A261] hover:bg-[#E79251] disabled:bg-[#F0D0B5] text-white py-3 rounded-2xl font-bold text-sm transition-colors flex items-center justify-center gap-2"
            >
              {isSending ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
              {authMode === 'login' ? '登录 DuoMi' : '创建账号'}
            </button>
          </div>
        </div>

        <div className="bg-white/70 rounded-2xl p-4 border border-[#F0EBE1] text-xs text-[#8C8C8C] leading-relaxed">
          DuoMi 是心理陪伴工具，不是医疗服务，也不提供专业心理咨询、诊断或治疗。你写下的日记和聊天内容会保存到 Supabase 云端数据库中，AI 回复由服务端调用模型生成。如果你正在经历紧急危险，请优先联系身边可信任的人或当地紧急服务。
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [activeTab, setActiveTab] = useState<'diary' | 'chat' | 'calendar'>('diary');
  const [isBrainOpen, setIsBrainOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const profileRef = useRef<UserProfile | null>(null);
  const profileUpdateQueueRef = useRef<Promise<void>>(Promise.resolve());
  profileRef.current = profile;
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntry[]>([]);
  const [chatConversations, setChatConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(false);
  const [isLoadingChatMessages, setIsLoadingChatMessages] = useState(false);

  const [diaryInput, setDiaryInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [isChatInputFocused, setIsChatInputFocused] = useState(false);
  const [selectedMood, setSelectedMood] = useState<Mood | null>(null);
  const [diaryDate, setDiaryDate] = useState<Date>(new Date());
  const [editingEntry, setEditingEntry] = useState<DiaryEntry | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editMood, setEditMood] = useState<Mood | null>(null);

  const [isExtracting, setIsExtracting] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isSavingCustomTone, setIsSavingCustomTone] = useState(false);
  const [isSavingBrainLock, setIsSavingBrainLock] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [isBrainUnlocked, setIsBrainUnlocked] = useState(false);
  const [brainPasscodeInput, setBrainPasscodeInput] = useState('');
  const [brainPasscodeDraft, setBrainPasscodeDraft] = useState('');
  const [brainRecoveryQuestionDraft, setBrainRecoveryQuestionDraft] = useState('');
  const [brainRecoveryAnswerDraft, setBrainRecoveryAnswerDraft] = useState('');
  const [brainDisablePasscode, setBrainDisablePasscode] = useState('');
  const [isBrainRecoveryOpen, setIsBrainRecoveryOpen] = useState(false);
  const [brainRecoveryAnswerInput, setBrainRecoveryAnswerInput] = useState('');
  const [brainResetPasscodeDraft, setBrainResetPasscodeDraft] = useState('');
  const [brainRecoveryError, setBrainRecoveryError] = useState('');
  const [brainUpdateState, setBrainUpdateState] = useState<BrainUpdateState>({ status: 'idle' });
  const [dogState, setDogState] = useState<'listening' | 'recording' | 'thinking' | 'responding'>('listening');
  const [error, setError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const userId = session?.user.id || '';
  const selectedResponseTone = profile?.settings?.responseTone || 'mature';
  const isBrainLockEnabled = profile?.settings?.brainLockEnabled === true && Boolean(profile?.settings?.brainPasscodeHash);
  const brainRecoveryQuestion = profile?.settings?.brainRecoveryQuestion || '';
  const canRecoverBrainPasscode = Boolean(brainRecoveryQuestion && profile?.settings?.brainRecoveryAnswerHash);
  const memoryEvents = useMemo(() => getMemoryEvents(profile), [profile]);
  const [customToneDraft, setCustomToneDraft] = useState('');
  const activeConversation = useMemo(
    () => chatConversations.find((conversation) => conversation.id === activeConversationId) || null,
    [activeConversationId, chatConversations],
  );

  useEffect(() => {
    if (isSettingsOpen) {
      setCustomToneDraft(profile?.settings?.customToneRequest || '');
    }
  }, [isSettingsOpen, profile?.settings?.customToneRequest]);

  useEffect(() => {
    if (!isBrainOpen) {
      setBrainPasscodeInput('');
      setIsBrainRecoveryOpen(false);
      setBrainRecoveryAnswerInput('');
      setBrainResetPasscodeDraft('');
      setBrainRecoveryError('');
      setIsBrainUnlocked(false);
      return;
    }

    setIsBrainUnlocked(!isBrainLockEnabled);
  }, [isBrainOpen, isBrainLockEnabled]);

  useEffect(() => {
    if (!supabase) {
      setIsBooting(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsBooting(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setDiaryEntries([]);
      setChatConversations([]);
      setActiveConversationId(null);
      setChatHistory([]);
      return;
    }

    let isActive = true;
    setIsLoadingData(true);
    setError(null);

    Promise.all([
      getOrCreateProfile(session.user.id),
      listDiaryEntries(),
      listChatConversations().catch((conversationError) => {
        console.warn('Chat conversations are not available yet.', conversationError);
        setError('聊天会话表还没有同步到 Supabase；日记和基础数据已正常加载。');
        return [];
      }),
    ])
      .then(([nextProfile, nextEntries, nextConversations]) => {
        if (!isActive) return;
        setProfile(nextProfile);
        setDiaryEntries(nextEntries);
        setChatConversations(nextConversations);
        setActiveConversationId(null);
        setChatHistory([]);
      })
      .catch((loadError) => {
        if (!isActive) return;
        setError(loadError instanceof Error ? loadError.message : '数据加载失败');
      })
      .finally(() => {
        if (isActive) setIsLoadingData(false);
      });

    return () => {
      isActive = false;
    };
  }, [session]);

  useEffect(() => {
    if (streamingMessageId) setDogState('responding');
    else if (isChatting) setDogState('thinking');
    else if (isResponding) setDogState('responding');
    else if (chatInput.trim().length > 0) setDogState('recording');
    else setDogState('listening');
  }, [isChatting, isResponding, streamingMessageId, chatInput]);

  useEffect(() => {
    if (window.location.search.includes('settings=1')) {
      setIsSettingsOpen(true);
    }
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  useEffect(() => {
    if (!activeConversationId) {
      setChatHistory([]);
      return;
    }
    if (isChatting) return;

    let isActive = true;
    setIsLoadingChatMessages(true);
    setError(null);

    listChatMessages(activeConversationId)
      .then((messages) => {
        if (isActive) setChatHistory(messages);
      })
      .catch((loadError) => {
        if (isActive) setError(loadError instanceof Error ? loadError.message : '聊天记录加载失败');
      })
      .finally(() => {
        if (isActive) setIsLoadingChatMessages(false);
      });

    return () => {
      isActive = false;
    };
  }, [activeConversationId, isChatting]);

  const relatedDiaryEntries = useMemo(() => diaryEntries.slice(0, 8), [diaryEntries]);
  const recentDiaryEntries = useMemo(() => diaryEntries.slice(0, 5), [diaryEntries]);

  const persistProfile = async (nextProfile: UserProfile) => {
    if (!userId) return;
    profileRef.current = nextProfile;
    setProfile(nextProfile);
    await saveProfile(userId, nextProfile);
  };

  const queueProfileExtraction = (
    content: string,
    moodLabel?: string,
    weather?: WeatherSnapshot,
    place?: PlaceSnapshot,
    diaryEntryId?: string,
  ) => {
    setBrainUpdateState({ status: 'updating', message: '正在整理新日记里的重要信息。' });
    const nextTask = profileUpdateQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const latestProfile = profileRef.current;
        const previousContents = new Set((latestProfile?.memory_events || []).map((event) => event.content));
        const extractedProfile = await extractProfile(latestProfile, content, moodLabel, weather, place);
        const nextProfile = tagProfileEventsFromDiary(extractedProfile, latestProfile, diaryEntryId);
        await persistProfile({
          ...nextProfile,
          rejected_memories: latestProfile?.rejected_memories || nextProfile.rejected_memories || [],
        });
        const addedMemory = (nextProfile.memory_events || []).some((event) => !previousContents.has(event.content));
        setBrainUpdateState(
          addedMemory
            ? { status: 'updated', message: '已更新重要记忆。' }
            : { status: 'unchanged', message: '已整理完成；这篇日记暂时没有新增需要长期记住的事项。' },
        );
      });

    profileUpdateQueueRef.current = nextTask;
    return nextTask;
  };

  const handleChangeResponseTone = async (responseTone: ResponseTone) => {
    const base = profile || emptyProfile();
    const nextProfile: UserProfile = {
      ...base,
      settings: {
        ...(base.settings || emptyProfile().settings),
        responseTone,
      },
    };
    try {
      setError(null);
      await persistProfile(nextProfile);
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : '语气设置保存失败');
    }
  };

  const handleSaveCustomTone = async () => {
    const userRequest = customToneDraft.trim();
    if (!userRequest || isSavingCustomTone) return;

    setIsSavingCustomTone(true);
    setError(null);
    try {
      const customTonePrompt = await polishCustomTone(userRequest);
      const base = profile || emptyProfile();
      const nextProfile: UserProfile = {
        ...base,
        settings: {
          ...(base.settings || emptyProfile().settings),
          responseTone: 'custom',
          customToneRequest: userRequest,
          customTonePrompt,
        },
      };
      await persistProfile(nextProfile);
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : '专属语气保存失败');
    } finally {
      setIsSavingCustomTone(false);
    }
  };

  const handleSaveDiary = async () => {
    if (!diaryInput.trim() && !selectedMood) return;

    const content = diaryInput.trim() || '（仅记录了心情）';
    const mood = selectedMood;
    setIsExtracting(true);
    setError(null);

    try {
      const diaryContext = await collectDiaryContext();
      const savedEntry = await createDiaryEntry(diaryDate, content, mood, diaryContext.weather, diaryContext.place);
      const saveNotes: string[] = [];
      setDiaryEntries((prev) => [savedEntry, ...prev].sort((a, b) => b.timestamp - a.timestamp));
      setDiaryInput('');
      setSelectedMood(null);
      setDiaryDate(new Date());
      setActiveTab('calendar');
      if (diaryContext.warning) {
        saveNotes.push(diaryContext.warning);
      } else if ((diaryContext.weather || diaryContext.place) && !savedEntry.weather && !savedEntry.place) {
        saveNotes.push('Supabase 还没有同步天气和地点字段，所以这次只保存了文字和心情。');
      }

      const moodLabel = mood ? moodLabelMap[mood] : undefined;
      if (saveNotes.length > 0) {
        setError(`日记已保存；${saveNotes.join('；')}`);
      }
      queueProfileExtraction(
        content,
        moodLabel,
        savedEntry.weather || diaryContext.weather,
        savedEntry.place || diaryContext.place,
        savedEntry.id,
      ).catch((profileError) => {
        const profileMessage = profileError instanceof Error ? profileError.message : '画像更新失败';
        setBrainUpdateState({ status: 'error', message: `大脑更新失败：${profileMessage}` });
        setError(`日记已保存；大脑更新失败：${profileMessage}`);
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '日记保存失败');
    } finally {
      setIsExtracting(false);
    }
  };

  const openEditEntry = (entry: DiaryEntry) => {
    setEditingEntry(entry);
    setEditContent(entry.content);
    setEditMood(entry.mood || null);
  };

  const handleUpdateEntry = async () => {
    if (!editingEntry || !editContent.trim()) return;
    setIsSavingEdit(true);
    setError(null);

    try {
      const updated = await updateDiaryEntry(editingEntry.id, editContent.trim(), editMood);
      setDiaryEntries((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
      setEditingEntry(null);

      try {
        await queueProfileExtraction(updated.content, updated.mood ? moodLabelMap[updated.mood] : undefined, updated.weather, updated.place, updated.id);
      } catch (profileError) {
        setError(profileError instanceof Error ? `日记已更新，但画像更新失败：${profileError.message}` : '日记已更新，但画像更新失败');
      }
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '日记更新失败');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteEntry = async (entry: DiaryEntry) => {
    if (!window.confirm('确定要删除这条日记吗？')) return;
    setError(null);

    try {
      await deleteDiaryEntry(entry.id);
      setDiaryEntries((prev) => prev.filter((item) => item.id !== entry.id));
      const base = profileRef.current;
      if (base) {
        const relatedContents = new Set(
          (base.memory_events || [])
            .filter((memory) => isMemoryRelatedToEntry(memory, entry))
            .map((memory) => memory.content),
        );
        if (relatedContents.size > 0) {
          await persistProfile({
            ...base,
            memory_events: (base.memory_events || []).filter((memory) => !relatedContents.has(memory.content)),
            current_stressors: base.current_stressors.filter((item) => !relatedContents.has(item)),
            key_facts: base.key_facts.filter((item) => !relatedContents.has(item)),
            deep_fears: base.deep_fears.filter((item) => !relatedContents.has(item)),
          });
        }
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '日记删除失败');
    }
  };

  const makeConversationTitle = (message: string) => {
    const compact = message.replace(/\s+/g, ' ').trim();
    return compact.length > 18 ? `${compact.slice(0, 18)}...` : compact || '新的对话';
  };

  const handleNewConversation = () => {
    setActiveConversationId(null);
    setChatHistory([]);
    setChatInput('');
    setIsChatSidebarOpen(false);
    setActiveTab('chat');
    setTimeout(() => chatInputRef.current?.focus(), 0);
  };

  const handleSelectConversation = (conversationId: string) => {
    if (conversationId === activeConversationId) {
      setIsChatSidebarOpen(false);
      return;
    }

    setActiveConversationId(conversationId);
    setChatInput('');
    setIsChatSidebarOpen(false);
    setActiveTab('chat');
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (!window.confirm('确定要删除这个对话吗？')) return;
    setError(null);

    try {
      await deleteChatConversation(conversationId);
      setChatConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
        setChatHistory([]);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '对话删除失败');
    }
  };

  const handleSendMessage = async () => {
    const userMsg = chatInput.trim();
    if (!userMsg || isChatting) return;

    setChatInput('');
    setIsChatting(true);
    setIsResponding(false);
    setError(null);

    let conversationId: string | null = null;
    let savedUserMessageId: string | null = null;
    const pendingUserMessage: ChatMessage = {
      id: `pending-user-${Date.now()}`,
      conversation_id: '',
      role: 'user',
      content: userMsg,
      created_at: new Date().toISOString(),
    };
    const pendingModelMessage: ChatMessage = {
      id: `pending-model-${Date.now()}`,
      conversation_id: '',
      role: 'model',
      content: '',
      created_at: new Date().toISOString(),
    };

    try {
      conversationId = activeConversationId;
      if (!conversationId) {
        const createdConversation = await createChatConversation(makeConversationTitle(userMsg));
        conversationId = createdConversation.id;
        setActiveConversationId(createdConversation.id);
        setChatConversations((prev) => [createdConversation, ...prev]);
      }

      pendingUserMessage.conversation_id = conversationId;
      pendingModelMessage.conversation_id = conversationId;
      const nextHistory = [...chatHistory, pendingUserMessage];
      setChatHistory(nextHistory);
      let hasStartedStreaming = false;
      let streamedResponse = '';

      const response = await streamCompanionMessage(profile, nextHistory, userMsg, relatedDiaryEntries, (delta) => {
        streamedResponse += delta;
        const isFirstDelta = !hasStartedStreaming;
        if (isFirstDelta) {
          hasStartedStreaming = true;
          setStreamingMessageId(pendingModelMessage.id);
        }

        setChatHistory((prev) => {
          if (isFirstDelta) {
            return [...prev, { ...pendingModelMessage, content: streamedResponse }];
          }

          return prev.map((messageItem) =>
            messageItem.id === pendingModelMessage.id
              ? { ...messageItem, content: streamedResponse }
              : messageItem,
          );
        });
      });

      if (!hasStartedStreaming) {
        setChatHistory((prev) => [...prev, { ...pendingModelMessage, content: response }]);
      }

      const savedUserMessage = await createChatMessage(conversationId, 'user', userMsg);
      savedUserMessageId = savedUserMessage.id || null;
      const savedModelMessage = await createChatMessage(conversationId, 'model', response);
      setChatHistory((prev) =>
        prev.map((messageItem) => {
          if (messageItem.id === pendingUserMessage.id) return savedUserMessage;
          if (messageItem.id === pendingModelMessage.id) return savedModelMessage;
          return messageItem;
        }),
      );
      setChatConversations((prev) =>
        prev
          .map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  last_message_at: savedModelMessage.created_at,
                  updated_at: savedModelMessage.created_at || new Date().toISOString(),
                  message_count: (conversation.message_count || 0) + 2,
                }
              : conversation,
          )
          .sort((a, b) => new Date(b.last_message_at || b.updated_at).getTime() - new Date(a.last_message_at || a.updated_at).getTime()),
      );
    } catch (chatError) {
      setChatInput(userMsg);
      setError(chatError instanceof Error ? chatError.message : 'DuoMi 暂时没有回应');
      setChatHistory((prev) =>
        prev.filter((msg) => msg.id !== pendingUserMessage.id && msg.id !== pendingModelMessage.id),
      );
      if (savedUserMessageId) {
        deleteChatMessage(savedUserMessageId).catch(() => {});
      }
      if (!activeConversationId && conversationId) {
        deleteChatConversation(conversationId).catch(() => {});
        setChatConversations((prev) => prev.filter((c) => c.id !== conversationId));
      }
    } finally {
      setIsChatting(false);
      setStreamingMessageId(null);
      setIsResponding(true);
      setTimeout(() => setIsResponding(false), 5000);
    }
  };

  const persistMemoryEvents = async (nextEvents: MemoryEvent[]) => {
    const base = profile || emptyProfile();
    await persistProfile({
      ...base,
      memory_events: nextEvents,
    });
  };

  const handleForgetMemory = async (memory: MemoryEvent, reject: boolean) => {
    const base = profile || emptyProfile();
    const nextProfile: UserProfile = {
      ...base,
      memory_events: memoryEvents.filter((item) => item.id !== memory.id),
      current_stressors: base.current_stressors.filter((item) => item !== memory.content),
      key_facts: base.key_facts.filter((item) => item !== memory.content),
      deep_fears: base.deep_fears.filter((item) => item !== memory.content),
      rejected_memories: reject ? Array.from(new Set([...(base.rejected_memories || []), memory.content])) : base.rejected_memories || [],
    };
    await persistProfile(nextProfile);
  };

  const handleChangeMemorySeverity = async (memory: MemoryEvent, severity: MemorySeverity) => {
    const normalizedEvents = memoryEvents.map((item) =>
      item.id === memory.id
        ? {
            ...item,
            severity,
            updated_at: new Date().toISOString(),
          }
        : item,
    );
    await persistMemoryEvents(normalizedEvents);
  };

  const handleUnlockBrain = async () => {
    const passcode = brainPasscodeInput.trim();
    if (!passcode || !profile?.settings?.brainPasscodeHash) return;

    const hash = await hashText(passcode);
    if (hash !== profile.settings.brainPasscodeHash) {
      setError('透明大脑密码不正确');
      return;
    }

    setBrainPasscodeInput('');
    setError(null);
    setIsBrainUnlocked(true);
  };

  const handleEnableBrainLock = async () => {
    const passcode = brainPasscodeDraft.trim();
    const recoveryQuestion = brainRecoveryQuestionDraft.trim();
    const recoveryAnswer = normalizeRecoveryAnswer(brainRecoveryAnswerDraft);
    if (passcode.length < 4) {
      setError('透明大脑密码至少 4 位');
      return;
    }
    if (!recoveryQuestion || !recoveryAnswer) {
      setError('请设置一个验证问题和答案，避免忘记密码后无法找回');
      return;
    }

    setIsSavingBrainLock(true);
    setError(null);
    try {
      const base = profile || emptyProfile();
      await persistProfile({
        ...base,
        settings: {
          ...(base.settings || emptyProfile().settings),
          brainLockEnabled: true,
          brainPasscodeHash: await hashText(passcode),
          brainRecoveryQuestion: recoveryQuestion,
          brainRecoveryAnswerHash: await hashText(recoveryAnswer),
        },
      });
      setBrainPasscodeDraft('');
      setBrainRecoveryQuestionDraft('');
      setBrainRecoveryAnswerDraft('');
    } catch (lockError) {
      setError(lockError instanceof Error ? lockError.message : '透明大脑密码保存失败');
    } finally {
      setIsSavingBrainLock(false);
    }
  };

  const handleDisableBrainLock = async () => {
    const passcode = brainDisablePasscode.trim();
    if (!passcode || !profile?.settings?.brainPasscodeHash) {
      setError('请先输入当前透明大脑密码');
      return;
    }

    const hash = await hashText(passcode);
    if (hash !== profile.settings.brainPasscodeHash) {
      setError('当前透明大脑密码不正确');
      return;
    }

    const base = profile || emptyProfile();
    await persistProfile({
      ...base,
      settings: {
        ...(base.settings || emptyProfile().settings),
        brainLockEnabled: false,
        brainPasscodeHash: '',
        brainRecoveryQuestion: '',
        brainRecoveryAnswerHash: '',
      },
    });
    setBrainDisablePasscode('');
    setIsBrainUnlocked(true);
  };

  const handleResetBrainLock = async () => {
    const answer = normalizeRecoveryAnswer(brainRecoveryAnswerInput);
    const nextPasscode = brainResetPasscodeDraft.trim();
    setBrainRecoveryError('');
    if (!profile?.settings?.brainRecoveryAnswerHash || !answer || nextPasscode.length < 4) {
      setBrainRecoveryError('请填写验证答案，并设置至少 4 位的新密码');
      return;
    }

    const answerHash = await hashText(answer);
    if (answerHash !== profile.settings.brainRecoveryAnswerHash) {
      setBrainRecoveryError('验证答案不正确，请重新输入');
      return;
    }

    const base = profile || emptyProfile();
    await persistProfile({
      ...base,
      settings: {
        ...(base.settings || emptyProfile().settings),
        brainLockEnabled: true,
        brainPasscodeHash: await hashText(nextPasscode),
      },
    });
    setBrainPasscodeInput('');
    setBrainRecoveryAnswerInput('');
    setBrainResetPasscodeDraft('');
    setBrainRecoveryError('');
    setIsBrainRecoveryOpen(false);
    setIsBrainUnlocked(true);
    setError(null);
  };

  const handleClearMemory = async () => {
    if (!userId || !window.confirm('确定要清空所有日记、聊天和 DuoMi 记忆吗？')) return;
    setError(null);

    try {
      await clearAllUserData(userId);
      const freshProfile = emptyProfile();
      await saveProfile(userId, freshProfile);
      setProfile(freshProfile);
      setDiaryEntries([]);
      setChatConversations([]);
      setActiveConversationId(null);
      setChatHistory([]);
      setIsBrainOpen(false);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : '清空失败');
    }
  };

  const handleSignOut = async () => {
    await supabase?.auth.signOut();
  };

  if (!isSupabaseConfigured) return <SetupScreen />;
  if (isBooting) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center text-[#F4A261]">
        <Loader2 size={28} className="animate-spin" />
      </div>
    );
  }
  if (!session) return <AuthScreen />;

  return (
    <div className="min-h-screen bg-[#E5E5E5] flex items-center justify-center sm:p-4 font-sans selection:bg-[#F4A261]/30">
      <div className="w-full h-[100dvh] sm:h-[844px] sm:max-w-[390px] bg-[#FDFBF7] sm:rounded-[40px] shadow-2xl relative flex flex-col overflow-hidden sm:border-[8px] border-[#333333]">
        <header className="absolute top-0 left-0 right-0 h-20 flex items-start pt-5 justify-between px-5 z-50 pointer-events-none">
          <button
            className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity pointer-events-auto shadow-sm rounded-full bg-white/80 backdrop-blur-md p-1 pl-1 pr-3 border border-white"
            onClick={() => setIsSettingsOpen(true)}
          >
            <div className="w-8 h-8 rounded-full bg-[#FFF0E5] border border-[#FFE4D6] flex items-center justify-center shrink-0 overflow-hidden relative">
              <img src="/logo.png" alt="DuoMi" className="w-full h-full object-cover" />
            </div>
            <div className="flex flex-col pr-1 text-left">
              <span className="font-bold text-[#3D3D3D] leading-tight tracking-tight text-xs">DuoMi</span>
              <span className="text-[9px] text-[#A0A0A0] font-medium leading-tight pt-0.5">私密陪伴</span>
            </div>
          </button>
          <div className="flex items-center gap-2 pointer-events-auto">
            {activeTab === 'chat' && (
              <button
                onClick={() => setIsChatSidebarOpen(true)}
                className="w-10 h-10 rounded-full bg-white/80 backdrop-blur-md shadow-sm border border-white flex items-center justify-center text-[#8C8C8C] hover:text-[#F4A261] hover:bg-[#FFF0E5] transition-colors"
                aria-label="打开对话列表"
              >
                <PanelLeft size={18} />
              </button>
            )}
            <button
              onClick={() => setIsBrainOpen(true)}
              className="w-10 h-10 rounded-full bg-white/80 backdrop-blur-md shadow-sm border border-white flex items-center justify-center text-[#8C8C8C] hover:text-[#F4A261] hover:bg-[#FFF0E5] transition-colors"
              aria-label="打开透明的大脑"
            >
              <Brain size={18} />
            </button>
          </div>
        </header>

        {error && (
          <div className="absolute top-20 left-0 right-0 bg-[#FFF0ED] text-[#D96B52] px-5 py-2.5 text-xs flex items-center justify-between z-40">
            <span className="font-medium leading-relaxed">{error}</span>
            <button onClick={() => setError(null)} className="opacity-70 hover:opacity-100 p-1"><X size={14} /></button>
          </div>
        )}

        <main className="flex-1 overflow-hidden relative bg-[#FDFBF7]">
          {isLoadingData && (
            <div className="absolute inset-0 z-30 bg-[#FDFBF7]/80 backdrop-blur-sm flex items-center justify-center text-[#F4A261]">
              <Loader2 size={28} className="animate-spin" />
            </div>
          )}

          <div className={`absolute inset-0 flex flex-col transition-opacity duration-300 ${activeTab === 'diary' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}>
            <div className="flex-1 overflow-y-auto p-5 pt-20 pb-24">
              <div className="mb-6">
                <h2 className="text-xl font-bold text-[#3D3D3D] mb-1">
                  {diaryDate.toDateString() === new Date().toDateString()
                    ? '写给 DuoMi'
                    : `补充记忆：${diaryDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
                </h2>
                <p className="text-sm text-[#8C8C8C]">
                  {diaryDate.toDateString() === new Date().toDateString()
                    ? '把你的心事写下来，我会认真记住。'
                    : '补写这一天的心事，DuoMi 也会认真倾听。'}
                </p>
              </div>

              <div className="mb-6">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#A0A0A0] mb-3">今天心情怎么样？</h3>
                <div className="flex gap-3 overflow-x-auto pb-2 snap-x [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
                  {moods.map((mood) => (
                    <button
                      key={mood}
                      onClick={() => setSelectedMood(mood)}
                      className={`flex-shrink-0 w-[calc(25%-9px)] min-w-[72px] sm:w-[calc(20%-9.6px)] snap-start flex flex-col items-center justify-center gap-2 py-2 transition-all ${selectedMood === mood ? 'transform scale-105' : 'opacity-80 hover:opacity-100'}`}
                    >
                      <div className={`rounded-xl transition-all overflow-hidden ${selectedMood === mood ? 'border-2 border-[#F4A261] shadow-sm' : 'border-2 border-transparent'}`}>
                        <DuoMiFace mood={mood} className="w-12 h-12 block" />
                      </div>
                      <span className={`text-[11px] font-bold ${selectedMood === mood ? 'text-[#F4A261]' : 'text-[#A0A0A0]'}`}>{moodLabelMap[mood]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-[#F0EBE1] flex flex-col min-h-[240px] mb-8 overflow-hidden focus-within:ring-2 focus-within:ring-[#F4A261]/20 transition-shadow">
                <textarea
                  value={diaryInput}
                  onChange={(event) => setDiaryInput(event.target.value)}
                  placeholder="今天发生了什么？你感觉怎么样？..."
                  className="flex-1 w-full p-5 resize-none outline-none text-[#3D3D3D] leading-relaxed bg-transparent placeholder:text-[#C0C0C0] text-[15px]"
                />
                <div className="p-3 border-t border-[#F0EBE1] flex justify-end bg-[#FAFAFA]">
                  <button
                    onClick={handleSaveDiary}
                    disabled={isExtracting || (!diaryInput.trim() && !selectedMood)}
                    className="flex items-center gap-2 bg-[#F4A261] hover:bg-[#E79251] disabled:bg-[#F0D0B5] text-white px-5 py-2.5 rounded-2xl font-semibold text-sm transition-all active:scale-95 shadow-sm"
                  >
                    {isExtracting ? <><Loader2 size={16} className="animate-spin" /> 正在保存...</> : <><Heart size={16} fill="currentColor" /> 告诉 DuoMi</>}
                  </button>
                </div>
              </div>

              {diaryEntries.length > 0 ? (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#A0A0A0] mb-4 flex items-center gap-2">
                    过往心事 <span className="h-px flex-1 bg-[#F0EBE1]"></span>
                  </h3>
                  <div className="space-y-3">
                    {recentDiaryEntries.map((entry) => (
                      <div key={entry.id} className="bg-white p-4 rounded-2xl shadow-sm border border-[#F0EBE1]">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div>
                            <div className="text-[11px] font-medium text-[#A0A0A0]">{entry.date}</div>
                            {formatDiaryContext(entry) && (
                              <div className="mt-1 text-[11px] font-medium text-[#8C8C8C]">{formatDiaryContext(entry)}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEditEntry(entry)} className="p-1.5 rounded-full text-[#A0A0A0] hover:text-[#F4A261] hover:bg-[#FFF0E5]"><Pencil size={13} /></button>
                            <button onClick={() => handleDeleteEntry(entry)} className="p-1.5 rounded-full text-[#A0A0A0] hover:text-[#D96B52] hover:bg-[#FFF0ED]"><Trash2 size={13} /></button>
                          </div>
                        </div>
                        {entry.mood && (
                          <div className="flex items-center gap-1 bg-[#FFF0E5] px-2 py-1 rounded-lg w-fit mb-2">
                            <DuoMiFace mood={entry.mood} className="w-4 h-4" />
                            <span className="text-[10px] font-bold text-[#F4A261]">{moodLabelMap[entry.mood]}</span>
                          </div>
                        )}
                        <p className="text-[#5C5C5C] text-sm whitespace-pre-wrap leading-relaxed">{entry.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-[#A0A0A0] text-sm">还没有日记。DuoMi 在这里等你慢慢说。</div>
              )}
            </div>
          </div>

          <div className={`absolute inset-0 flex flex-col transition-opacity duration-300 ${activeTab === 'chat' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}>
            <div className="shrink-0 pt-18 pb-1 px-0 relative z-20 fade-in">
              <DuoMiStage
                mode={dogState}
                isFocused={isChatInputFocused}
                hasText={chatInput.trim().length > 0}
                onTap={() => chatInputRef.current?.focus()}
              />
            </div>

            <div className="px-5 pb-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setIsChatSidebarOpen(true)}
                className="min-w-0 flex items-center gap-2 text-left text-[#3D3D3D] hover:text-[#F4A261] transition-colors"
              >
                <MessageSquare size={15} className="shrink-0" />
                <span className="truncate text-xs font-bold">{activeConversation?.title || '新的对话'}</span>
              </button>
              <button
                type="button"
                onClick={handleNewConversation}
                className="shrink-0 w-8 h-8 rounded-full bg-white border border-[#F0EBE1] text-[#F4A261] flex items-center justify-center shadow-sm hover:bg-[#FFF0E5] transition-colors"
                aria-label="新建对话"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-28 pt-1 space-y-3 mask-fade-top">
              {isLoadingChatMessages ? (
                <div className="h-full flex items-center justify-center text-[#F4A261]">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              ) : chatHistory.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-[280px] mx-auto text-[#A0A0A0] text-sm">
                  <MessageCircle size={26} className="mb-3 opacity-50" />
                  {activeConversationId ? '这个对话还没有内容。' : '这是一个新对话，说点什么开始吧。'}
                </div>
              ) : (
                chatHistory.map((msg, idx) => (
                  <div key={msg.id || idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'model' && (
                      <div className="w-7 h-7 rounded-full bg-[#FFF0E5] border border-[#FFE4D6] flex items-center justify-center shrink-0 mr-2 mt-auto mb-1">
                        <Dog size={16} className="text-[#F4A261] mt-0.5" strokeWidth={2.5} />
                      </div>
                    )}
                    <div className={`max-w-[82%] rounded-[22px] px-4 py-3 text-[14px] leading-6 shadow-sm whitespace-pre-wrap ${msg.role === 'user' ? 'bg-[#F4A261] text-white rounded-br-md' : 'bg-white text-[#3D3D3D] border border-[#F0EBE1] rounded-bl-md'}`}>
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
              {isChatting && !streamingMessageId && (
                <div className="flex justify-start">
                  <div className="w-7 h-7 rounded-full bg-[#FFF0E5] border border-[#FFE4D6] flex items-center justify-center shrink-0 mr-2 mt-auto mb-1">
                    <Dog size={16} className="text-[#F4A261] mt-0.5" strokeWidth={2.5} />
                  </div>
                  <div className="bg-white border border-[#F0EBE1] rounded-[22px] rounded-bl-md px-4 py-3 shadow-sm flex items-center gap-2 text-[#8C8C8C] text-sm">
                    <Loader2 size={14} className="animate-spin" /> DuoMi 正在思考...
                  </div>
                </div>
              )}
              <div ref={chatEndRef} className="h-1" />
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#FDFBF7] via-[#FDFBF7] to-transparent pt-10">
              <div className="relative flex items-center bg-white rounded-full shadow-sm border border-[#F0EBE1] p-1.5 focus-within:ring-2 focus-within:ring-[#F4A261]/20 transition-shadow">
                <input
                  ref={chatInputRef}
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onFocus={() => setIsChatInputFocused(true)}
                  onBlur={() => setIsChatInputFocused(false)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="摸摸 DuoMi 的头，说点什么..."
                  className="w-full bg-transparent border-none pl-4 pr-12 py-2.5 outline-none text-[#3D3D3D] placeholder:text-[#A0A0A0] text-[15px]"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={isChatting || !chatInput.trim()}
                  className="absolute right-2 w-9 h-9 flex items-center justify-center rounded-full bg-[#F4A261] text-white hover:bg-[#E79251] disabled:bg-[#F4F5F7] disabled:text-[#C0C0C0] transition-colors"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className={`absolute inset-0 flex flex-col transition-opacity duration-300 ${activeTab === 'calendar' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}>
            <div className="flex-1 overflow-y-auto p-5 pt-20 pb-24">
              <CalendarView
                entries={diaryEntries}
                onAddMemory={(date) => {
                  setDiaryDate(date);
                  setActiveTab('diary');
                }}
                onEditEntry={openEditEntry}
                onDeleteEntry={handleDeleteEntry}
              />
            </div>
          </div>
        </main>

        <nav className="h-[84px] bg-white border-t border-[#F0EBE1] flex items-center justify-around px-6 pb-6 pt-2 shrink-0 z-20">
          <button
            onClick={() => {
              setDiaryDate(new Date());
              setActiveTab('diary');
            }}
            className="flex flex-col items-center gap-1 w-16 transition-colors"
          >
            <div className={`p-1 rounded-xl transition-all ${activeTab === 'diary' ? 'scale-110 border-2 border-[#F4A261] shadow-sm' : 'scale-100 hover:scale-105 border-2 border-transparent hover:bg-[#FDFBF7]'}`}>
              <img src="/diary-icon.png" alt="日记" className={`w-8 h-8 block object-contain mix-blend-multiply transition-opacity ${activeTab === 'diary' ? 'opacity-100' : 'opacity-80'}`} />
            </div>
            <span className={`text-[10px] font-semibold transition-colors ${activeTab === 'diary' ? 'text-[#F4A261]' : 'text-[#A0A0A0]'}`}>日记</span>
          </button>

          <button onClick={() => setActiveTab('chat')} className="flex flex-col items-center gap-1 w-16 transition-colors relative -top-3">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center shadow-md border-4 transition-all overflow-hidden p-1 bg-white ${activeTab === 'chat' ? 'border-[#F4A261] scale-110' : 'border-[#FDFBF7] hover:scale-105'}`}>
              <img src="/duomi-icon.png" alt="DuoMi" className="w-full h-full object-contain mix-blend-multiply" />
            </div>
            <span className={`text-[10px] font-semibold mt-0.5 transition-colors ${activeTab === 'chat' ? 'text-[#F4A261]' : 'text-[#A0A0A0]'}`}>DuoMi</span>
          </button>

          <button onClick={() => setActiveTab('calendar')} className="flex flex-col items-center gap-1 w-16 transition-colors">
            <div className={`p-1 rounded-xl transition-all ${activeTab === 'calendar' ? 'scale-110 border-2 border-[#F4A261] shadow-sm' : 'scale-100 hover:scale-105 border-2 border-transparent hover:bg-[#FDFBF7]'}`}>
              <img src="/calendar-icon.png" alt="日历" className={`w-8 h-8 block object-contain mix-blend-multiply transition-opacity ${activeTab === 'calendar' ? 'opacity-100' : 'opacity-80'}`} />
            </div>
            <span className={`text-[10px] font-semibold transition-colors ${activeTab === 'calendar' ? 'text-[#F4A261]' : 'text-[#A0A0A0]'}`}>日历</span>
          </button>
        </nav>

        {isChatSidebarOpen && (
          <div className="absolute inset-0 z-50 flex justify-start overflow-hidden">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity" onClick={() => setIsChatSidebarOpen(false)} />
            <div className="w-[86%] h-full bg-[#FDFBF7] relative flex flex-col shadow-2xl animate-in slide-in-from-left duration-300 border-r border-[#F0EBE1]">
              <div className="flex items-center justify-between p-5 border-b border-[#F0EBE1] bg-white">
                <h2 className="font-bold text-[#3D3D3D] flex items-center gap-2">
                  <MessageSquare size={18} className="text-[#F4A261]" />
                  对话
                </h2>
                <button onClick={() => setIsChatSidebarOpen(false)} className="p-1.5 bg-[#F4F5F7] rounded-full text-[#8C8C8C] hover:text-[#3D3D3D]">
                  <X size={16} />
                </button>
              </div>

              <div className="p-4 border-b border-[#F0EBE1] bg-white">
                <button
                  onClick={handleNewConversation}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#F4A261] hover:bg-[#E79251] text-white text-sm font-bold transition-colors"
                >
                  <Plus size={16} />
                  新对话
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {chatConversations.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-[#A0A0A0] text-sm px-6">
                    <MessageCircle size={26} className="mb-3 opacity-50" />
                    还没有历史对话。开始发送第一句话后，这里会自动保存。
                  </div>
                ) : (
                  chatConversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId;
                    const dateLabel = new Date(conversation.last_message_at || conversation.updated_at).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                    });

                    return (
                      <div
                        key={conversation.id}
                        className={`group flex items-center gap-2 rounded-2xl border p-2 transition-colors ${
                          isActive
                            ? 'border-[#F4A261] bg-[#FFF4EC]'
                            : 'border-[#F0EBE1] bg-white hover:border-[#F4C08A]'
                        }`}
                      >
                        <button
                          onClick={() => handleSelectConversation(conversation.id)}
                          className="min-w-0 flex-1 text-left px-2 py-1"
                        >
                          <span className="block truncate text-sm font-bold text-[#3D3D3D]">{conversation.title}</span>
                          <span className="block text-[11px] text-[#A0A0A0] mt-1">
                            {dateLabel} · {conversation.message_count || 0} 条消息
                          </span>
                        </button>
                        <button
                          onClick={() => handleDeleteConversation(conversation.id)}
                          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[#A0A0A0] hover:text-[#D96B52] hover:bg-[#FFF0ED] transition-colors"
                          aria-label="删除对话"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {isBrainOpen && (
          <div className="absolute inset-0 z-50 flex justify-end overflow-hidden">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity" onClick={() => setIsBrainOpen(false)} />
            <div className="w-[85%] h-full bg-[#FDFBF7] relative flex flex-col shadow-2xl animate-in slide-in-from-right duration-300 border-l border-[#F0EBE1]">
              <div className="flex items-center justify-between p-5 border-b border-[#F0EBE1] bg-white">
                <h2 className="font-bold text-[#3D3D3D] flex items-center gap-2">
                  <Brain size={18} className="text-[#F4A261]" />
                  透明的大脑
                </h2>
                <button onClick={() => setIsBrainOpen(false)} className="p-1.5 bg-[#F4F5F7] rounded-full text-[#8C8C8C] hover:text-[#3D3D3D]">
                  <X size={16} />
                </button>
              </div>

              {!isBrainUnlocked ? (
                <div className="flex-1 flex flex-col justify-center p-5">
                  <div className="bg-white rounded-2xl border border-[#F0EBE1] p-5 shadow-sm">
                    <Lock size={26} className="text-[#F4A261] mb-4" />
                    <h3 className="text-base font-bold text-[#3D3D3D] mb-2">透明大脑已上锁</h3>
                    <p className="text-xs text-[#8C8C8C] leading-relaxed mb-4">
                      这里包含 DuoMi 记住的私密信息。输入密码后可以查看、删除和调整记忆评级。
                    </p>
                    <input
                      type="password"
                      value={brainPasscodeInput}
                      onChange={(event) => setBrainPasscodeInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleUnlockBrain();
                      }}
                      placeholder="输入透明大脑密码"
                      className="w-full rounded-2xl border border-[#F0EBE1] bg-[#FDFBF7] px-4 py-3 text-sm outline-none focus:border-[#F4A261]"
                    />
                    <button
                      onClick={handleUnlockBrain}
                      disabled={!brainPasscodeInput.trim()}
                      className="mt-3 w-full rounded-2xl bg-[#F4A261] py-3 text-sm font-bold text-white disabled:bg-[#F0D0B5]"
                    >
                      解锁
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto p-5">
                    <p className="text-xs text-[#8C8C8C] mb-6 leading-relaxed">
                      这里是 DuoMi 记住的私密信息。你可以调整严重程度，等级越低越快淡出，DuoMi 也会更少提及。
                    </p>

                    {!profile || (memoryEvents.length === 0 && brainUpdateState.status === 'idle') ? (
                      <div className="text-sm text-[#A0A0A0] italic bg-white p-5 rounded-2xl border border-[#F0EBE1] border-dashed text-center">
                        <Dog size={24} className="mx-auto mb-2 opacity-50" />
                        暂无记忆。<br />写一篇日记让 DuoMi 认识你吧。
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {brainUpdateState.status !== 'idle' && (
                          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#F0EBE1]">
                            <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#A0A0A0] mb-3">整理状态</h3>
                            <div className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${
                              brainUpdateState.status === 'error'
                                ? 'bg-[#FFF0ED] text-[#D96B52]'
                                : 'bg-[#FFF0E5] text-[#D96B52]'
                            }`}>
                              {brainUpdateState.status === 'updating' && <Loader2 size={13} className="animate-spin" />}
                              {brainUpdateState.message}
                            </div>
                          </div>
                        )}

                        {memoryEvents.length > 0 && (
                          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#F0EBE1]">
                            <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#A0A0A0] mb-3">重要记忆</h3>
                            <ul className="space-y-3">
                              {memoryEvents.map((memory) => {
                                const option = severityOptions.find((item) => item.value === memory.severity) || severityOptions[1];
                                return (
                                  <li key={memory.id} className="bg-[#FDFBF7] px-3 py-3 rounded-xl text-[#5C5C5C]">
                                    <div className="flex items-start gap-2 text-sm leading-relaxed">
                                      <ChevronRight size={14} className="text-[#F4A261] mt-0.5 shrink-0" />
                                      <span className="flex-1">{memory.content}</span>
                                    </div>
                                    <div className="mt-3 rounded-xl bg-white border border-[#F0EBE1] p-2">
                                      <div className="flex items-center justify-between gap-2 mb-2">
                                        <span className="text-[11px] font-bold text-[#3D3D3D]">严重度：{option.label}</span>
                                        <span className="text-[10px] text-[#A0A0A0]">{forgettingLabel(memory.severity)}</span>
                                      </div>
                                      <div className="grid grid-cols-5 gap-1">
                                        {severityOptions.map((severity) => (
                                          <button
                                            key={severity.value}
                                            type="button"
                                            onClick={() => handleChangeMemorySeverity(memory, severity.value)}
                                            className={`h-8 rounded-lg text-[11px] font-bold transition-colors ${
                                              memory.severity === severity.value
                                                ? 'bg-[#F4A261] text-white'
                                                : 'bg-[#FDFBF7] text-[#A0A0A0] hover:text-[#F4A261]'
                                            }`}
                                            title={severity.description}
                                          >
                                            {severity.value}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="flex justify-end gap-3 mt-2">
                                      <button onClick={() => handleForgetMemory(memory, false)} className="text-[11px] text-[#A0A0A0] hover:text-[#D96B52]">删除</button>
                                      <button onClick={() => handleForgetMemory(memory, true)} className="text-[11px] text-[#F4A261] hover:text-[#D96B52]">不准确</button>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="p-5 border-t border-[#F0EBE1] bg-white">
                    <button onClick={handleClearMemory} className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium text-[#D96B52] bg-[#FFF0ED] hover:bg-[#FFE4DE] rounded-2xl transition-colors">
                      <Trash2 size={16} />
                      清空所有数据
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {isSettingsOpen && (
          <div className="absolute inset-0 bg-[#FDFBF7] z-[60] flex flex-col p-5 overflow-y-auto">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold text-[#3D3D3D]">设置</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="w-8 h-8 rounded-full bg-[#E8E8E8] flex items-center justify-center text-[#8C8C8C] hover:text-[#3D3D3D] transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#F0EBE1]">
                <h3 className="text-sm font-bold text-[#3D3D3D] mb-4 flex items-center gap-2">
                  <MessageCircle size={16} className="text-[#F4A261]" />
                  回答语气
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {responseToneOptions.map((option) => {
                    const isSelected = selectedResponseTone === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleChangeResponseTone(option.value)}
                        className={`h-[104px] text-left rounded-2xl border p-3 transition-colors ${
                          isSelected
                            ? 'border-[#F4A261] bg-[#FFF4EC] text-[#3D3D3D]'
                            : 'border-[#F0EBE1] bg-[#FDFBF7] text-[#5F5F5F] hover:border-[#F4C08A]'
                        }`}
                      >
                        <span className="block text-xs font-bold mb-1">{option.label}</span>
                        <span className="block text-[10px] leading-relaxed text-[#8C8C8C]">{option.description}</span>
                      </button>
                    );
                  })}
                </div>
                {selectedResponseTone === 'custom' && (
                  <div className="mt-4 space-y-3">
                    <textarea
                      value={customToneDraft}
                      onChange={(event) => setCustomToneDraft(event.target.value)}
                      rows={4}
                      maxLength={600}
                      placeholder="例如：像一个很懂我的朋友，语气轻松一点，可以幽默，但不要太鸡汤。"
                      className="w-full resize-none rounded-2xl border border-[#F0EBE1] bg-[#FDFBF7] px-3 py-3 text-xs leading-relaxed text-[#3D3D3D] outline-none transition-colors placeholder:text-[#B8B8B8] focus:border-[#F4A261]"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] text-[#A0A0A0]">{customToneDraft.trim().length}/600</span>
                      <button
                        type="button"
                        onClick={handleSaveCustomTone}
                        disabled={isSavingCustomTone || !customToneDraft.trim()}
                        className="inline-flex items-center gap-2 rounded-full bg-[#F4A261] px-4 py-2 text-xs font-bold text-white shadow-sm transition-opacity disabled:opacity-50"
                      >
                        {isSavingCustomTone && <Loader2 size={13} className="animate-spin" />}
                        生成并保存
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#F0EBE1]">
                <h3 className="text-sm font-bold text-[#3D3D3D] mb-3 flex items-center gap-2">
                  <ShieldCheck size={16} className="text-[#F4A261]" />
                  隐私与安全
                </h3>
                <p className="text-xs text-[#8C8C8C] leading-relaxed">
                  你的日记、聊天、透明大脑，以及新日记的天气和城市级地点背景会保存到 Supabase 云端，并通过账号隔离。天气来自 Open-Meteo，地点来自 OpenStreetMap Nominatim（© OpenStreetMap contributors）；不会保存经纬度。AI 回应由服务端调用豆包生成，浏览器不会保存或暴露模型 API Key。
                </p>
                <div className="mt-4 rounded-2xl bg-[#FDFBF7] border border-[#F0EBE1] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-[#3D3D3D]">透明大脑密码</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-[#8C8C8C]">
                        开启后，每次打开透明大脑都需要先输入密码。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={isBrainLockEnabled ? handleDisableBrainLock : handleEnableBrainLock}
                      disabled={
                        !isBrainLockEnabled
                        && (
                          isSavingBrainLock
                          || brainPasscodeDraft.trim().length < 4
                          || !brainRecoveryQuestionDraft
                          || !brainRecoveryAnswerDraft.trim()
                        )
                      }
                      className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${
                        isBrainLockEnabled
                          ? 'bg-[#FFF0ED] text-[#D96B52]'
                          : 'bg-[#F4A261] text-white disabled:bg-[#F0D0B5]'
                      }`}
                    >
                      {isBrainLockEnabled ? '关闭' : isSavingBrainLock ? '保存中' : '开启'}
                    </button>
                  </div>
                  {isBrainLockEnabled ? (
                    <div className="mt-3 space-y-2">
                      <input
                        type="password"
                        value={brainDisablePasscode}
                        onChange={(event) => setBrainDisablePasscode(event.target.value)}
                        placeholder="输入当前密码后才可关闭"
                        className="w-full rounded-xl border border-[#F0EBE1] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#F4A261]"
                      />
                      {canRecoverBrainPasscode && (
                        <button
                          type="button"
                          onClick={() => setIsBrainRecoveryOpen((value) => !value)}
                          className="text-[11px] font-bold text-[#F4A261]"
                        >
                          忘记密码
                        </button>
                      )}
                      {isBrainRecoveryOpen && (
                        <div className="rounded-xl border border-[#F0EBE1] bg-white p-3 space-y-2">
                          <div className="text-[11px] font-bold text-[#3D3D3D]">{brainRecoveryQuestion}</div>
                          <input
                            value={brainRecoveryAnswerInput}
                            onChange={(event) => {
                              setBrainRecoveryAnswerInput(event.target.value);
                              setBrainRecoveryError('');
                            }}
                            placeholder="输入验证答案"
                            className="w-full rounded-lg border border-[#F0EBE1] bg-[#FDFBF7] px-3 py-2 text-xs outline-none focus:border-[#F4A261]"
                          />
                          <input
                            type="password"
                            value={brainResetPasscodeDraft}
                            onChange={(event) => {
                              setBrainResetPasscodeDraft(event.target.value);
                              setBrainRecoveryError('');
                            }}
                            placeholder="设置新的至少 4 位密码"
                            className="w-full rounded-lg border border-[#F0EBE1] bg-[#FDFBF7] px-3 py-2 text-xs outline-none focus:border-[#F4A261]"
                          />
                          {brainRecoveryError && (
                            <p className="rounded-lg bg-[#FFF0ED] px-3 py-2 text-[11px] font-medium text-[#D96B52]">
                              {brainRecoveryError}
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={handleResetBrainLock}
                            className="w-full rounded-lg bg-[#F4A261] py-2 text-xs font-bold text-white"
                          >
                            验证并重置密码
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <input
                        type="password"
                        value={brainPasscodeDraft}
                        onChange={(event) => setBrainPasscodeDraft(event.target.value)}
                        placeholder="设置至少 4 位密码"
                        className="w-full rounded-xl border border-[#F0EBE1] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#F4A261]"
                      />
                      <select
                        value={brainRecoveryQuestionDraft}
                        onChange={(event) => setBrainRecoveryQuestionDraft(event.target.value)}
                        className="w-full rounded-xl border border-[#F0EBE1] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#F4A261]"
                      >
                        <option value="">选择一个验证问题</option>
                        {brainRecoveryQuestions.map((question) => (
                          <option key={question} value={question}>
                            {question}
                          </option>
                        ))}
                      </select>
                      <input
                        value={brainRecoveryAnswerDraft}
                        onChange={(event) => setBrainRecoveryAnswerDraft(event.target.value)}
                        placeholder="验证答案"
                        className="w-full rounded-xl border border-[#F0EBE1] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#F4A261]"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#F0EBE1]">
                <h3 className="text-sm font-bold text-[#3D3D3D] mb-3">心理陪伴说明</h3>
                <p className="text-xs text-[#8C8C8C] leading-relaxed">
                  DuoMi 是心理陪伴工具，不是医疗服务，也不提供专业心理咨询、诊断或治疗。你的日记和聊天内容会保存到 Supabase 云端数据库，AI 回复由服务端调用模型生成。如果你正在经历紧急危险，请优先联系身边可信任的人或当地紧急服务。
                </p>
              </div>

              <button onClick={handleSignOut} className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-[#3D3D3D] bg-white hover:bg-[#F4F5F7] rounded-2xl border border-[#F0EBE1] transition-colors">
                <LogOut size={16} />
                退出登录
              </button>
            </div>
          </div>
        )}

        {editingEntry && (
          <div className="absolute inset-0 z-[70] bg-[#3D3D3D]/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <div className="w-full bg-white rounded-3xl shadow-2xl border border-[#F0EBE1] p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-[#3D3D3D]">编辑日记</h3>
                <button onClick={() => setEditingEntry(null)} className="w-8 h-8 rounded-full bg-[#F4F5F7] flex items-center justify-center text-[#8C8C8C]">
                  <X size={16} />
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-3 mb-3">
                {moods.map((mood) => (
                  <button key={mood} onClick={() => setEditMood(mood)} className={`shrink-0 rounded-xl border-2 p-1 ${editMood === mood ? 'border-[#F4A261]' : 'border-transparent'}`}>
                    <DuoMiFace mood={mood} className="w-9 h-9" />
                  </button>
                ))}
              </div>
              <textarea
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                className="w-full h-44 bg-[#FDFBF7] border border-[#F0EBE1] rounded-2xl p-4 text-sm text-[#3D3D3D] outline-none focus:border-[#F4A261] resize-none leading-relaxed"
              />
              <button
                onClick={handleUpdateEntry}
                disabled={isSavingEdit || !editContent.trim()}
                className="w-full mt-4 bg-[#F4A261] hover:bg-[#E79251] disabled:bg-[#F0D0B5] text-white py-3 rounded-2xl font-bold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {isSavingEdit ? <Loader2 size={16} className="animate-spin" /> : <Heart size={16} fill="currentColor" />}
                保存修改
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
