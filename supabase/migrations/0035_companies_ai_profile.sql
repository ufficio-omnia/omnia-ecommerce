-- Fase 2B.1 — profilo azienda permanente per OMNIA AI.
-- Campi aggiuntivi sulla tabella companies già esistente (Fase 1/2A),
-- usati come contesto fisso dall'AI nelle fasi successive (analisi gare,
-- generazione contenuti). Tutti nullable: le righe già create dal
-- checkout (bonifico) non hanno questi dati e vanno completate dal
-- cliente dall'area riservata.

alter table public.companies
  add column forma_giuridica text,
  add column anno_costituzione integer,
  add column numero_dipendenti integer,
  add column fatturato_medio_annuo numeric(12, 2),
  add column certificazioni text,
  add column referenze text,
  add column settori_attivita text,
  add column presentazione text,
  add column sito_web text,
  add column telefono_aziendale text;
