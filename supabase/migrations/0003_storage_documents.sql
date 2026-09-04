-- Fase 2A — storage privato per i file venduti
--
-- Bucket "documents": mai raggiungibile da URL pubblico diretto. Gli
-- unici modi per accedere ai file sono:
--  - un admin che carica/gestisce i file (dal pannello Supabase o, in
--    futuro, da un'interfaccia admin dedicata)
--  - un download server-side che genera un signed URL a tempo, solo
--    dopo aver verificato che l'ordine del cliente sia "pagato" (verrà
--    implementato più avanti nella Fase 2A, con la service role key)

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Solo gli admin possono caricare/modificare/eliminare file nel bucket.
-- Nessuna policy di SELECT per authenticated: i download passano sempre
-- da un endpoint server-side con la service role key, mai da accesso
-- diretto al bucket.
create policy "documents_admin_insert" on storage.objects
  for insert
  with check (bucket_id = 'documents' and public.is_admin());

create policy "documents_admin_update" on storage.objects
  for update
  using (bucket_id = 'documents' and public.is_admin());

create policy "documents_admin_delete" on storage.objects
  for delete
  using (bucket_id = 'documents' and public.is_admin());
