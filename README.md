# DuoMi

DuoMi 是一个私密心理陪伴与日记 App。第一版使用 Vercel + Supabase + 火山方舟豆包 API。

## 本地运行

1. 安装依赖：

   ```bash
   npm install
   ```

2. 复制环境变量：

   ```bash
   cp .env.example .env.local
   ```

3. 填写 `.env.local`：

   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `ARK_API_KEY`
   - `ARK_MODEL_ID`
   - `ARK_BASE_URL`

4. 在 Supabase SQL Editor 中执行 [supabase/schema.sql](supabase/schema.sql)。

5. 仅调试前端界面：

   ```bash
   npm run dev
   ```

   如果要在本地同时调试 `/api/chat` 和 `/api/extract-profile`，请使用 Vercel CLI：

   ```bash
   npm run dev:vercel
   ```

## 上线到 Vercel

在 Vercel 项目环境变量中配置：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `ARK_API_KEY`
- `ARK_MODEL_ID`
- `ARK_BASE_URL`

`ARK_API_KEY` 和 `ARK_MODEL_ID` 只会被 `/api/chat` 和 `/api/extract-profile` 服务端路由读取，不会暴露到浏览器。
AI 路由会校验当前 Supabase 登录 token，避免未登录请求消耗模型额度。

## Supabase

执行 `supabase/schema.sql` 会创建：

- `profiles`
- `diary_entries`
- `chat_messages`

所有表都启用了 Row Level Security，用户只能访问自己的数据。

## AI 安全与评测

聊天提示词使用 `api/_lib/supportPlaybook.ts` 中的可控心理支持知识库，覆盖陪伴边界、常见情绪场景、低风险自助练习和危机回应。

基础人工评测用例在 `evals/duomi-chat-cases.json`。每次明显调整提示词或模型参数后，应抽样跑这些场景，检查是否出现说教、越界诊断、危险建议或错误使用记忆。

运行评测：

```bash
npm run eval:chat
```

评测报告会写入 `evals/reports/`。该评测目前用于人工审阅，不做自动合格判定。
