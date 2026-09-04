-- La service_role bypassa la RLS ma, come authenticated/anon, ha comunque
-- bisogno dei GRANT di base sulle tabelle. Le concediamo su tutte le
-- tabelle applicative: la service_role è usata solo in codice server-only
-- di fiducia (server action, webhook), quindi l'accesso pieno è corretto.

grant select, insert, update, delete on public.users to service_role;
grant select, insert, update, delete on public.companies to service_role;
grant select, insert, update, delete on public.products to service_role;
grant select, insert, update, delete on public.orders to service_role;
grant select, insert, update, delete on public.subscriptions to service_role;
grant select, insert, update, delete on public.credits to service_role;
