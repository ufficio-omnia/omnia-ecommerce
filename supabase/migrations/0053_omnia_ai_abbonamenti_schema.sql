-- Tappa 1 — Abbonamenti OMNIA AI: colonne mancanti su subscriptions e
-- ledger di consumo gare.
--
-- subscriptions ha solo current_period_end: manca current_period_start
-- (serve per contare "gare usate nel periodo corrente" con una finestra
-- temporale, non un contatore da azzerare a mano ad ogni rinnovo) e
-- cancel_at_period_end (riflette una disdetta già richiesta ma non
-- ancora effettiva — lo stato reale arriva sempre e solo dal webhook
-- Stripe, mai da questa colonna da sola). Nessuna modifica a
-- plan/status/RLS esistenti: restano compatibili col form admin
-- manuale (src/app/actions/subscriptions.ts), che resta invariato.
--
-- gara_consumi è il ledger di consumo: unique(gara_id) garantisce che
-- una gara non possa mai essere addebitata due volte, anche in caso di
-- doppio click concorrente — l'idempotenza è nel vincolo del database,
-- non solo nel codice applicativo. "Gare usate nel periodo corrente" si
-- calcola contando le righe con tipo='piano' e created_at successivo a
-- current_period_start: nessun contatore mutabile da azzerare a mano.
--
-- Idempotente: colonne/tabella/indice con IF NOT EXISTS, tipo enum e
-- policy dentro DO block che li crea solo se mancano, nessun DROP.

alter table public.subscriptions
  add column if not exists current_period_start timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'gara_consumo_tipo' and n.nspname = 'public'
  ) then
    create type public.gara_consumo_tipo as enum ('piano', 'credito');
  end if;
end $$;

create table if not exists public.gara_consumi (
  id uuid primary key default gen_random_uuid(),
  gara_id uuid not null unique references public.gare (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  tipo public.gara_consumo_tipo not null,
  created_at timestamptz not null default now()
);

alter table public.gara_consumi enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gara_consumi' and policyname = 'gara_consumi_select_own'
  ) then
    create policy "gara_consumi_select_own" on public.gara_consumi
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gara_consumi' and policyname = 'gara_consumi_select_admin'
  ) then
    create policy "gara_consumi_select_admin" on public.gara_consumi
      for select using (public.is_admin());
  end if;
end $$;

-- Sola lettura per authenticated: la scrittura avviene sempre lato
-- server con la service role (gate di consumo, mai una sessione
-- cliente), stesso pattern già usato per subscriptions/credits.
grant select on public.gara_consumi to authenticated;
grant select, insert, update, delete on public.gara_consumi to service_role;

create index if not exists gara_consumi_user_id_idx on public.gara_consumi (user_id);
