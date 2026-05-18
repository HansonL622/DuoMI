import { getEnv } from './env';

export async function requireUser(req: { headers?: Record<string, string | string[] | undefined> }) {
  const authHeader = req.headers?.authorization;
  const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;

  if (!token?.startsWith('Bearer ')) {
    throw new Error('请先登录 DuoMi');
  }

  const supabaseUrl = getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL');
  const supabaseAnonKey = getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase 服务端环境变量尚未配置');
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: token,
    },
  });

  if (!response.ok) {
    throw new Error('登录状态已失效，请重新登录');
  }

  return response.json();
}
