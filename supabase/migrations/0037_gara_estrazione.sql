-- Fase 2B.3 — estrazione automatica dati gara (scadenza, importo, criteri,
-- requisiti) dai documenti caricati. Diventerà il contesto iniziale della
-- chat OMNIA AI (2B.4/2B.5), non una funzione isolata.

create type public.estrazione_stato as enum (
  'da_eseguire',
  'in_corso',
  'completata',
  'errore'
);

alter table public.gare
  add column scadenza date,
  add column importo numeric(12, 2),
  add column criteri_valutazione text,
  add column requisiti text,
  add column estrazione_stato public.estrazione_stato not null default 'da_eseguire',
  add column estrazione_aggiornata_il timestamptz;
