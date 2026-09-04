-- Fase 2A — chat di assistenza: un'unica conversazione continua per
-- cliente, visibile e gestibile dall'admin nella pagina del cliente

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  sender text not null check (sender in ('cliente', 'admin')),
  body text not null,
  created_at timestamptz not null default now()
);

create index idx_messages_user_id on public.messages (user_id);

alter table public.messages enable row level security;

create policy "messages_select_own" on public.messages
  for select using (auth.uid() = user_id);

create policy "messages_select_admin" on public.messages
  for select using (public.is_admin());

-- Il cliente può scrivere solo nella propria conversazione, sempre come
-- mittente "cliente" (non può impersonare l'admin).
create policy "messages_insert_own" on public.messages
  for insert with check (auth.uid() = user_id and sender = 'cliente');

-- L'admin può scrivere nella conversazione di qualunque cliente, sempre
-- come mittente "admin".
create policy "messages_insert_admin" on public.messages
  for insert with check (public.is_admin() and sender = 'admin');

grant select, insert on public.messages to authenticated;
grant select, insert on public.messages to service_role;
