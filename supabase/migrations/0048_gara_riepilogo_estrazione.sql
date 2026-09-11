-- Fase 2B — riepilogo compatto dei dati estratti, per mostrare al
-- cliente solo le informazioni rilevanti in tabelle sintetiche invece
-- del testo completo (che resta comunque salvato in criteri_valutazione/
-- requisiti/limiti_formattazione e continua a essere usato da OMNIA AI
-- per la generazione con fedeltà totale al disciplinare).
--
-- Idempotente: colonne aggiunte con IF NOT EXISTS.

alter table public.gare
  add column if not exists criteri_riepilogo jsonb,
  add column if not exists requisiti_chiave jsonb,
  add column if not exists punteggio_tecnico_max numeric,
  add column if not exists punteggio_economico_max numeric,
  add column if not exists limite_pagine_totale integer;
