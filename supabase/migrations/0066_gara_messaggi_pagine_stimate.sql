-- Stima delle pagine del documento generato in questo messaggio (bozza di
-- un criterio o relazione finale composta), calcolata al momento della
-- generazione e mostrata nella scheda della gara accanto al pulsante di
-- scaricamento, insieme al limite dichiarato dal disciplinare (gare.
-- limite_pagine_totale). Nullable: un messaggio senza file generato, o
-- generato prima di questa colonna, non ha una stima.
--
-- Idempotente: colonna aggiunta con IF NOT EXISTS.

alter table public.gara_messaggi
  add column if not exists pagine_stimate numeric;
