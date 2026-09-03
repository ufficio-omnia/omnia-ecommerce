-- Fase 1 — permessi mancanti sulle tabelle
--
-- In Postgres/Supabase le policy RLS filtrano le RIGHE, ma serve comunque
-- un GRANT a livello di tabella che autorizzi l'OPERAZIONE (SELECT/INSERT/
-- UPDATE/DELETE) per il ruolo che effettua la richiesta via API
-- (authenticated per gli utenti loggati). Senza questo grant, Postgres
-- rifiuta la query con "permission denied" ancora prima di valutare le
-- policy RLS.

grant select, update on public.users to authenticated;

grant select, insert, update, delete on public.companies to authenticated;

grant select, insert, update, delete on public.products to authenticated;

grant select, update on public.orders to authenticated;

grant select on public.subscriptions to authenticated;

grant select on public.credits to authenticated;
