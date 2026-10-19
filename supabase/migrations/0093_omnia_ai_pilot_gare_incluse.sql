-- Offerta pilot di OMNIA AI: gare incluse al mese dedicate al cliente.
--
-- Finora l'offerta pilot (migrazione 0086) cambiava solo il PREZZO di un piano. Qui si aggiunge, sempre
-- per quel cliente, il numero di gare incluse al mese (per esempio 4 invece delle 3 di Starter):
--   - null    = valgono le gare del piano (comportamento di prima: tutte le offerte già esistenti restano così);
--   - 1..100  = le gare dedicate, per tutta la durata del prezzo pilot (stessi mesi dell'offerta; 0 mesi = sempre).
-- Finito il prezzo pilot tornano insieme il prezzo pieno e le gare del piano: lo decide il codice leggendo
-- questa colonna solo finché il pilot è in corso, per l'abbonamento Stripe a cui l'offerta è stata applicata.
--
-- Migrazione ADDITIVA e idempotente: una colonna in più, nullable, nessun dato toccato, nessun permesso nuovo
-- (la tabella resta leggibile e scrivibile solo dalla chiave di servizio, come da 0086). Il codice già online
-- non la nomina: si può eseguire prima o dopo il deploy; il codice nuovo la richiede, quindi va eseguita PRIMA
-- di mandare online il codice nuovo.

alter table public.omnia_ai_offerte_pilot
  add column if not exists gare_incluse integer
  check (gare_incluse is null or gare_incluse between 1 and 100);

comment on column public.omnia_ai_offerte_pilot.gare_incluse is
  'Gare incluse al mese dedicate al cliente per tutta la durata del prezzo pilot; null = quelle del piano.';
