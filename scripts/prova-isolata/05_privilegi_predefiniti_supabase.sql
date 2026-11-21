-- SOLO PER LA PROVA ISOLATA (dossier Z5, documento 45): i PERMESSI PREDEFINITI dello schema public come sullo staging, letti in sola lettura
-- il 21/11/2026 (pg_default_acl): ogni tabella, funzione e sequenza creata dal ruolo postgres nello schema public riceve TUTTI i permessi per
-- anon, authenticated e service_role (tabelle «arwdDxtm», funzioni EXECUTE, sequenze «rwU»). Con questa emulazione una migrazione che
-- dimenticasse un «revoke» lascerebbe nel Postgres isolato gli stessi permessi che lascerebbe sullo staging: le prove dei permessi valgono
-- anche per lo staging. Si applica PRIMA delle migrazioni del Radar.
\set ON_ERROR_STOP on

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
