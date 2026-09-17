-- Notifiche OMNIA AI: campanella in testata con contatore dei non letti.
-- Un solo meccanismo di deduplica per tutti i tipi di evento (indice
-- unico su user_id+tipo+chiave_dedup): ogni punto che genera una
-- notifica tenta sempre l'insert, un conflitto (23505) viene ignorato
-- in silenzio — stesso idioma già usato per gara_consumi. chiave_dedup è
-- nullable per restare compatibile con un futuro tipo di notifica senza
-- concetto naturale di "stesso evento" da deduplicare, anche se i 7 tipi
-- di oggi ne hanno sempre uno.
create table if not exists public.omnia_ai_notifiche (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  tipo text not null check (
    tipo in (
      'analisi_conclusa',
      'relazione_generata',
      'gara_scadenza_7gg',
      'gara_scadenza_2gg',
      'gare_piano_esaurite',
      'rinnovo_3gg',
      'pagamento_fallito'
    )
  ),
  gara_id uuid references public.gare (id) on delete set null,
  titolo text not null,
  corpo text not null,
  letta boolean not null default false,
  chiave_dedup text,
  created_at timestamptz not null default now()
);

create unique index if not exists omnia_ai_notifiche_dedup_idx on public.omnia_ai_notifiche (user_id, tipo, chiave_dedup)
where
  chiave_dedup is not null;

create index if not exists omnia_ai_notifiche_user_id_idx on public.omnia_ai_notifiche (user_id, created_at desc);

alter table public.omnia_ai_notifiche enable row level security;

create policy "omnia_ai_notifiche_select_own" on public.omnia_ai_notifiche for select using (auth.uid () = user_id);

create policy "omnia_ai_notifiche_update_own" on public.omnia_ai_notifiche
for update
  using (auth.uid () = user_id)
  with
  check (auth.uid () = user_id);

create policy "omnia_ai_notifiche_select_admin" on public.omnia_ai_notifiche for select using (public.is_admin ());

-- Insert solo da service_role: ogni notifica nasce lato server nel
-- momento in cui l'evento reale accade (azione, webhook, cron), mai
-- da un'azione che il cliente possa richiamare direttamente.
grant select, update on public.omnia_ai_notifiche to authenticated;

grant select, insert, update, delete on public.omnia_ai_notifiche to service_role;
