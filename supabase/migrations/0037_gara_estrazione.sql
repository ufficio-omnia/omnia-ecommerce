-- Fase 2B.3 — estrazione automatica dati gara (scadenza, importo, criteri,
-- requisiti) dai documenti caricati. Diventerà il contesto iniziale della
-- chat OMNIA AI (2B.4/2B.5), non una funzione isolata.
--
-- Idempotente: il tipo enum viene creato solo se manca (CREATE TYPE non
-- supporta IF NOT EXISTS in Postgres), le colonne con IF NOT EXISTS.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'estrazione_stato' and n.nspname = 'public'
  ) then
    create type public.estrazione_stato as enum (
      'da_eseguire',
      'in_corso',
      'completata',
      'errore'
    );
  end if;
end $$;

alter table public.gare
  add column if not exists scadenza date,
  add column if not exists importo numeric(12, 2),
  add column if not exists criteri_valutazione text,
  add column if not exists requisiti text,
  add column if not exists estrazione_stato public.estrazione_stato not null default 'da_eseguire',
  add column if not exists estrazione_aggiornata_il timestamptz;
