-- Chat di supporto OMNIA AI: una conversazione continua per utente (non
-- per gara, a differenza di gara_messaggi), distinta anche da "messages"
-- (feature non-AI già esistente per il contatto cliente↔admin).
create table if not exists public.assistenza_messaggi (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  ruolo text not null check (ruolo in ('utente', 'assistente')),
  contenuto text not null,
  created_at timestamptz not null default now()
);

create index if not exists assistenza_messaggi_user_id_idx on public.assistenza_messaggi (user_id, created_at);

alter table public.assistenza_messaggi enable row level security;

create policy "assistenza_messaggi_all_own" on public.assistenza_messaggi for all using (auth.uid () = user_id)
with
  check (auth.uid () = user_id);

create policy "assistenza_messaggi_select_admin" on public.assistenza_messaggi for select using (public.is_admin ());

grant select, insert, update, delete on public.assistenza_messaggi to authenticated;

grant select, insert, update, delete on public.assistenza_messaggi to service_role;
