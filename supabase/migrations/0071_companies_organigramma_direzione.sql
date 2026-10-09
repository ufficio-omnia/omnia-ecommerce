-- Livello di Direzione dell'organigramma di commessa: due elenchi facoltativi
-- nel profilo azienda, una voce per riga ("Responsabile Acquisti" oppure
-- "Responsabile Acquisti (Mario Bianchi)"). Se compilati, compaiono nei due
-- riquadri della fascia di direzione dell'organigramma delle offerte tecniche;
-- se vuoti la fascia non compare. Il modello non li scrive mai: li legge il
-- codice (src/lib/organigramma-contesto.ts).
--
-- Idempotente: colonne aggiunte con IF NOT EXISTS, sicura da rieseguire.
-- Il codice funziona anche prima di questa migrazione (legge e salva questi
-- campi solo se la colonna esiste).

alter table public.companies
  add column if not exists funzioni_direzione text,
  add column if not exists uffici_gestione text;
