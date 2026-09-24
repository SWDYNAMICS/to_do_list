-- Supabase Dashboard > SQL Editor에서 이 파일 전체를 한 번 실행하세요.

create table if not exists public.user_app_data (
    user_id uuid not null references auth.users(id) on delete cascade,
    data_key text not null check (data_key in ('todos', 'plans', 'learning')),
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (user_id, data_key)
);

alter table public.user_app_data enable row level security;

drop policy if exists "Users can read their own app data" on public.user_app_data;
create policy "Users can read their own app data"
on public.user_app_data
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own app data" on public.user_app_data;
create policy "Users can insert their own app data"
on public.user_app_data
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own app data" on public.user_app_data;
create policy "Users can update their own app data"
on public.user_app_data
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own app data" on public.user_app_data;
create policy "Users can delete their own app data"
on public.user_app_data
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.user_app_data from anon;
grant select, insert, update, delete on table public.user_app_data to authenticated;
