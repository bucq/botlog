-- Bot100 Log: Supabase スキーマ
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行する。何度実行しても壊れないよう冪等に書いている。

-- ---------------------------------------------------------------
-- profiles: ユーザーごとの表示名・公開設定・目標
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32),
  avatar_url text,
  is_public boolean not null default true,  -- false ならランキング・他ユーザーから見えない
  goals jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- records: 1試行 = 1行。id はクライアント生成（オフライン追加の重複送信を upsert で吸収するため）
-- ---------------------------------------------------------------
create table if not exists public.records (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  date date not null,
  mode text not null check (mode in ('b100_static', 'b100_strafe', 'k30_easy', 'k30_medium', 'k30_hard')),
  value integer not null check (value between 0 and 9999),
  weapon_id text not null default '',
  weapon text not null default '' check (char_length(weapon) <= 64),
  skin_id text not null default '',
  skin text not null default '' check (char_length(skin) <= 64),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists records_mode_user_idx on public.records (mode, user_id);

-- ---------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.records enable row level security;

drop policy if exists "profiles: read public or own" on public.profiles;
create policy "profiles: read public or own" on public.profiles
  for select to authenticated
  using (is_public or id = (select auth.uid()));

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "records: read own or public" on public.records;
create policy "records: read own or public" on public.records
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.profiles p where p.id = records.user_id and p.is_public)
  );

drop policy if exists "records: insert own" on public.records;
create policy "records: insert own" on public.records
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "records: update own" on public.records;
create policy "records: update own" on public.records
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "records: delete own" on public.records;
create policy "records: delete own" on public.records
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- profiles の id / created_at はクライアントから変更させない
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, is_public, goals) on public.profiles to authenticated;

-- ---------------------------------------------------------------
-- 新規登録時にプロフィールを自動作成（Discord の表示名・アイコンを初期値にする）
-- ---------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'global_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      'Player'
    ), 32),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------
-- ランキング: モード × ユーザーの集計（公開ユーザーのみ）
-- security_invoker で呼び出したユーザーの RLS がそのまま効く
-- ---------------------------------------------------------------
create or replace view public.leaderboard
with (security_invoker = true) as
select
  r.mode,
  r.user_id,
  p.display_name,
  p.avatar_url,
  case when r.mode like 'b100%' then min(r.value) else max(r.value) end as best,
  round(avg(r.value) filter (where r.date >= current_date - 6), 1) as recent_avg,
  count(*)::integer as attempts,
  max(r.date) as last_date
from public.records r
join public.profiles p on p.id = r.user_id
where p.is_public
group by r.mode, r.user_id, p.display_name, p.avatar_url;

revoke all on public.leaderboard from anon;
grant select on public.leaderboard to authenticated;
