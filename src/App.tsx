import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Brain,
  ChevronRight,
  Dog,
  Heart,
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
import {
  clearAllUserData,
  createChatConversation,
  createChatMessage,
  createDiaryEntry,
  deleteChatConversation,
  deleteDiaryEntry,
  getOrCreateProfile,
  listChatConversations,
  listChatMessages,
  listDiaryEntries,
  saveProfile,
  updateDiaryEntry,
} from './services/dataService';
import { extractProfile, sendCompanionMessage } from './services/duomiApi';
import { isSupabaseConfigured, supabase } from './services/supabaseClient';
import type { ChatConversation, ChatMessage, DiaryEntry, Mood, ResponseTone, UserProfile } from './types';

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
];

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
      : await supabase.auth.signUp(credentials);

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
          DuoMi 是心理陪伴工具，不替代专业心理咨询、诊断或医疗建议。如果你正在经历立即危险，请优先联系身边可信任的人或当地紧急服务。
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
  const [isChatting, setIsChatting] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [dogState, setDogState] = useState<'listening' | 'recording' | 'thinking' | 'responding'>('listening');
  const [error, setError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const userId = session?.user.id || '';
  const selectedResponseTone = profile?.settings?.responseTone || 'mature';
  const activeConversation = useMemo(
    () => chatConversations.find((conversation) => conversation.id === activeConversationId) || null,
    [activeConversationId, chatConversations],
  );

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
    if (isChatting) setDogState('thinking');
    else if (isResponding) setDogState('responding');
    else if (chatInput.trim().length > 0) setDogState('recording');
    else setDogState('listening');
  }, [isChatting, isResponding, chatInput]);

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

  const persistProfile = async (nextProfile: UserProfile) => {
    if (!userId) return;
    setProfile(nextProfile);
    await saveProfile(userId, nextProfile);
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

  const handleSaveDiary = async () => {
    if (!diaryInput.trim() && !selectedMood) return;

    const content = diaryInput.trim() || '（仅记录了心情）';
    const mood = selectedMood;
    setIsExtracting(true);
    setError(null);

    try {
      const savedEntry = await createDiaryEntry(diaryDate, content, mood);
      setDiaryEntries((prev) => [savedEntry, ...prev].sort((a, b) => b.timestamp - a.timestamp));
      setDiaryInput('');
      setSelectedMood(null);
      setDiaryDate(new Date());
      setActiveTab('calendar');

      try {
        const nextProfile = await extractProfile(profile, content, mood ? moodLabelMap[mood] : undefined);
        await persistProfile({
          ...nextProfile,
          rejected_memories: profile?.rejected_memories || nextProfile.rejected_memories || [],
        });
      } catch (profileError) {
        setError(profileError instanceof Error ? `日记已保存，但画像更新失败：${profileError.message}` : '日记已保存，但画像更新失败');
      }
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
        const nextProfile = await extractProfile(profile, updated.content, updated.mood ? moodLabelMap[updated.mood] : undefined);
        await persistProfile({
          ...nextProfile,
          rejected_memories: profile?.rejected_memories || nextProfile.rejected_memories || [],
        });
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

    try {
      let conversationId = activeConversationId;
      if (!conversationId) {
        const createdConversation = await createChatConversation(makeConversationTitle(userMsg));
        conversationId = createdConversation.id;
        setActiveConversationId(createdConversation.id);
        setChatConversations((prev) => [createdConversation, ...prev]);
      }

      const savedUserMessage = await createChatMessage(conversationId, 'user', userMsg);
      const nextHistory = [...chatHistory, savedUserMessage];
      setChatHistory(nextHistory);

      const response = await sendCompanionMessage(profile, nextHistory, userMsg, relatedDiaryEntries);
      const savedModelMessage = await createChatMessage(conversationId, 'model', response);
      setChatHistory((prev) => [...prev, savedModelMessage]);
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
    } finally {
      setIsChatting(false);
      setIsResponding(true);
      setTimeout(() => setIsResponding(false), 5000);
    }
  };

  const handleForgetMemory = async (category: keyof Pick<UserProfile, 'key_facts' | 'current_stressors' | 'deep_fears'>, value: string, reject: boolean) => {
    const base = profile || emptyProfile();
    const nextProfile: UserProfile = {
      ...base,
      [category]: base[category].filter((item) => item !== value),
      rejected_memories: reject ? Array.from(new Set([...(base.rejected_memories || []), value])) : base.rejected_memories || [],
    };
    await persistProfile(nextProfile);
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
                    {diaryEntries.map((entry) => (
                      <div key={entry.id} className="bg-white p-4 rounded-2xl shadow-sm border border-[#F0EBE1]">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="text-[11px] font-medium text-[#A0A0A0]">{entry.date}</div>
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
              {isChatting && (
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

              <div className="flex-1 overflow-y-auto p-5">
                <p className="text-xs text-[#8C8C8C] mb-6 leading-relaxed">
                  这里是 DuoMi 记住的关于你的信息。你可以删除不需要的记忆，也可以标记“不准确”，DuoMi 会尽量不再这样记。
                </p>

                {!profile || (!profile.recent_mood && profile.key_facts.length === 0 && profile.current_stressors.length === 0 && profile.deep_fears.length === 0) ? (
                  <div className="text-sm text-[#A0A0A0] italic bg-white p-5 rounded-2xl border border-[#F0EBE1] border-dashed text-center">
                    <Dog size={24} className="mx-auto mb-2 opacity-50" />
                    暂无记忆。<br />写一篇日记让 DuoMi 认识你吧。
                  </div>
                ) : (
                  <div className="space-y-6">
                    {profile.recent_mood && (
                      <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#F0EBE1]">
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#A0A0A0] mb-3">当下情绪</h3>
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FFF0E5] text-[#D96B52] rounded-xl text-sm font-semibold">
                          {profile.recent_mood}
                        </div>
                      </div>
                    )}

                    {[
                      ['current_stressors', '核心压力源'],
                      ['deep_fears', '深层担心'],
                      ['key_facts', '关键经历'],
                    ].map(([key, title]) => {
                      const category = key as keyof Pick<UserProfile, 'key_facts' | 'current_stressors' | 'deep_fears'>;
                      const items = profile[category] || [];
                      if (items.length === 0) return null;

                      return (
                        <div key={key} className="bg-white p-4 rounded-2xl shadow-sm border border-[#F0EBE1]">
                          <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#A0A0A0] mb-3">{title}</h3>
                          <ul className="space-y-2">
                            {items.map((item, i) => (
                              <li key={`${item}-${i}`} className="text-sm bg-[#FDFBF7] px-3 py-2.5 rounded-xl text-[#5C5C5C] leading-relaxed">
                                <div className="flex items-start gap-2">
                                  <ChevronRight size={14} className="text-[#F4A261] mt-0.5 shrink-0" />
                                  <span className="flex-1">{item}</span>
                                </div>
                                <div className="flex justify-end gap-2 mt-2">
                                  <button onClick={() => handleForgetMemory(category, item, false)} className="text-[11px] text-[#A0A0A0] hover:text-[#D96B52]">删除</button>
                                  <button onClick={() => handleForgetMemory(category, item, true)} className="text-[11px] text-[#F4A261] hover:text-[#D96B52]">不准确</button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="p-5 border-t border-[#F0EBE1] bg-white">
                <button onClick={handleClearMemory} className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium text-[#D96B52] bg-[#FFF0ED] hover:bg-[#FFE4DE] rounded-2xl transition-colors">
                  <Trash2 size={16} />
                  清空所有数据
                </button>
              </div>
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
                        className={`text-left rounded-2xl border p-3 transition-colors ${
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
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#F0EBE1]">
                <h3 className="text-sm font-bold text-[#3D3D3D] mb-3 flex items-center gap-2">
                  <ShieldCheck size={16} className="text-[#F4A261]" />
                  隐私与安全
                </h3>
                <p className="text-xs text-[#8C8C8C] leading-relaxed">
                  你的日记、聊天和透明大脑会保存到 Supabase 云端，并通过账号隔离。AI 回应由服务端调用豆包生成，浏览器不会保存或暴露模型 API Key。
                </p>
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#F0EBE1]">
                <h3 className="text-sm font-bold text-[#3D3D3D] mb-3">心理陪伴说明</h3>
                <p className="text-xs text-[#8C8C8C] leading-relaxed">
                  DuoMi 是陪伴工具，不替代专业心理咨询、诊断或医疗建议。如果你正在经历立即危险，请联系身边可信任的人或当地紧急服务。
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
