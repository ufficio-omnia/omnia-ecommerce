-- Fase 2B.2 — gestione gara: il cliente crea una "gara" (stanza di lavoro)
-- e carica i documenti (bando, disciplinare, capitolato...). Ogni cliente
-- vede solo le proprie gare. I campi estratti dall'AI (scadenza, importo,
-- criteri, requisiti) arriveranno in 2B.3, non ancora qui.
--
-- Idempotente: create table/index con IF NOT EXISTS, ogni policy creata
-- dentro un DO block solo se manca (CREATE POLICY non supporta IF NOT
-- EXISTS in Postgres) — sicura da rieseguire se già applicata in tutto
-- o in parte, nessun DROP.

create table if not exists public.gare (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  titolo text not null,
  created_at timestamptz not null default now()
);

alter table public.gare enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gare' and policyname = 'gare_all_own'
  ) then
    create policy "gare_all_own" on public.gare
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gare' and policyname = 'gare_select_admin'
  ) then
    create policy "gare_select_admin" on public.gare
      for select using (public.is_admin());
  end if;
end $$;

grant select, insert, update, delete on public.gare to authenticated;
grant select, insert, update, delete on public.gare to service_role;

-- ---------------------------------------------------------------------
-- gara_documenti (file caricati in una gara)
-- ---------------------------------------------------------------------
create table if not exists public.gara_documenti (
  id uuid primary key default gen_random_uuid(),
  gara_id uuid not null references public.gare (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  nome_file text not null,
  file_path text not null,
  created_at timestamptz not null default now()
);

alter table public.gara_documenti enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gara_documenti' and policyname = 'gara_documenti_all_own'
  ) then
    create policy "gara_documenti_all_own" on public.gara_documenti
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gara_documenti' and policyname = 'gara_documenti_select_admin'
  ) then
    create policy "gara_documenti_select_admin" on public.gara_documenti
      for select using (public.is_admin());
  end if;
end $$;

grant select, insert, update, delete on public.gara_documenti to authenticated;
grant select, insert, update, delete on public.gara_documenti to service_role;

-- ---------------------------------------------------------------------
-- storage privato per i documenti di gara. Come per "documents", nessuna
-- policy di SELECT/INSERT per authenticated: upload e download passano
-- sempre da server action con service role, dopo aver verificato
-- manualmente la proprietà della gara (workaround per il mistero RLS
-- storage già documentato sul bucket "documents").
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('gare', 'gare', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'gare_admin_insert'
  ) then
    create policy "gare_admin_insert" on storage.objects
      for insert
      with check (bucket_id = 'gare' and public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'gare_admin_update'
  ) then
    create policy "gare_admin_update" on storage.objects
      for update
      using (bucket_id = 'gare' and public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'gare_admin_delete'
  ) then
    create policy "gare_admin_delete" on storage.objects
      for delete
      using (bucket_id = 'gare' and public.is_admin());
  end if;
end $$;
