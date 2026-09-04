-- Fase 2A — dati di fatturazione sul profilo azienda del cliente.
-- Un solo profilo azienda per utente (vincolo unique), aggiornabile a
-- ogni acquisto invece di crearne uno nuovo ogni volta.

alter table public.companies
  add column codice_sdi text,
  add column pec text;

alter table public.companies
  add constraint companies_user_id_unique unique (user_id);
