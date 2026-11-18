-- Gare in omaggio di OMNIA AI: gare in più rispetto al piano, regalate dalla console per un periodo.
--
-- Una riga = un omaggio: «N gare in più al mese, dal giorno X al giorno Y» (date di Roma, estremi compresi).
-- Finché l'omaggio è in corso, le gare incluse dell'abbonamento attivo valgono quelle del piano (o dell'offerta
-- pilot) PIÙ quelle regalate; finito il periodo si torna da sole alle gare del piano. Le gare già avviate
-- nel frattempo restano del cliente. Lo decide il codice in un solo punto (gareInclusePerAbbonamento).
-- Un omaggio non si cancella: si revoca (revocato_il), così resta traccia di chi l'ha dato e tolto.
--
-- Migrazione ADDITIVA e idempotente: una tabella nuova, nessun dato toccato. Leggibile e scrivibile solo
-- dalla chiave di servizio (console e server); al cliente arrivano solo i numeri già calcolati.
-- Il codice nuovo, se la tabella manca, si comporta come prima (nessuna gara in omaggio): si può eseguire
-- prima o dopo il deploy.

create table if not exists public.omnia_ai_gare_omaggio (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- gare in più per ogni mese di abbonamento compreso nel periodo
  gare integer not null check (gare between 1 and 20),
  dal date not null,
  al date not null,
  motivo text check (motivo is null or char_length(motivo) <= 300),
  creato_da_email text not null,
  creato_il timestamptz not null default now(),
  revocato_il timestamptz,
  revocato_da_email text,
  constraint omnia_ai_gare_omaggio_periodo check (al >= dal)
);

create index if not exists omnia_ai_gare_omaggio_utente_idx on public.omnia_ai_gare_omaggio (user_id, al desc);

alter table public.omnia_ai_gare_omaggio enable row level security;
grant select, insert, update on public.omnia_ai_gare_omaggio to service_role;

comment on table public.omnia_ai_gare_omaggio is
  'Gare in più rispetto al piano regalate dalla console a un cliente, valide dal giorno «dal» al giorno «al» (Roma, compresi).';
