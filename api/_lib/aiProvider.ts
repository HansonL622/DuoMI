import type { ChatMessage, ChatRuntimeContext, DiaryEntry, MemoryEvent, MemorySeverity, PlaceSnapshot, ResponseTone, UserProfile, UserSettings, WeatherSnapshot } from '../../src/types';
import { getEnv } from './env';
import { buildSupportPlaybookPrompt } from './supportPlaybook';

type ArkMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const CHAT_HISTORY_LIMIT = 8;
const DIARY_MEMORY_LIMIT = 3;
const HISTORY_CONTENT_LIMIT = 500;
const DIARY_CONTENT_LIMIT = 320;

export interface AiProvider {
  extractProfile(currentProfile: UserProfile | null, diaryContent: string, moodLabel?: string, weather?: WeatherSnapshot, place?: PlaceSnapshot): Promise<UserProfile>;
  polishToneInstruction(userRequest: string): Promise<string>;
  sendCompanionMessage(
    profile: UserProfile | null,
    history: ChatMessage[],
    message: string,
    relatedDiaryEntries: DiaryEntry[],
    runtimeContext: ChatRuntimeContext | null,
  ): Promise<string>;
  streamCompanionMessage(
    profile: UserProfile | null,
    history: ChatMessage[],
    message: string,
    relatedDiaryEntries: DiaryEntry[],
    runtimeContext: ChatRuntimeContext | null,
    onDelta: (delta: string) => void,
  ): Promise<string>;
}

const defaultProfile = (): UserProfile => ({
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

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI 返回的画像不是有效 JSON');
    return JSON.parse(match[0]);
  }
}

function normalizeProfile(input: unknown, fallback: UserProfile | null): UserProfile {
  const source = typeof input === 'object' && input ? (input as Partial<UserProfile>) : {};
  const previous = fallback || defaultProfile();

  return {
    key_facts: Array.isArray(source.key_facts) ? source.key_facts.filter(Boolean).map(String) : previous.key_facts,
    recent_mood: typeof source.recent_mood === 'string' ? source.recent_mood : previous.recent_mood,
    current_stressors: Array.isArray(source.current_stressors)
      ? source.current_stressors.filter(Boolean).map(String)
      : previous.current_stressors,
    deep_fears: Array.isArray(source.deep_fears) ? source.deep_fears.filter(Boolean).map(String) : previous.deep_fears,
    memory_events: normalizeMemoryEvents(source.memory_events, previous),
    rejected_memories: Array.isArray(previous.rejected_memories) ? previous.rejected_memories : [],
    nickname: previous.nickname,
    settings: normalizeSettings(previous.settings),
  };
}

function normalizeSeverity(value: unknown): MemorySeverity {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : 2;
}

function normalizeMemoryEvents(input: unknown, fallback: UserProfile | null): MemoryEvent[] {
  const existing = new Map((fallback?.memory_events || []).map((event) => [event.content, event]));
  if (!Array.isArray(input)) return fallback?.memory_events || [];

  const nextEvents = input
    .filter((item): item is Partial<MemoryEvent> => typeof item === 'object' && item !== null)
    .map((item, index) => {
      const content = typeof item.content === 'string' ? item.content.trim() : '';
      const previous = existing.get(content);
      return {
        id: typeof item.id === 'string' && item.id ? item.id : previous?.id || `memory-${Date.now()}-${index}`,
        content,
        severity: normalizeSeverity(item.severity ?? previous?.severity),
        source: item.source || previous?.source || 'experience',
        created_at: typeof item.created_at === 'string' ? item.created_at : previous?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    })
    .filter((item) => item.content);

  const nextContent = new Set(nextEvents.map((event) => event.content));
  const preservedEvents = (fallback?.memory_events || [])
    .filter((event) => event.content && !nextContent.has(event.content))
    .filter((event) => event.severity >= 3);

  return [...nextEvents, ...preservedEvents]
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 8);
}

function isDiagnosisRequest(message: string): boolean {
  return /(是不是|是否|会不会|有没有).{0,8}(抑郁|焦虑|躁郁|双相|心理疾病|精神病|人格障碍|创伤|ptsd|adhd)/i.test(message)
    || /(抑郁症|焦虑症|双相|躁郁症|ptsd|adhd).{0,8}(吗|么|吧|？|\?)/i.test(message);
}

function isCrisisRisk(message: string): boolean {
  return /(不想活|活不下去|撑不下去|想死|自杀|自残|伤害自己|结束生命|消失|不想存在|杀了我|轻生)/.test(message);
}

function shouldRecallMemory(message: string): boolean {
  if (message.trim().length <= 8 && /^(早上好|上午好|中午好|下午好|晚上好|你好|嗨|hi|hello|在吗|在不在)[呀啊哦哈~!！。,.，\s]*$/i.test(message)) {
    return false;
  }

  if (/(烦|烦躁|累|疲惫|没心情|不想学|不想做|失眠|睡不着)/i.test(message) && message.trim().length < 36 && !/(记得|还记得|之前|上次|那天|日记|记录|开会|会议|工作|家人|朋友|关系|因为|又是|还是)/i.test(message)) {
    return false;
  }

  return /(难过|委屈|焦虑|紧张|压力|崩溃|生气|害怕|孤独|不安|低落|记得|还记得|之前|上次|那天|日记|记录|为什么|怎么办|开会|会议|工作|家人|朋友|关系)/i.test(message)
    || message.trim().length > 28;
}

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength)}...` : compacted;
}

function summarizeWeather(weather: WeatherSnapshot | undefined): string {
  if (!weather) return '';
  return `${weather.conditionLabel}，${Math.round(weather.temperatureC)}°C，降水 ${weather.precipitation}mm，风速 ${weather.windSpeed}km/h`;
}

function summarizePlace(place: PlaceSnapshot | undefined): string {
  return place?.label || '';
}

function shouldUseFullSafetyPlaybook(message: string): boolean {
  return isDiagnosisRequest(message) || isCrisisRisk(message) || /(自杀|自残|想死|不想活|心理疾病|抑郁症|焦虑症|双相|ptsd|adhd|诊断|医生|用药)/i.test(message);
}

function buildCompactSupportPrompt(): string {
  return [
    '你是情绪陪伴工具，不做诊断、治疗、用药或危机热线替代。',
    '先回应用户当下感受，再给一个很小的下一步；不要说教、鸡汤或要求用户立刻振作。',
    '只有旧记忆和本轮表达高度相关、且不是轻量吐槽时，才最多引用 1 个记忆。',
    '轻量烦躁、没心情、普通抱怨时，不要主动翻旧账，不要把过去事件说成当前原因。',
    '天气和地点只能作为背景事实，不能作为心理状态、情绪变化、人格倾向、疾病或风险的原因。',
    '危机或诊断请求时，不引用无关旧记忆，优先安全边界和现实支持。',
  ].join('\n');
}

function memoryEventsFromProfile(profile: UserProfile | null): MemoryEvent[] {
  if (!profile) return [];
  const explicit = Array.isArray(profile.memory_events) ? profile.memory_events : [];
  if (explicit.length > 0) return explicit;

  return [
    ...(profile.current_stressors || []).map((content, index) => ({ id: `legacy-stress-${index}`, content, severity: 3 as MemorySeverity, source: 'stress' as const })),
    ...(profile.key_facts || []).map((content, index) => ({ id: `legacy-fact-${index}`, content, severity: 2 as MemorySeverity, source: 'experience' as const })),
    ...(profile.deep_fears || []).map((content, index) => ({ id: `legacy-fear-${index}`, content, severity: 4 as MemorySeverity, source: 'fear' as const })),
  ];
}

function memoryRecallPolicy(severity: MemorySeverity): string {
  if (severity <= 1) return '轻微：通常不主动提及，除非用户明确问起。';
  if (severity === 2) return '一般：只在用户明确提到同一主题时轻轻参考。';
  if (severity === 3) return '中等：只有和本轮表达高度相关时可简短提及一次。';
  if (severity === 4) return '严重：相关时可以承接，但不要反复强化。';
  return '高严重：相关且有助于安全/稳定时优先考虑，表达必须克制。';
}

function isMemoryStillActive(event: MemoryEvent): boolean {
  const createdAt = event.updated_at || event.created_at;
  if (!createdAt) return true;

  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return true;
  if (event.severity <= 1) return ageDays <= 3;
  if (event.severity === 2) return ageDays <= 14;
  if (event.severity === 3) return ageDays <= 45;
  if (event.severity === 4) return ageDays <= 120;
  return true;
}

function normalizeDateKey(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function dateKeyFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysBetween(fromDateKey: string, toDateKey: string): number {
  const from = new Date(`${fromDateKey}T00:00:00Z`).getTime();
  const to = new Date(`${toDateKey}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86400000);
}

function relativeDayLabel(entryDate: string, currentDate: string): string {
  const days = daysBetween(entryDate, currentDate);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days > 1) return `${days}天前`;
  return `${Math.abs(days)}天后`;
}

function buildToneInstruction(settings: UserSettings): string {
  const customTonePrompt = settings.customTonePrompt?.trim();
  if (settings.responseTone === 'custom') {
    return [
      '当前语气：专属定制。',
      customTonePrompt || '用户选择了自定义语气，但尚未填写要求。保持成熟、温和、清楚，并等待用户进一步设置。',
      '即使是自定义语气，也必须遵守心理支持、安全边界、日期和记忆使用规则。',
    ].join('\n');
  }

  const instructions: Record<ResponseTone, string> = {
    mature: [
      '当前语气：成熟克制。',
      '像一个稳定、可信赖的成年人陪用户说话：温和、清楚、有边界。',
      '避免幼态表达、撒娇、卖萌、过多语气词，以及“软乎乎”“摸摸头”“尾巴蹭蹭”等拟宠物化动作描写。',
      '可以保留少量陪伴感，但重点是准确理解、降低压力、给出一个现实可执行的小步骤。',
    ].join('\n'),
    gentle: [
      '当前语气：温柔陪伴。',
      '语气可以更柔和，但仍然要成熟，不要幼态化或过度可爱。',
      '多承接情绪，少分析，给用户被理解和被陪着的感觉。',
    ].join('\n'),
    direct: [
      '当前语气：直接清晰。',
      '少铺垫，先指出你理解到的核心问题，再给一个具体建议。',
      '避免过多抚慰性形容词，不要命令用户，也不要显得冷淡。',
    ].join('\n'),
    reflective: [
      '当前语气：分析反思。',
      '帮助用户把情绪、触发事件、可能需求分开看清楚。',
      '可以提出一个轻量问题引导反思，但不要长篇讲道理或做诊断。',
    ].join('\n'),
    cuddly: [
      '当前语气：绒绒陪伴。',
      '像一只很亲近用户、会认真听人说话的小狗在陪伴：可爱、热情、依恋感更强。',
      '可以少量使用拟人化小狗动作或感受，比如“耳朵竖起来听你说”“靠近一点陪你”“尾巴轻轻晃一下”。',
      '可以使用少量可爱的语气词，但不要整段卖萌，不要影响对用户情绪和事实的准确理解。',
      '遇到严肃、危机或诊断相关内容时，立刻收起卖萌感，优先稳定、清楚和安全。',
    ].join('\n'),
    custom: '',
  };

  return instructions[settings.responseTone];
}

function buildCompanionMessages(
  profile: UserProfile | null,
  history: ChatMessage[],
  message: string,
  relatedDiaryEntries: DiaryEntry[],
  runtimeContext: ChatRuntimeContext | null,
): ArkMessage[] {
  const settings = normalizeSettings(profile?.settings);
  const currentDate = normalizeDateKey(runtimeContext?.currentDate) || dateKeyFromTimestamp(Date.now());
  const currentDateTime = typeof runtimeContext?.currentDateTime === 'string' ? runtimeContext.currentDateTime : new Date().toISOString();
  const timeZone = typeof runtimeContext?.timeZone === 'string' && runtimeContext.timeZone ? runtimeContext.timeZone : 'local';
  const system = `
名字：DuoMi（多米）。你的视觉形象是一只白色西高地小狗，但你的默认表达方式是成熟、沉稳、可信赖的心理陪伴者。除非当前语气明确要求“狗狗拟人”，否则不要把回复写成幼儿化宠物台词。

你必须遵守以下心理支持规则：
${shouldUseFullSafetyPlaybook(message) ? buildSupportPlaybookPrompt() : buildCompactSupportPrompt()}

${buildToneInstruction(settings)}

输出规则：
- 用中文回应，通常 45 到 70 字；除非用户明确要求详细分析，否则不要长篇输出。
- 少说教，不盲目正能量，不使用“你要加油”“振作起来”这类空泛表达。
- 如果用户情绪不好，优先结合画像和相关日记做具体、克制的背景承接与共情。
- 严格遵守当前日期。日记上下文里的 relativeDay/dateKey 才是事件日期；不要把过去日记说成“今天”或“刚才”。
- 普通寒暄、问候、轻量闲聊时，只回应当下这句话，不主动提起旧日记或旧压力源。
- 天气和地点只能作为日记发生背景或用户明确提到经历时的辅助事实。
- 严禁把天气或地点作为用户心理状态、情绪变化、人格倾向、心理疾病或风险等级的原因。
- 不要说“因为下雨所以低落”“去某地让你变好”“天气导致焦虑”等确定因果。
- 只有当日记正文明确表达地点相关体验时，才可提到“用户在某地写到某种体验”；不得概括成“某地让用户怎样”。
- 避免高频使用“呀”“哦”“好不好”“软软的”“乖”等显得低幼的表达。
- 遇到诊断请求或危机风险时，优先执行边界/安全规则，不引用无关画像或日记记忆。
- 不夸大记忆，不确定时用“我好像记得”“听起来像是”。
`.trim();

  const historyWithoutCurrentMessage = [...history];
  const lastHistoryItem = historyWithoutCurrentMessage.at(-1);
  if (lastHistoryItem?.role === 'user' && lastHistoryItem.content.trim() === message.trim()) {
    historyWithoutCurrentMessage.pop();
  }

  const compactHistory = historyWithoutCurrentMessage.slice(-CHAT_HISTORY_LIMIT).map((item) => ({
    role: item.role === 'model' ? 'assistant' : 'user',
    content: compactText(item.content, HISTORY_CONTENT_LIMIT),
  })) as ArkMessage[];

  const shouldUseMemory = !isDiagnosisRequest(message) && !isCrisisRisk(message) && shouldRecallMemory(message);
  const usableMemories = shouldUseMemory
    ? memoryEventsFromProfile(profile)
      .filter(isMemoryStillActive)
      .filter((event) => event.severity >= 2)
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 4)
      .map((event) => ({
        content: compactText(event.content, 180),
        severity: event.severity,
        recallPolicy: memoryRecallPolicy(event.severity),
      }))
    : [];
  const context = JSON.stringify(
    {
      currentTime: {
        dateKey: currentDate,
        dateTime: currentDateTime,
        timeZone,
        instruction: `今天是 ${currentDate}。只有 dateKey 等于 ${currentDate} 的日记才可以称为今天。`,
      },
      memoryPolicy: shouldUseMemory
        ? '可以使用直接相关的画像和日记记忆。'
        : isDiagnosisRequest(message) || isCrisisRisk(message)
          ? '本轮是边界或安全场景，不要使用画像和日记记忆。'
          : '本轮是普通寒暄或轻量闲聊，不要使用画像和日记记忆。',
      profile: shouldUseMemory
        ? {
            recent_mood: profile?.recent_mood || '',
            memory_events: usableMemories,
          }
        : defaultProfile(),
      relatedDiaryEntries: shouldUseMemory ? relatedDiaryEntries.slice(0, DIARY_MEMORY_LIMIT).map((entry) => ({
        date: entry.date,
        dateKey: dateKeyFromTimestamp(entry.timestamp),
        relativeDay: relativeDayLabel(dateKeyFromTimestamp(entry.timestamp), currentDate),
        mood: entry.mood,
        weather: summarizeWeather(entry.weather),
        place: summarizePlace(entry.place),
        content: compactText(entry.content, DIARY_CONTENT_LIMIT),
      })) : [],
    },
    null,
    2,
  );

  return [
    { role: 'system', content: system },
    { role: 'user', content: `这是可用上下文：\n${context}` },
    ...compactHistory,
    { role: 'user', content: message },
  ];
}

class DoubaoArkProvider implements AiProvider {
  private readonly apiKey = getEnv('ARK_API_KEY') || getEnv('DOUBAO_API_KEY');
  private readonly model = getEnv('ARK_MODEL_ID') || getEnv('DOUBAO_MODEL_ID');
  private readonly baseUrl = (getEnv('ARK_BASE_URL') || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');

  private async chat(messages: ArkMessage[], temperature: number, maxTokens = 600): Promise<string> {
    if (!this.apiKey || !this.model) {
      throw new Error('豆包服务尚未配置，请设置 ARK_API_KEY 和 ARK_MODEL_ID');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.message || '豆包服务暂时不可用');
      }

      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('豆包没有返回有效内容');
      }

      return content.trim();
    } catch (error) {
      if (error instanceof Error && error.message !== '豆包没有返回有效内容' && !error.message.includes('豆包服务')) {
        throw new Error('豆包服务连接失败，请稍后再试');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async streamChat(
    messages: ArkMessage[],
    temperature: number,
    maxTokens: number,
    onDelta: (delta: string) => void,
  ): Promise<string> {
    if (!this.apiKey || !this.model) {
      throw new Error('豆包服务尚未配置，请设置 ARK_API_KEY 和 ARK_MODEL_ID');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || payload?.message || '豆包服务暂时不可用');
      }
      if (!response.body) {
        throw new Error('豆包没有返回可读取的流');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      const processEvent = (event: string) => {
        const lines = event.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          const payload = JSON.parse(data);
          const delta = payload?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            fullText += delta;
            onDelta(delta);
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          processEvent(event);
        }
      }

      const remaining = decoder.decode();
      if (remaining) buffer += remaining;
      if (buffer.trim()) processEvent(buffer);
      if (!fullText.trim()) {
        throw new Error('豆包没有返回有效内容');
      }

      return fullText.trim();
    } finally {
      clearTimeout(timeout);
    }
  }

  async extractProfile(
    currentProfile: UserProfile | null,
    diaryContent: string,
    moodLabel?: string,
    weather?: WeatherSnapshot,
    place?: PlaceSnapshot,
  ): Promise<UserProfile> {
    const system = [
      '你是 DuoMi 的长期记忆整理器，只输出 JSON，不要输出 Markdown。',
      '根据新日记更新用户心理画像，保留仍然重要的旧信息，去掉重复、过期或过度推断的内容。',
      '不要把用户已否定的 rejected_memories 再加入画像。',
      'JSON 字段必须是 key_facts、recent_mood、current_stressors、deep_fears、memory_events。',
      'memory_events 是统一的重要记忆列表，每项包含 id、content、severity、source；severity 为 1 到 5，1=轻微短期烦恼，5=高严重长期影响。',
      '只有持续、反复、影响睡眠/学习/工作/关系或用户明显痛苦的内容才进入 memory_events；普通吐槽、一天内的小烦躁不要长期记住。',
      '天气和地点只能作为日记发生背景，不得作为用户心理状态、情绪变化、人格倾向、心理疾病或风险等级的归因。',
      '禁止输出或保存“因为下雨所以低落”“去某地让用户变好”“天气导致焦虑”等确定因果。',
      '只有当日记正文明确表达地点相关体验时，才允许记录地点经历；表述必须保留事实来源，例如“用户在杭州旅行时写到放松和开心”，不能改写成“杭州让用户开心”。',
      '如果长期记忆涉及地点，必须避免因果化、诊断化和过度概括。',
      '所有数组最多保留 5 条，每条用简洁中文描述；memory_events 最多 6 条。',
      '不要解释推理过程，不要输出多余文本。',
    ].join('\n');

    const user = JSON.stringify(
      {
        currentProfile: currentProfile || defaultProfile(),
        moodLabel: moodLabel || '',
        weather: summarizeWeather(weather),
        place: summarizePlace(place),
        diaryContent,
      },
      null,
      2,
    );

    const text = await this.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      0.2,
      500,
    );

    return normalizeProfile(parseJsonObject(text), currentProfile);
  }

  async polishToneInstruction(userRequest: string): Promise<string> {
    const system = [
      '你是 DuoMi 的语气设置整理器，只输出可直接放进系统提示词的中文指令，不要输出 Markdown。',
      '把用户对回答风格的口语化要求润色成 3 到 5 条清楚、可执行的语气规则。',
      '保留用户偏好的表达气质，但去掉攻击性、歧视、操控、医疗诊断、危险建议、泄露隐私或绕过安全规则的要求。',
      '必须说明：自定义语气不能覆盖心理支持、安全边界、日期和记忆使用规则。',
      '不要承诺模型身份、能力或事实；不要加入用户没有要求的设定。',
    ].join('\n');

    const text = await this.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: userRequest.trim().slice(0, 600) },
      ],
      0.2,
      350,
    );

    return text.trim().slice(0, 900);
  }

  async sendCompanionMessage(
    profile: UserProfile | null,
    history: ChatMessage[],
    message: string,
    relatedDiaryEntries: DiaryEntry[],
    runtimeContext: ChatRuntimeContext | null,
  ): Promise<string> {
    return this.chat(
      buildCompanionMessages(profile, history, message, relatedDiaryEntries, runtimeContext),
      0.7,
      260,
    );
  }

  async streamCompanionMessage(
    profile: UserProfile | null,
    history: ChatMessage[],
    message: string,
    relatedDiaryEntries: DiaryEntry[],
    runtimeContext: ChatRuntimeContext | null,
    onDelta: (delta: string) => void,
  ): Promise<string> {
    return this.streamChat(
      buildCompanionMessages(profile, history, message, relatedDiaryEntries, runtimeContext),
      0.7,
      260,
      onDelta,
    );
  }
}

export function getAiProvider(): AiProvider {
  return new DoubaoArkProvider();
}
