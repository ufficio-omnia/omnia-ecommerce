-- Galleria anteprime visive per i file prodotto (non il file reale
-- scaricabile): visibile anche a chi non è loggato, nel catalogo
-- pubblico. Relazione esterna a product_files (mai modificata): un file
-- può avere 0, 3, 4 o più anteprime senza vincoli rigidi nello schema.

create table public.product_file_previews (
  id uuid primary key default gen_random_uuid(),
  product_file_id uuid not null references public.product_files (id) on delete cascade,
  image_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.product_file_previews enable row level security;

create policy "product_file_previews_select_all" on public.product_file_previews
  for select using (true);

create policy "product_file_previews_write_admin" on public.product_file_previews
  for all using (public.is_admin()) with check (public.is_admin());

-- grant di base (RLS non basta senza questi grant, sia per authenticated
-- che per service_role)
grant select on public.product_file_previews to anon;
grant select, insert, update, delete on public.product_file_previews to authenticated;
grant select, insert, update, delete on public.product_file_previews to service_role;

-- Bucket SEPARATO e PUBBLICO per le immagini di anteprima — diverso dal
-- bucket "documents" (privato, file reali venduti), che resta invariato
-- e non viene toccato da questa migrazione. Un bucket public=true serve
-- gli oggetti via URL pubblica diretta senza passare da RLS: qui va bene
-- perché sono solo immagini di marketing con watermark, mai il documento
-- vero e proprio.
insert into storage.buckets (id, name, public)
values ('product-previews', 'product-previews', true)
on conflict (id) do nothing;

create policy "product_previews_admin_insert" on storage.objects
  for insert
  with check (bucket_id = 'product-previews' and public.is_admin());

create policy "product_previews_admin_update" on storage.objects
  for update
  using (bucket_id = 'product-previews' and public.is_admin());

create policy "product_previews_admin_delete" on storage.objects
  for delete
  using (bucket_id = 'product-previews' and public.is_admin());
