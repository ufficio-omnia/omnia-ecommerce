-- Fase 2B.4/2B.5 — RAG e chat OMNIA AI per gara, costruiti come blocco
-- unico: senza recupero mirato dai documenti la chat non potrebbe
-- rispondere a domande specifiche su bandi di decine di pagine.
--
-- Idempotente: sicura da rieseguire se già applicata in tutto o in parte
-- (create table/index/extension IF NOT EXISTS, tipi enum e policy dentro
-- DO block che li crea solo se mancano, nessun DROP).

create extension if not exists vector;

-- ---------------------------------------------------------------------
-- gara_documenti_chunks — indicizzazione RAG dei documenti caricati.
-- Un chunk per porzione di testo estratta da un documento PDF, con il
-- relativo embedding (Voyage AI "voyage-4", 1024 dimensioni).
-- ---------------------------------------------------------------------
create table if not exists public.gara_documenti_chunks (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.gara_documenti (id) on delete cascade,
  gara_id uuid not null references public.gare (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  chunk_index integer not null,
  contenuto text not null,
  embedding vector(1024) not null,
  created_at timestamptz not null default now()
);

alter table public.gara_documenti_chunks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gara_documenti_chunks' and policyname = 'gara_documenti_chunks_all_own'
  ) then
    create policy "gara_documenti_chunks_all_own" on public.gara_documenti_chunks
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gara_documenti_chunks' and policyname = 'gara_documenti_chunks_select_admin'
  ) then
    create policy "gara_documenti_chunks_select_admin" on public.gara_documenti_chunks
      for select using (public.is_admin());
  end if;
end $$;

grant select, insert, update, delete on public.gara_documenti_chunks to authenticated;
grant select, insert, update, delete on public.gara_documenti_chunks to service_role;

create index if not exists gara_documenti_chunks_embedding_idx
  on public.gara_documenti_chunks
  using hnsw (embedding vector_cosine_ops);

create index if not exists gara_documenti_chunks_gara_id_idx
  on public.gara_documenti_chunks (gara_id);

-- Funzione di ricerca per similarità, richiamata via supabase.rpc() dalla
-- chat: il filtro per gara_id da solo non basterebbe a isolare i dati fra
-- clienti diversi, quindi replichiamo manualmente il controllo di
-- proprietà (auth.uid() = user_id) dentro la funzione, dato che
-- "security definer" bypassa la RLS della tabella.
create or replace function public.match_gara_chunks(
  query_embedding vector(1024),
  target_gara_id uuid,
  match_count int default 8
)
returns table (
  id uuid,
  documento_id uuid,
  contenuto text,
  similarity float
)
language sql stable
security definer set search_path = public
as $$
  select
    gara_documenti_chunks.id,
    gara_documenti_chunks.documento_id,
    gara_documenti_chunks.contenuto,
    1 - (gara_documenti_chunks.embedding <=> query_embedding) as similarity
  from public.gara_documenti_chunks
  where gara_documenti_chunks.gara_id = target_gara_id
    and gara_documenti_chunks.user_id = auth.uid()
  order by gara_documenti_chunks.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_gara_chunks(vector, uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- gara_messaggi — conversazione cliente <-> OMNIA AI per gara.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'gara_messaggio_ruolo' and n.nspname = 'public'
  ) then
    create type public.gara_messaggio_ruolo as enum ('utente', 'assistente');
  end if;
end $$;

create table if not exists public.gara_messaggi (
  id uuid primary key default gen_random_uuid(),
  gara_id uuid not null references public.gare (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  ruolo public.gara_messaggio_ruolo not null,
  contenuto text not null,
  created_at timestamptz not null default now()
);

alter table public.gara_messaggi enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gara_messaggi' and policyname = 'gara_messaggi_all_own'
  ) then
    create policy "gara_messaggi_all_own" on public.gara_messaggi
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gara_messaggi' and policyname = 'gara_messaggi_select_admin'
  ) then
    create policy "gara_messaggi_select_admin" on public.gara_messaggi
      for select using (public.is_admin());
  end if;
end $$;

grant select, insert, update, delete on public.gara_messaggi to authenticated;
grant select, insert, update, delete on public.gara_messaggi to service_role;
