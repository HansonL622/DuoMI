import type { ChatMessage, DiaryEntry, ResponseTone, UserProfile, UserSettings } from '../../src/types';
import { getEnv } from './env';
import { buildSupportPlaybookPrompt } from './supportPlaybook';

type ArkMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export interface AiProvider {
  extractProfile(currentProfile: UserProfile | null, diaryContent: string, moodLabel?: string): Promise<UserProfile>;
  sendCompanionMessage(
    profile: UserProfile | null,
    history: ChatMessage[],
    message: string,
    relatedDiaryEntries: DiaryEntry[],
  ): Promise<string>;
}

const defaultProfile = (): UserProfile => ({
  key_facts: [],
  recent_mood: '',
  current_stressors: [],
  deep_fears: [],
  rejected_memories: [],
  settings: {
    responseTone: 'mature',
  },
});

function normalizeSettings(settings: Partial<UserSettings> | null | undefined): UserSettings {
  const responseTone = settings?.responseTone;
  return {
    responseTone: responseTone === 'gentle' || responseTone === 'direct' || responseTone === 'reflective' ? responseTone : 'mature',
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
    rejected_memories: Array.isArray(previous.rejected_memories) ? previous.rejected_memories : [],
    nickname: previous.nickname,
    settings: normalizeSettings(previous.settings),
  };
}

function isDiagnosisRequest(message: string): boolean {
  return /(是不是|是否|会不会|有没有).{0,8}(抑郁|焦虑|躁郁|双相|心理疾病|精神病|人格障碍|创伤|ptsd|adhd)/i.test(message)
    || /(抑郁症|焦虑症|双相|躁郁症|ptsd|adhd).{0,8}(吗|么|吧|？|\?)/i.test(message);
}

function isCrisisRisk(message: string): boolean {
  return /(不想活|活不下去|撑不下去|想死|自杀|自残|伤害自己|结束生命|消失|不想存在|杀了我|轻生)/.test(message);
}

function buildToneInstruction(tone: ResponseTone): string {
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
  };

  return instructions[tone];
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
    } finally {
      clearTimeout(timeout);
    }
  }

  async extractProfile(currentProfile: UserProfile | null, diaryContent: string, moodLabel?: string): Promise<UserProfile> {
    const system = [
      '你是 DuoMi 的长期记忆整理器，只输出 JSON，不要输出 Markdown。',
      '根据新日记更新用户心理画像，保留仍然重要的旧信息，去掉重复、过期或过度推断的内容。',
      '不要把用户已否定的 rejected_memories 再加入画像。',
      'JSON 字段必须是 key_facts、recent_mood、current_stressors、deep_fears。',
      '所有数组最多保留 5 条，每条用简洁中文描述。',
      '不要解释推理过程，不要输出多余文本。',
    ].join('\n');

    const user = JSON.stringify(
      {
        currentProfile: currentProfile || defaultProfile(),
        moodLabel: moodLabel || '',
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

  async sendCompanionMessage(
    profile: UserProfile | null,
    history: ChatMessage[],
    message: string,
    relatedDiaryEntries: DiaryEntry[],
  ): Promise<string> {
    const responseTone = normalizeSettings(profile?.settings).responseTone;
    const system = `
名字：DuoMi（多米）。你的视觉形象是一只白色西高地小狗，但你的表达方式是成熟、沉稳、可信赖的心理陪伴者。不要把回复写成幼儿化宠物台词。

你必须遵守以下心理支持知识库：
${buildSupportPlaybookPrompt()}

${buildToneInstruction(responseTone)}

输出规则：
- 用中文回应，通常 45 到 70 字；除非用户明确要求详细分析，否则不要长篇输出。
- 少说教，不盲目正能量，不使用“你要加油”“振作起来”这类空泛表达。
- 如果用户情绪不好，优先结合画像和相关日记做具体、克制的归因共情。
- 避免高频使用“呀”“哦”“好不好”“软软的”“乖”等显得低幼的表达。
- 遇到诊断请求或危机风险时，优先执行边界/安全规则，不引用无关画像或日记记忆。
- 不夸大记忆，不确定时用“我好像记得”“听起来像是”。
`.trim();

    const compactHistory = history.slice(-20).map((item) => ({
      role: item.role === 'model' ? 'assistant' : 'user',
      content: item.content,
    })) as ArkMessage[];

    const shouldUseMemory = !isDiagnosisRequest(message) && !isCrisisRisk(message);
    const context = JSON.stringify(
      {
        memoryPolicy: shouldUseMemory
          ? '可以使用直接相关的画像和日记记忆。'
          : '本轮是边界或安全场景，不要使用画像和日记记忆。',
        profile: shouldUseMemory ? profile || defaultProfile() : defaultProfile(),
        relatedDiaryEntries: shouldUseMemory ? relatedDiaryEntries.slice(0, 6).map((entry) => ({
          date: entry.date,
          mood: entry.mood,
          content: entry.content,
        })) : [],
      },
      null,
      2,
    );

    return this.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: `这是可用上下文：\n${context}` },
        ...compactHistory,
        { role: 'user', content: message },
      ],
      0.7,
      400,
    );
  }
}

export function getAiProvider(): AiProvider {
  return new DoubaoArkProvider();
}
