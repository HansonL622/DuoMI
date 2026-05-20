create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  profile jsonb not null default '{"key_facts":[],"recent_mood":"","current_stressors":[],"deep_fears":[],"rejected_memories":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null,
  content text not null,
  mood text check (mood in ('happy','angry','sad','naughty','surprised','sleepy','shy','proud','scared')),
  weather jsonb,
  place jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.diary_entries
  add column if not exists weather jsonb,
  add column if not exists place jsonb;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid,
  role text not null check (role in ('user','model')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '新的对话',
  last_message_at timestamptz,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chat_messages
  add column if not exists conversation_id uuid references public.chat_conversations(id) on delete cascade;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_conversation_id_fkey'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_conversation_id_fkey
      foreign key (conversation_id)
      references public.chat_conversations(id)
      on delete cascade;
  end if;
end $$;

insert into public.chat_conversations (user_id, title, last_message_at, message_count)
select
  messages.user_id,
  '旧对话',
  max(messages.created_at),
  count(*)::integer
from public.chat_messages messages
where messages.conversation_id is null
group by messages.user_id
having not exists (
  select 1
  from public.chat_conversations conversations
  where conversations.user_id = messages.user_id
);

update public.chat_messages messages
set conversation_id = conversations.id
from public.chat_conversations conversations
where messages.conversation_id is null
  and conversations.user_id = messages.user_id;

alter table public.chat_messages
  alter column conversation_id set not null;

alter table public.profiles enable row level security;
alter table public.diary_entries enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can delete own profile" on public.profiles;
drop policy if exists "Users can manage own diary entries" on public.diary_entries;
drop policy if exists "Users can manage own chat conversations" on public.chat_conversations;
drop policy if exists "Users can manage own chat messages" on public.chat_messages;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own profile"
  on public.profiles for delete
  using (auth.uid() = user_id);

create policy "Users can manage own diary entries"
  on public.diary_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own chat conversations"
  on public.chat_conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own chat messages"
  on public.chat_messages for all
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.chat_conversations conversations
      where conversations.id = chat_messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.chat_conversations conversations
      where conversations.id = chat_messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  );

create table if not exists public.api_usage_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  route text not null,
  count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, date, route)
);

alter table public.api_usage_daily enable row level security;

drop policy if exists "Users can read own API usage" on public.api_usage_daily;
create policy "Users can read own API usage"
  on public.api_usage_daily for select
  using (auth.uid() = user_id);

create or replace function public.check_api_usage_daily(p_route text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_date date := current_date;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into public.api_usage_daily (user_id, date, route, count)
  values (v_user_id, v_date, p_route, 1)
  on conflict (user_id, date, route)
  do update set count = api_usage_daily.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.check_api_usage_daily(text, integer) from public;
revoke all on function public.check_api_usage_daily(text, integer) from anon;
grant execute on function public.check_api_usage_daily(text, integer) to authenticated;

create index if not exists diary_entries_user_date_idx on public.diary_entries(user_id, entry_date desc);
create index if not exists chat_conversations_user_recent_idx on public.chat_conversations(user_id, last_message_at desc, updated_at desc);
create index if not exists chat_messages_user_created_idx on public.chat_messages(user_id, created_at asc);
create index if not exists chat_messages_conversation_created_idx on public.chat_messages(conversation_id, created_at asc);

create or replace function public.refresh_chat_conversation_stats()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_conversation_id uuid;
begin
  if TG_OP = 'INSERT' then
    target_conversation_id := new.conversation_id;
  else
    target_conversation_id := old.conversation_id;
  end if;

  update public.chat_conversations conversations
  set
    message_count = (
      select count(*)::integer
      from public.chat_messages messages
      where messages.conversation_id = target_conversation_id
    ),
    last_message_at = (
      select max(messages.created_at)
      from public.chat_messages messages
      where messages.conversation_id = target_conversation_id
    ),
    updated_at = now()
  where conversations.id = target_conversation_id;

  return null;
end;
$$;

drop trigger if exists refresh_chat_conversation_stats_on_insert on public.chat_messages;
create trigger refresh_chat_conversation_stats_on_insert
after insert on public.chat_messages
for each row execute function public.refresh_chat_conversation_stats();

drop trigger if exists refresh_chat_conversation_stats_on_delete on public.chat_messages;
create trigger refresh_chat_conversation_stats_on_delete
after delete on public.chat_messages
for each row execute function public.refresh_chat_conversation_stats();
