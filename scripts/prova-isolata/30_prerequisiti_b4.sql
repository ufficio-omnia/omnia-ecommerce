-- SOLO PER LA PROVA ISOLATA della fase B4 (contenitore usa e getta, senza rete). MAI su staging o produzione.
-- Si applica DOPO 00_prerequisiti.sql e le migrazioni 0109–0121, PRIMA delle bozze 0122–0125.
-- Riproduce il minimo di Supabase che le bozze usano: lo schema «auth» (utenti con conferma dell'email, blocco, cancellazione; auth.uid()
-- letto da request.jwt.claim.sub come su Supabase) e, dalla 0092, la tabella omnia_ai_membri e la VERA omnia_ai_titolare_effettivo()
-- (al posto di quella finta di 00_prerequisiti.sql, che restituiva sempre null).
\set ON_ERROR_STOP on

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  deleted_at timestamptz
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- 0092 (parte usata): Ufficio Gare
create table if not exists public.omnia_ai_membri (
  membro_id uuid primary key references public.users (id) on delete cascade,
  titolare_id uuid not null references public.users (id) on delete cascade,
  ruolo text not null default 'ufficio_gare' check (ruolo in ('ufficio_gare')),
  attivo boolean not null default true,
  creato_il timestamptz not null default now(),
  constraint omnia_ai_membri_diversi check (membro_id <> titolare_id)
);
create unique index if not exists omnia_ai_membri_un_ruolo_per_titolare on public.omnia_ai_membri (titolare_id, ruolo);
alter table public.omnia_ai_membri enable row level security;
grant select on public.omnia_ai_membri to authenticated;
grant select, insert, update, delete on public.omnia_ai_membri to service_role;

create or replace function public.omnia_ai_titolare_effettivo()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.titolare_id from public.omnia_ai_membri m where m.membro_id = auth.uid() and m.attivo),
    auth.uid()
  );
$$;
revoke all on function public.omnia_ai_titolare_effettivo() from public;
grant execute on function public.omnia_ai_titolare_effettivo() to authenticated, service_role;

-- funzione di controllo degli ERRORI attesi (schema «prova» di 00_prerequisiti.sql): esegue il comando con il ruolo corrente e verifica
-- il codice SQLSTATE
create or replace function prova.atteso_errore(nome text, comando text, codice text) returns void language plpgsql as $$
begin
  begin
    execute comando;
  exception when others then
    if sqlstate = codice then
      raise notice 'ok     %', nome;
      return;
    end if;
    raise exception 'FALLITO % (errore % invece di %: %)', nome, sqlstate, codice, sqlerrm;
  end;
  raise exception 'FALLITO % (nessun errore, atteso %)', nome, codice;
end $$;
grant usage on schema prova to anon, authenticated, service_role;
grant execute on all functions in schema prova to anon, authenticated, service_role;
