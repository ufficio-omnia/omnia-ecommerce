-- Fase 2A — collega ogni ordine al prodotto acquistato

alter table public.orders
  add column product_id uuid references public.products (id) on delete restrict;

create index idx_orders_product_id on public.orders (product_id);
