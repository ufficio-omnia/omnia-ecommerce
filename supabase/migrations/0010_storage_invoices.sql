-- Fase 2A — storage privato per i PDF delle fatture, stesso schema del
-- bucket "documents": nessun file raggiungibile da URL pubblico, upload
-- riservato agli admin, download sempre tramite signed URL server-side.

insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

create policy "invoices_bucket_admin_insert" on storage.objects
  for insert
  with check (bucket_id = 'invoices' and public.is_admin());

create policy "invoices_bucket_admin_update" on storage.objects
  for update
  using (bucket_id = 'invoices' and public.is_admin());

create policy "invoices_bucket_admin_delete" on storage.objects
  for delete
  using (bucket_id = 'invoices' and public.is_admin());
