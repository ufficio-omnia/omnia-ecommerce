alter table public.gare
  add column if not exists sedi jsonb,
  add column if not exists personale_uscente jsonb;
