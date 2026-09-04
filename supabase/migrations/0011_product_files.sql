-- Fase 2A — prodotti multi-file (pacchetti BASIC/MEDIUM/PREMIUM) e
-- disattivazione soft dei prodotti (senza perdere lo storico ordini)

alter table public.products add column active boolean not null default true;

create table public.product_files (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  label text not null,
  file_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.product_files enable row level security;

create policy "product_files_select_all" on public.product_files
  for select using (true);

create policy "product_files_write_admin" on public.product_files
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.product_files to anon;
grant select, insert, update, delete on public.product_files to authenticated;
grant select, insert, update, delete on public.product_files to service_role;

-- migra il file del prodotto di test esistente nella nuova tabella
insert into public.product_files (product_id, label, file_path, sort_order)
select id, title, file_path, 0 from public.products where file_path is not null;

alter table public.products drop column file_path;
