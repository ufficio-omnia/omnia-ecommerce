-- CORREZIONE URGENTE di 0075.
--
-- 0075 creava orders.paid_by come chiave esterna verso public.users. Con due
-- chiavi esterne da orders a users (user_id e paid_by) PostgREST non sa più
-- quale usare quando una query incrocia le due tabelle, e risponde:
--   PGRST201 "Could not embed because more than one relationship was found
--   for 'orders' and 'users'"
-- Le query esistenti con users(email) dentro un select su orders smettono di
-- funzionare: nel vecchio pannello admin dell'e-commerce l'elenco ordini
-- risulta vuoto e, confermando un pagamento o caricando una fattura, l'email al
-- cliente non parte (l'aggiornamento dell'ordine e il file caricato restano
-- corretti). Il checkout, la dashboard dei clienti e il webhook non sono toccati.
--
-- Questa migrazione toglie la chiave esterna di paid_by e lascia la colonna
-- come semplice uuid (l'autore della conferma resta registrato; non c'è più il
-- vincolo di integrità, che non serve: un admin eliminato lascia solo un id).
-- Il codice nuovo indica comunque quale chiave usare (users!user_id(email)),
-- quindi non dipende da questo.
--
-- Il nome del vincolo si cerca nel catalogo invece di darlo per scontato.
-- Idempotente: se la chiave non c'è, non fa nulla. Chiede a PostgREST di
-- ricaricare lo schema perché il cambio valga subito.

do $$
declare
  nome_vincolo text;
begin
  for nome_vincolo in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = any (con.conkey)
    where ns.nspname = 'public'
      and rel.relname = 'orders'
      and con.contype = 'f'
      and att.attname = 'paid_by'
  loop
    execute format('alter table public.orders drop constraint %I', nome_vincolo);
  end loop;
end
$$;

notify pgrst, 'reload schema';
