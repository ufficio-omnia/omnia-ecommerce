-- Codice Identificativo Gara (CIG): estratto dai documenti di gara e mostrato
-- nell'intestazione di ogni pagina del corpo della relazione tecnica Word,
-- insieme alla stazione appaltante (0062) e alla ragione sociale del
-- concorrente. Nullable: valorizzato dall'estrazione AI (anche in
-- rianalisi), mai inserito a mano.
--
-- Idempotente: colonna aggiunta con IF NOT EXISTS.

alter table public.gare
  add column if not exists cig text;
