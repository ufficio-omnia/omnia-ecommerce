-- Fase 2A — sconto manuale opzionale per prodotto, attivabile e
-- disattivabile dall'admin senza perdere il prezzo pieno originale

alter table public.products
  add column discount_active boolean not null default false,
  add column discount_price numeric(10, 2);

alter table public.products
  add constraint discount_price_valid check (
    not discount_active or (discount_price is not null and discount_price > 0 and discount_price < price)
  );
