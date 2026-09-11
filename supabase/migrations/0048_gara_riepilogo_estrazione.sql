-- Fase 2B — riepilogo compatto dei dati estratti, per mostrare al
-- cliente solo le informazioni rilevanti in tabelle sintetiche invece
-- del testo completo (che resta comunque salvato in criteri_valutazione/
-- requisiti/limiti_formattazione e continua a essere usato da OMNIA AI
-- per la generazione con fedeltà totale al disciplinare).

alter table public.gare
  add column criteri_riepilogo jsonb,
  add column requisiti_chiave jsonb,
  add column punteggio_tecnico_max numeric,
  add column punteggio_economico_max numeric,
  add column limite_pagine_totale integer;
