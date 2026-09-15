-- Tappa 6 (aggiunta) — cambio piano dall'area abbonamento.
--
-- Downgrade programmato tramite Subscription Schedule Stripe (mai
-- immediato: il periodo in corso è già pagato a prezzo pieno). Questi
-- due campi sono scritti SOLO dal webhook (mai dall'azione che avvia il
-- cambio, né dalla pagina di ritorno), stessa disciplina "unica fonte di
-- verità" già in uso per stato/periodo dell'abbonamento.
alter table public.subscriptions
  add column if not exists stripe_schedule_id text,
  add column if not exists piano_programmato text,
  add column if not exists piano_programmato_da timestamptz;
