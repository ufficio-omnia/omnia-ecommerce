-- Fase 2A — il catalogo prodotti deve essere leggibile anche da
-- visitatori non loggati (ruolo anon), non solo da authenticated

grant select on public.products to anon;
