-- SOLO PER LA PROVA ISOLATA su un Postgres usa e getta (contenitore senza rete). MAI su staging o produzione.
-- I pochi oggetti di Supabase e delle migrazioni precedenti alla 0109 che le migrazioni del radar (0109–0121) richiamano, ridotti al minimo:
-- i ruoli di Supabase (senza accesso: servono solo per i permessi) e tre tabelle di altre funzioni del progetto con le sole colonne usate.
\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  -- come su Supabase: il ruolo del server ignora le regole RLS, non i permessi
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- 0111 e 0112: chiavi esterne verso utenti e gare del progetto (qui vuote)
create table if not exists public.users (id uuid primary key);
create table if not exists public.gare (id uuid primary key);
-- 0077: impostazioni della console (0111 e 0116 vi inseriscono i valori iniziali)
create table if not exists public.console_impostazioni (
  chiave text primary key,
  valore text not null,
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid
);
grant select, insert, update on public.console_impostazioni to service_role;
-- 0092: il titolare effettivo dell'utente collegato (usato dalle regole RLS della 0112). Qui nessun utente è collegato: restituisce null,
-- quindi quelle regole non concedono nulla
create or replace function public.omnia_ai_titolare_effettivo() returns uuid language sql stable as $$ select null::uuid $$;

-- funzioni di controllo della prova (schema a parte, tolto alla fine con il contenitore). Le tabelle del radar nascono dopo, con le
-- migrazioni: il corpo delle funzioni si controlla quando vengono usate, non adesso
set check_function_bodies = off;
create schema if not exists prova;
create or replace function prova.verifica(nome text, ok boolean) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FALLITO %', nome; end if;
  raise notice 'ok     %', nome;
end $$;
-- fonti di una gara come insieme ordinato
create or replace function prova.fonti(p uuid) returns text[] language sql stable as $$
  select coalesce(array(select distinct x from unnest((select fonti from public.radar_procedure where id = p)) x order by 1), '{}')
$$;
-- gli oggetti dello schema public (tabelle, colonne, indici, funzioni, trigger, vincoli): per provare che una migrazione non ne toglie
create or replace function prova.oggetti_ora() returns setof text language sql stable as $$
  select 'tabella:' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
  union all
  select 'colonna:' || c.relname || '.' || a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  union all
  select 'indice:' || indexname from pg_indexes where schemaname = 'public'
  union all
  select 'funzione:' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'trigger:' || c.relname || '.' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
  union all
  select 'vincolo:' || c.conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'
$$;
-- quante gare hanno fonti diverse dall'insieme delle fonti delle loro provenienze (riferimenti obsoleti)
create or replace function prova.obsolete() returns int language sql stable as $$
  select count(*)::int from public.radar_procedure g
   where coalesce(array(select distinct x from unnest(g.fonti) x order by 1), '{}')
         is distinct from coalesce((select array_agg(distinct f.fonte order by f.fonte) from public.radar_procedure_fonti f where f.procedura_id = g.id), '{}')
$$;
