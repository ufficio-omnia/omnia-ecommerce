-- Fase 2A — fatture: un PDF per ordine, caricato manualmente dall'admin,
-- scaricabile dal cliente proprietario dell'ordine.

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade unique,
  file_path text not null,
  created_at timestamptz not null default now()
);

alter table public.invoices enable row level security;

create policy "invoices_select_own" on public.invoices
  for select using (
    exists (
      select 1 from public.orders
      where orders.id = invoices.order_id and orders.user_id = auth.uid()
    )
  );

create policy "invoices_select_admin" on public.invoices
  for select using (public.is_admin());

create policy "invoices_write_admin" on public.invoices
  for all using (public.is_admin()) with check (public.is_admin());

-- grant di base (vedi lezione appresa in Fase 1/2A: RLS non basta senza
-- questi grant, sia per authenticated che per service_role). companies
-- è già coperta da 0002 (authenticated) e 0007 (service_role).
grant select, insert, update, delete on public.invoices to authenticated;
grant select, insert, update, delete on public.invoices to service_role;
