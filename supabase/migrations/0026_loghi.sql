-- Fase 2B — loghi per l'organigramma generato da OMNIA AI: logo
-- aziendale del cliente e logo del software gestionale sono fissi (una
-- volta per profilo azienda), il logo della stazione appaltante/cliente
-- finale è specifico di ogni singola gara (cambia ad ogni gara).

alter table public.companies
  add column logo_path text,
  add column software_nome text,
  add column software_logo_path text;

alter table public.gare
  add column logo_cliente_path text;

-- Bucket privato per i loghi del profilo azienda (accesso solo al
-- proprietario, stesso pattern di RLS via path-prefix già usato altrove
-- per bucket privati per-utente).
insert into storage.buckets (id, name, public)
values ('company-assets', 'company-assets', false)
on conflict (id) do nothing;

create policy "company_assets_owner_all" on storage.objects
  for all
  using (bucket_id = 'company-assets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'company-assets' and (storage.foldername(name))[1] = auth.uid()::text);
