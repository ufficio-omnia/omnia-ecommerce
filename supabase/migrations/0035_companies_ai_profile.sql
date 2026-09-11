-- Fase 2B.1 — profilo azienda permanente per OMNIA AI.
-- Campi aggiuntivi sulla tabella companies già esistente (Fase 1/2A),
-- usati come contesto fisso dall'AI nelle fasi successive (analisi gare,
-- generazione contenuti). Tutti nullable: le righe già create dal
-- checkout (bonifico) non hanno questi dati e vanno completate dal
-- cliente dall'area riservata.
--
-- Idempotente: colonne aggiunte con IF NOT EXISTS, sicura da rieseguire
-- se già applicata in tutto o in parte.

alter table public.companies
  add column if not exists forma_giuridica text,
  add column if not exists anno_costituzione integer,
  add column if not exists numero_dipendenti integer,
  add column if not exists fatturato_medio_annuo numeric(12, 2),
  add column if not exists certificazioni text,
  add column if not exists referenze text,
  add column if not exists settori_attivita text,
  add column if not exists presentazione text,
  add column if not exists sito_web text,
  add column if not exists telefono_aziendale text;
