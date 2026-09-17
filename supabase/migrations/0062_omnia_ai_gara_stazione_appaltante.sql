-- Nome dell'ente/stazione appaltante che ha indetto la gara, mostrato
-- nell'elenco gare della dashboard. Valorizzato dall'estrazione AI
-- (stesso punto degli altri campi in gara-extraction.ts), non da
-- inserimento manuale: evitare due fonti di verità per lo stesso dato.
-- Nullable: le gare esistenti e quelle non ancora analizzate restano
-- senza valore finché un'analisi non lo popola.
alter table public.gare add column if not exists stazione_appaltante text;
