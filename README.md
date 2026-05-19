# DuoMi

DuoMi 是一个私密心理陪伴与日记 App，使用 Vercel、Supabase 和火山方舟豆包 API。它把日记、聊天、长期记忆和透明大脑放在同一个移动端体验里，重点是陪伴、记忆可控和隐私边界。

## 当前功能

- 日记记录：记录每日心情、文字内容，并用 AI 更新用户画像。
- 流式聊天：`/api/chat` 使用文本流返回，前端会边生成边显示 DuoMi 的回复。
- 对话管理：支持多会话、历史消息加载、删除会话和新建会话。
- 自定义语气：支持成熟克制、温柔陪伴、直接清晰、分析反思、绒绒陪伴和专属定制。
- 透明大脑：展示 DuoMi 记住的当下情绪和重要记忆，用户可以删除、标记不准确、调整严重程度。
- 记忆评级：重要记忆按 1 到 5 级管理，等级会影响 DuoMi 提及该事件的频率和强度。
- 烦恼遗忘曲线：低严重度记忆会更快淡出模型上下文，普通烦躁和短期吐槽不会轻易被旧事件绑定。
- 隐私锁：透明大脑可选密码保护；关闭密码需要当前密码；忘记密码可通过预设验证问题重置。
- 日记背景上下文：写日记时自动获取当天天气（Open-Meteo）和城市级地点（OpenStreetMap Nominatim），不保存经纬度。
- 安全边界：心理支持提示词覆盖诊断边界、危机场景、低风险自助练习和记忆使用规则；天气和地点只作为背景事实，不用于心理状态的因果归因。

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

   ```bash
   VITE_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
   VITE_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
   ARK_API_KEY="YOUR_ARK_API_KEY"
   ARK_MODEL_ID="YOUR_ARK_ENDPOINT_OR_MODEL_ID"
   ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
   ```

4. 在 Supabase SQL Editor 中执行 [supabase/schema.sql](supabase/schema.sql)。

5. 启动开发环境：

   ```bash
   npm run dev:vercel
   ```

   这个命令会同时启动前端和 Vercel API 路由。只运行 `npm run dev` 时，前端可以打开，但 `/api/chat`、`/api/extract-profile`、`/api/polish-tone` 不会由 Vercel 本地路由提供。

## 上线到 Vercel

在 Vercel 项目环境变量中配置：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `ARK_API_KEY`
- `ARK_MODEL_ID`
- `ARK_BASE_URL`

`ARK_API_KEY` 和 `ARK_MODEL_ID` 只在服务端 API 路由读取，不会暴露到浏览器。AI 路由会校验 Supabase 登录 token，避免未登录请求消耗模型额度。

## Supabase

执行 `supabase/schema.sql` 会创建或更新：

- `profiles`
- `diary_entries`（含 `weather` 和 `place` JSONB 字段，存储天气快照和城市级地点）
- `chat_conversations`
- `chat_messages`

所有表都启用了 Row Level Security，用户只能访问自己的数据。

`profiles.profile` 是 JSON 画像，当前包含：

- `recent_mood`
- `key_facts`
- `current_stressors`
- `deep_fears`
- `memory_events`
- `rejected_memories`
- `settings`

旧字段会继续兼容；透明大脑主视图优先使用新的 `memory_events`。

## 记忆策略

DuoMi 不应该为了显得“记得你”而频繁翻旧账。当前策略是：

- 普通问候、轻量烦躁、短期没心情时，不主动召回旧记忆。
- 只有本轮表达和旧记忆高度相关时，才最多引用一个最相关记忆。
- 诊断请求或危机风险场景，不引用无关旧记忆。
- 记忆严重度越低，越快从模型上下文中淡出。
- 用户在透明大脑里删除或标记“不准确”的记忆，会从画像中移除并加入拒绝记忆列表。

严重度含义：

| 等级 | 含义 | 提及策略 |
| --- | --- | --- |
| 1 | 轻微 | 几天后自然淡出，通常不主动提起 |
| 2 | 一般 | 一两周无关就少提，明确相关才参考 |
| 3 | 中等 | 只在高度相关时提及 |
| 4 | 严重 | 谨慎保留，避免反复刺激 |
| 5 | 高严重 | 长期保留，优先安全和稳定 |

## 透明大脑密码

透明大脑密码是应用内的可选保护层，用来降低误点打开私密记忆的风险。

- 开启密码时，用户需要选择一个预设验证问题并填写答案。
- 密码和验证答案都只保存哈希。
- 关闭密码必须输入当前密码。
- 忘记密码时，可以通过验证问题重置新密码。

注意：这不是端到端加密方案；数据仍由 Supabase 账号隔离和 RLS 保护。

## AI 路由

- `api/chat.ts`：聊天回复，返回 `text/plain` 流。
- `api/extract-profile.ts`：根据日记更新画像，接收天气/地点作为辅助上下文。
- `api/diary-context.ts`：根据浏览器 IP 获取天气（Open-Meteo）和城市级地点（Nominatim），用于日记背景。
- `api/polish-tone.ts`：把用户自定义语气整理成可执行提示词。
- `api/_lib/aiProvider.ts`：豆包调用、流式解析、记忆召回、画像归一化。
- `api/_lib/supportPlaybook.ts`：心理陪伴安全知识库。

## 脚本

```bash
npm run dev          # 只启动 Vite 前端
npm run dev:vercel   # 启动 Vercel 本地开发环境，包含 API 路由
npm run lint         # TypeScript 类型检查
npm run build        # 生产构建
npm run eval:chat    # 跑聊天评测用例
```

## AI 安全与评测

聊天提示词使用 [api/_lib/supportPlaybook.ts](api/_lib/supportPlaybook.ts) 中的心理支持知识库，覆盖陪伴边界、常见情绪场景、低风险自助练习、危机回应和禁用回应。

基础人工评测用例在 [evals/duomi-chat-cases.json](evals/duomi-chat-cases.json)。每次明显调整提示词、模型参数、记忆召回或危机规则后，应运行：

```bash
npm run eval:chat
```

评测报告会写入 `evals/reports/`。该评测目前用于人工审阅，不做自动合格判定。
