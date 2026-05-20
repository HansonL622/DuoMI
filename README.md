# DuoMI心理陪护日记AI

DuoMI心理陪护日记AI 是一个开源的私密心理陪伴与日记 App。这个仓库当前版本已经合并所有本地功能分支，并作为本地运行版终稿维护。

> **在线体验**：<https://duomi-drab.vercel.app>

应用由 Vite + React 前端、Vercel 本地 API 路由、Supabase 数据库和火山方舟豆包模型组成。前端负责日记、聊天、透明大脑和设置界面；API 路由负责模型调用、画像整理、语气整理、天气地点背景获取与登录校验。

## 开源说明

本项目以 MIT License 开源。仓库只包含代码、公开素材、示例环境变量和评测样例；真实 `.env.local`、`.vercel/`、依赖缓存和构建产物均被 `.gitignore` 排除。

公开部署或二次开发前，请自行配置 Supabase 项目、火山方舟 API Key 和本地环境变量。不要把真实密钥、用户日记、聊天记录、Supabase 导出数据或 Vercel 本地配置提交到仓库。

## 功能概览

- 邮箱账号登录：使用 Supabase Auth 登录和注册。
- 日记记录：按日期保存内容和心情，支持编辑与删除。
- 日记背景：写日记时可获取天气和城市级地点，只保存天气快照和城市信息，不保存经纬度。
- AI 画像整理：日记保存后调用 `/api/extract-profile` 更新用户画像。
- 流式聊天：`/api/chat` 以文本流返回回复，前端边生成边显示。
- 多会话聊天：支持创建、加载、删除会话，聊天消息保存到 Supabase。
- 自定义语气：内置成熟克制、温柔陪伴、直接清晰、分析反思、绒绒陪伴，也支持专属定制语气。
- 透明大脑：展示近期情绪、重要记忆和记忆严重度，用户可以删除或标记不准确。
- 记忆控制：重要记忆按 1 到 5 级管理，低严重度记忆更快淡出上下文。
- 隐私锁：透明大脑可选密码保护，支持预设验证问题重置。
- 数据清理：应用内支持清空当前账号的日记、聊天和画像数据。

## 技术栈

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Supabase Auth / Database / RLS
- Vercel API Routes，本地通过 `vercel dev` 运行
- 火山方舟豆包 API
- Open-Meteo 天气接口
- OpenStreetMap Nominatim 逆地理编码

## 本地运行

### 1. 安装依赖

```bash
npm install
```

### 2. 创建本地环境变量

```bash
cp .env.example .env.local
```

填写 `.env.local`：

```bash
VITE_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
VITE_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"

ARK_API_KEY="YOUR_ARK_API_KEY"
ARK_MODEL_ID="YOUR_ARK_ENDPOINT_OR_MODEL_ID"
ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"

SITE_URL="https://your-app.vercel.app"
```

说明：

- `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 会进入浏览器，用于 Supabase 登录和 RLS 数据访问。
- `ARK_API_KEY`、`ARK_MODEL_ID`、`ARK_BASE_URL` 只由本地 API 路由读取，不应写入前端代码。
- `SITE_URL` 用于 Nominatim User-Agent/Referer 等对外请求标识，部署到 Vercel 时设为你的生产域名。
- 本地 API 会从 `.env.local` 读取服务端变量，所以不需要单独配置 Vercel 项目环境变量。

### 3. 初始化 Supabase

在 Supabase SQL Editor 中执行：

```sql
-- 复制并运行 supabase/schema.sql 的完整内容
```

该脚本会创建或更新：

- `profiles`
- `diary_entries`
- `chat_conversations`
- `chat_messages`
- `api_usage_daily`

所有表都启用了 Row Level Security，用户只能访问自己的数据。

### 4. 启动本地应用

```bash
npm run dev:vercel
```

默认会启动本地前端和 API 路由。打开终端输出里的本地地址，一般是：

```text
http://localhost:3000
```

不要只用 `npm run dev` 作为完整体验入口。它只启动 Vite 前端，不会提供 `/api/chat`、`/api/extract-profile`、`/api/polish-tone`、`/api/diary-context` 这些本地 API。

## Vercel + Supabase 生产部署

### 1. 准备 Supabase 项目

在 [supabase.com](https://supabase.com) 创建项目，进入 SQL Editor 执行 `supabase/schema.sql` 的全部内容。打开 Settings > API，复制 Project URL 和 `anon` public key。

### 2. 部署到 Vercel

将仓库推送到 GitHub，在 [vercel.com](https://vercel.com) 导入项目。

Vercel 会自动识别 Vite + React 项目。在项目 Settings > Environment Variables 中配置以下服务端环境变量：

| 变量名 | 说明 |
|--------|------|
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |
| `ARK_API_KEY` | 火山方舟 API Key |
| `ARK_MODEL_ID` | 火山方舟模型接入点 ID |
| `ARK_BASE_URL` | `https://ark.cn-beijing.volces.com/api/v3` |
| `SITE_URL` | 你的 Vercel 生产域名（如 `https://duomi.vercel.app`） |

`VITE_` 前缀的变量会注入前端构建产物，其他变量由服务端 API 路由读取。**不要**把 `ARK_API_KEY` 等密钥暴露给前端。

### 3. 上线后的每日 API 用量限额

生产环境会对登录用户按日限制 API 调用次数：

| 路由 | 每日限额 |
|------|---------|
| `/api/chat` | 30 |
| `/api/extract-profile` | 60 |
| `/api/polish-tone` | 10 |
| `/api/diary-context` | 100 |

超限返回 HTTP 429。限额通过 Supabase `api_usage_daily` 表自动统计，按 Supabase 数据库日期统计，日期自然切换后重新计数。

### 4. 部署后验证

1. 访问生产域名，确认登录页正常加载。
2. 注册新账号并登录，写一篇日记验证 AI 画像整理。
3. 发送聊天消息，确认流式回复正常。
4. 打开透明大脑，确认记忆数据隔离。
5. 检查 Vercel Functions 日志，确认无异常。

## Supabase 数据结构

`profiles.profile` 是 JSONB 用户画像，当前主要字段为：

- `recent_mood`
- `key_facts`
- `current_stressors`
- `deep_fears`
- `memory_events`
- `rejected_memories`
- `settings`

`diary_entries` 保存日记内容、心情、天气快照和城市级地点：

- `weather`：Open-Meteo 返回的天气摘要。
- `place`：Nominatim 返回的城市、地区、国家和展示标签。

`chat_conversations` 保存会话标题、更新时间、最后消息时间和消息数量。

`chat_messages` 保存每条用户或模型消息，并通过 `conversation_id` 归属到会话。

`api_usage_daily` 按 `user_id + date + route` 记录每日 API 调用次数，后端限流通过 `check_api_usage_daily` RPC 函数原子统计。

## API 路由

- `api/chat.ts`：聊天回复，返回 `text/plain` 流。
- `api/extract-profile.ts`：根据日记、心情、天气和地点更新用户画像。
- `api/diary-context.ts`：接收浏览器定位坐标，返回天气和城市级地点；不会把经纬度写入数据库。
- `api/polish-tone.ts`：把用户描述整理成可执行的回复语气提示词。
- `api/_lib/auth.ts`：校验 Supabase 登录 token。
- `api/_lib/env.ts`：读取本地 `.env.local` 和运行时环境变量。
- `api/_lib/rateLimit.ts`：每日 API 用量限流，通过 Supabase RPC 原子计数。
- `api/_lib/aiProvider.ts`：豆包请求、流式解析、画像归一化和记忆召回。
- `api/_lib/supportPlaybook.ts`：心理陪伴安全知识库。

## 记忆策略

DuoMi 的记忆系统用于提供连续陪伴，不用于频繁翻旧账。

- 普通问候、轻量烦躁、短期没心情时，不主动召回旧记忆。
- 只有本轮表达和旧记忆高度相关时，才最多引用一个最相关记忆。
- 诊断请求或危机风险场景，不引用无关旧记忆。
- 用户删除或标记不准确的记忆后，该内容会从画像中移除并加入拒绝记忆列表。
- 记忆严重度越低，越快从模型上下文中淡出。

| 等级 | 含义 | 提及策略 |
| --- | --- | --- |
| 1 | 轻微 | 几天后自然淡出，通常不主动提起 |
| 2 | 一般 | 一两周无关就少提，明确相关才参考 |
| 3 | 中等 | 只在高度相关时提及 |
| 4 | 严重 | 谨慎保留，避免反复刺激 |
| 5 | 高严重 | 长期保留，优先安全和稳定 |

## 安全与隐私边界

- DuoMi 是心理陪伴工具，不提供医学诊断、治疗方案或危机替代服务。
- 危机场景会优先鼓励用户联系现实支持、当地紧急服务或专业热线。
- 天气和地点只作为日记背景事实，不用于推断心理状态因果。
- 透明大脑密码只是应用内的额外访问保护，不是端到端加密。
- 数据隔离依赖 Supabase Auth 和 RLS；请保管好 Supabase 项目和方舟 API Key。

## 常用命令

```bash
npm run dev:vercel   # 完整本地运行，包含前端和 API 路由
npm run dev          # 只启动 Vite 前端
npm run lint         # TypeScript 类型检查
npm run build        # 生产构建
npm run eval:chat    # 运行聊天人工评测用例
```

评测用例在 `evals/duomi-chat-cases.json`，报告写入 `evals/reports/`。评测目前用于人工审阅，不做自动合格判定。

## 本地验收清单

1. `npm run lint` 通过。
2. `npm run build` 通过。
3. `npm run dev:vercel` 可以打开本地页面。
4. 新账号可以注册或登录。
5. 新建日记后可以保存，透明大脑能更新画像。
6. 聊天可以流式返回，刷新后仍能看到历史会话。
7. 透明大脑的删除、标记不准确、严重度调整和隐私锁可正常使用。
8. 若浏览器允许定位，日记能展示天气和城市级地点；若拒绝定位，日记仍可正常保存。

## 目录说明

```text
api/                 Vercel 本地 API 路由
api/_lib/            服务端通用逻辑
src/                 React 前端
src/components/      主要 UI 组件
src/services/        Supabase、API、天气地点服务
src/utils/           前端工具函数
supabase/schema.sql  数据库初始化和迁移脚本
evals/               聊天评测用例与报告
public/              应用图片和视频素材
```
