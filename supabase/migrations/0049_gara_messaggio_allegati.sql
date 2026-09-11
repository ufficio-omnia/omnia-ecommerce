-- Allegati caricati dal cliente direttamente in chat (immagini, PDF, Word,
-- Excel) collegati a un messaggio: distinti da gara_documenti (bando/
-- disciplinare/capitolato caricati nella sezione "Documenti" e indicizzati
-- per il RAG) perché sono materiale ad-hoc portato dal cliente durante la
-- conversazione, non i documenti di gara ufficiali. Una tabella dedicata
-- (invece di riusare le colonne file_nome/file_path già su gara_messaggi,
-- pensate per il singolo file generato dall'AI) perché un messaggio può
-- avere più allegati.
--
-- Idempotente: sicura da rieseguire se già applicata in tutto o in parte.
create table if not exists public.gara_messaggio_allegati (
  id uuid primary key default gen_random_uuid(),
  messaggio_id uuid not null references public.gara_messaggi (id) on delete cascade,
  gara_id uuid not null references public.gare (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  nome_file text not null,
  file_path text not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);

alter table public.gara_messaggio_allegati enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gara_messaggio_allegati' and policyname = 'gara_messaggio_allegati_all_own'
  ) then
    create policy "gara_messaggio_allegati_all_own" on public.gara_messaggio_allegati
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gara_messaggio_allegati' and policyname = 'gara_messaggio_allegati_select_admin'
  ) then
    create policy "gara_messaggio_allegati_select_admin" on public.gara_messaggio_allegati
      for select using (public.is_admin());
  end if;
end $$;

grant select, insert, update, delete on public.gara_messaggio_allegati to authenticated;
grant select, insert, update, delete on public.gara_messaggio_allegati to service_role;

create index if not exists gara_messaggio_allegati_messaggio_id_idx on public.gara_messaggio_allegati (messaggio_id);
