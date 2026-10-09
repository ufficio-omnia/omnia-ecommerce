-- Funzioni della piattaforma gestionale dichiarata nel profilo azienda: elenco
-- facoltativo, una funzione per riga (es. "Cruscotto indicatori in tempo
-- reale", "Segnalazione e tracciamento delle non conformità", "Reportistica
-- mensile"). Serve a decidere se il cruscotto illustrativo di una relazione
-- tecnica si può disegnare: la figura "schermata della piattaforma" compare solo
-- se il profilo dichiara una piattaforma E una funzione di cruscotto,
-- indicatori o reportistica. Il modello non la scrive mai: la legge il codice
-- (src/lib/figure-fatti.ts).
--
-- Idempotente: colonna aggiunta con IF NOT EXISTS, sicura da rieseguire.
-- Il codice funziona anche prima di questa migrazione (legge e salva il campo
-- solo se la colonna esiste; senza il campo il cruscotto non viene disegnato).

alter table public.companies
  add column if not exists funzioni_piattaforma text;
