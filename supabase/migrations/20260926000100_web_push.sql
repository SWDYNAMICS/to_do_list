begin;

create table public.push_subscriptions (
    endpoint text primary key check (length(endpoint) <= 2048),
    user_id uuid not null references auth.users(id) on delete cascade,
    subscription jsonb not null,
    updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant all on public.push_subscriptions to service_role;

create table public.push_test_limits (
    user_id uuid primary key references auth.users(id) on delete cascade,
    last_sent_at timestamptz not null
);
alter table public.push_test_limits enable row level security;
revoke all on public.push_test_limits from public, anon, authenticated;
grant all on public.push_test_limits to service_role;

-- Only the authenticated Edge Function may register endpoints or reserve a send.
create function public.register_push_device(p_user_id uuid, p_subscription jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
    if (select count(*) from public.push_subscriptions where user_id = p_user_id) >= 10
       and not exists (select 1 from public.push_subscriptions
           where endpoint = p_subscription->>'endpoint' and user_id = p_user_id) then
        raise exception 'DEVICE_LIMIT';
    end if;
    insert into public.push_subscriptions(endpoint, user_id, subscription)
    values (p_subscription->>'endpoint', p_user_id, p_subscription)
    on conflict (endpoint) do update set user_id = excluded.user_id,
        subscription = excluded.subscription, updated_at = now();
end;
$$;

create function public.reserve_push_test(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare reserved boolean;
begin
    insert into public.push_test_limits(user_id, last_sent_at)
    values (p_user_id, now())
    on conflict (user_id) do update set last_sent_at = now()
    where public.push_test_limits.last_sent_at < now() - interval '30 seconds'
    returning true into reserved;
    return coalesce(reserved, false);
end;
$$;
revoke all on function public.register_push_device(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.reserve_push_test(uuid) from public, anon, authenticated;
grant execute on function public.register_push_device(uuid, jsonb) to service_role;
grant execute on function public.reserve_push_test(uuid) to service_role;

commit;
