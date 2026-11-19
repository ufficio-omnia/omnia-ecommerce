-- 0124 — Tender Intelligence, fase B4: preferenze delle notifiche email (impresa e persona). BOZZA (B2, 26B): non applicata.
-- Additiva e idempotente. Richiede 0092 (omnia_ai_membri, omnia_ai_titolare_effettivo) e 0111 (omnia_ai_radar_impostazioni).
-- Tutto SPENTO di base. Il titolare decide; l'Ufficio Gare vede l'interruttore dell'impresa e le PROPRIE preferenze. Scritture solo dal
-- server dopo la guardia (nessun permesso di scrittura ai clienti). Nessun indirizzo email qui: si legge da auth.users al momento dell'invio.

create table if not exists public.omnia_ai_radar_notifiche_impresa (
  impresa_id uuid primary key references public.omnia_ai_radar_impostazioni (user_id) on delete cascade,
  email_attive boolean not null default false,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid                            -- audit, senza chiave esterna
);

create table if not exists public.omnia_ai_radar_notifiche_persone (
  impresa_id uuid not null references public.omnia_ai_radar_notifiche_impresa (impresa_id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  nuove_opportunita boolean not null default false,
  scadenze boolean not null default false,
  rettifiche boolean not null default false,
  -- indirizzo bloccato dopo un rimbalzo definitivo o un reclamo (dal webhook del provider, futuro); si sblocca solo da una nuova verifica
  email_bloccata_il timestamptz,
  motivo_blocco text check (motivo_blocco is null or motivo_blocco in ('rimbalzo', 'reclamo', 'soppressione')),
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid,                           -- audit, senza chiave esterna
  primary key (impresa_id, user_id),
  constraint omnia_ai_radar_notifiche_persone_blocco check ((email_bloccata_il is null) = (motivo_blocco is null))
);
create index if not exists omnia_ai_radar_notifiche_persone_utente_idx on public.omnia_ai_radar_notifiche_persone (user_id);

-- separazione tra imprese, decisa dal database: una preferenza solo per il titolare o per un membro di QUELL'impresa
create or replace function public.radar_notifiche_persona_dell_impresa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id = new.impresa_id then
    return new;
  end if;
  if exists (select 1 from public.omnia_ai_membri m where m.membro_id = new.user_id and m.titolare_id = new.impresa_id) then
    return new;
  end if;
  raise exception 'L''utente % non appartiene all''impresa %', new.user_id, new.impresa_id using errcode = '23514';
end
$$;
create or replace trigger omnia_ai_radar_notifiche_persone_impresa
  before insert or update of impresa_id, user_id on public.omnia_ai_radar_notifiche_persone
  for each row execute function public.radar_notifiche_persona_dell_impresa();

alter table public.omnia_ai_radar_notifiche_impresa enable row level security;
alter table public.omnia_ai_radar_notifiche_persone enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'omnia_ai_radar_notifiche_impresa' and policyname = 'omnia_ai_radar_notifiche_impresa_select_account') then
    create policy "omnia_ai_radar_notifiche_impresa_select_account" on public.omnia_ai_radar_notifiche_impresa
      for select to authenticated using ((select public.omnia_ai_titolare_effettivo()) = impresa_id);
  end if;
  -- il titolare vede tutte le persone della sua impresa; un membro attivo solo la propria riga
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'omnia_ai_radar_notifiche_persone' and policyname = 'omnia_ai_radar_notifiche_persone_select') then
    create policy "omnia_ai_radar_notifiche_persone_select" on public.omnia_ai_radar_notifiche_persone
      for select to authenticated using (
        (select public.omnia_ai_titolare_effettivo()) = impresa_id
        and (impresa_id = (select auth.uid()) or user_id = (select auth.uid())));
  end if;
end $$;

revoke all on public.omnia_ai_radar_notifiche_impresa from public, anon, authenticated, service_role;
revoke all on public.omnia_ai_radar_notifiche_persone from public, anon, authenticated, service_role;
grant select on public.omnia_ai_radar_notifiche_impresa to authenticated;
grant select on public.omnia_ai_radar_notifiche_persone to authenticated;
grant select, insert, update, delete on public.omnia_ai_radar_notifiche_impresa to service_role;
grant select, insert, update, delete on public.omnia_ai_radar_notifiche_persone to service_role;

notify pgrst, 'reload schema';
