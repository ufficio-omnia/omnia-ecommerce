-- Tappa 6 — serve l'id del Customer Stripe per aprire il portale clienti
-- (cambio metodo di pagamento senza disdire). Le subscription create
-- prima di questa colonna restano con il valore null: la action che apre
-- il portale lo recupera al volo da Stripe (tramite stripe_subscription_id)
-- e lo scrive qui per le volte successive — nessun backfill necessario.
alter table public.subscriptions
  add column if not exists stripe_customer_id text;
