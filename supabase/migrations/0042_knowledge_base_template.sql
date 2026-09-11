-- Fase 2B.6 — un documento della knowledge base può essere marcato come
-- "struttura master": indice/titoli/sottotitoli da seguire obbligatoriamente
-- quando si genera un documento completo, non solo ispirazione di stile.
-- Un solo documento alla volta è la struttura attiva (applicato a livello
-- applicativo, non con un vincolo DB, per restare semplice).
--
-- Idempotente: colonne aggiunte con IF NOT EXISTS.

alter table public.knowledge_base_documenti
  add column if not exists e_template boolean not null default false,
  add column if not exists struttura_titoli text;
