import { getEnv } from './env';

const DAILY_LIMITS: Record<string, number> = {
  chat: 30,
  'extract-profile': 60,
  'polish-tone': 10,
  'diary-context': 100,
};

export class RateLimitError extends Error {
  constructor() {
    super('今天的使用次数已达上限，请明天再试。');
    this.name = 'RateLimitError';
  }
}

function getToken(req: { headers?: Record<string, string | string[] | undefined> }): string {
  const authHeader = req.headers?.authorization;
  return Array.isArray(authHeader) ? authHeader[0] : (authHeader || '');
}

export async function checkRateLimit(
  route: string,
  req: { headers?: Record<string, string | string[] | undefined> },
): Promise<void> {
  const limit = DAILY_LIMITS[route];
  if (!limit) return;

  const supabaseUrl = getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL');
  const supabaseAnonKey = getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('API 限流服务尚未配置');
  }

  const token = getToken(req);
  if (!token || !token.startsWith('Bearer ')) {
    throw new Error('请先登录 DuoMi');
  }

  const baseUrl = supabaseUrl.replace(/\/$/, '');

  const response = await fetch(`${baseUrl}/rest/v1/rpc/check_api_usage_daily`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_route: route, p_limit: limit }),
  });

  if (!response.ok) {
    throw new Error('API 限流检查失败');
  }

  const allowed = await response.json();
  if (!allowed) {
    throw new RateLimitError();
  }
}
