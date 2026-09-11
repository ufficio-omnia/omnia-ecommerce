-- Fase 2B.5/2B.6 —
-- 1) i documenti generati dall'AI in chat vengono scaricati dalla chat
--    stessa (revisioni multiple attese), non elencati fra i documenti
--    caricati dal cliente: aggiungiamo il riferimento al file
--    direttamente sul messaggio.
-- 2) knowledge base condivisa (non per-gara): progetti tecnici pregressi
--    caricati da admin, usati come riferimento di stile/qualità per
--    OMNIA AI in tutte le chat, mai come fonte di dati specifici.

alter table public.gara_messaggi
  add column file_nome text,
  add column file_path text;

-- ---------------------------------------------------------------------
-- knowledge_base_documenti / knowledge_base_chunks
-- ---------------------------------------------------------------------
create table public.knowledge_base_documenti (
  id uuid primary key default gen_random_uuid(),
  nome_file text not null,
  file_path text not null,
  stato text not null default 'in_elaborazione'
    check (stato in ('in_elaborazione', 'pronto', 'errore')),
  created_at timestamptz not null default now()
);

alter table public.knowledge_base_documenti enable row level security;

create policy "kb_documenti_admin_all" on public.knowledge_base_documenti
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.knowledge_base_documenti to authenticated;
grant select, insert, update, delete on public.knowledge_base_documenti to service_role;

create table public.knowledge_base_chunks (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.knowledge_base_documenti (id) on delete cascade,
  chunk_index integer not null,
  contenuto text not null,
  embedding vector(1024) not null,
  created_at timestamptz not null default now()
);

alter table public.knowledge_base_chunks enable row level security;

create policy "kb_chunks_admin_all" on public.knowledge_base_chunks
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.knowledge_base_chunks to authenticated;
grant select, insert, update, delete on public.knowledge_base_chunks to service_role;

create index kb_chunks_embedding_idx
  on public.knowledge_base_chunks
  using hnsw (embedding vector_cosine_ops);

-- Funzione di ricerca per similarità sulla knowledge base condivisa,
-- richiamata dalla chat di ogni gara. Nessun filtro per utente: è una
-- base condivisa (dati già anonimizzati in fase di caricamento).
create or replace function public.match_knowledge_base_chunks(
  query_embedding vector(1024),
  match_count int default 4
)
returns table (
  contenuto text,
  similarity float
)
language sql stable
security definer set search_path = public
as $$
  select
    knowledge_base_chunks.contenuto,
    1 - (knowledge_base_chunks.embedding <=> query_embedding) as similarity
  from public.knowledge_base_chunks
  order by knowledge_base_chunks.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_knowledge_base_chunks(vector, int) to authenticated;

-- Bucket storage privato per i file originali della knowledge base
-- (accesso solo admin via service role, stesso pattern del bucket "gare").
insert into storage.buckets (id, name, public)
values ('knowledge-base', 'knowledge-base', false)
on conflict (id) do nothing;

create policy "kb_admin_insert" on storage.objects
  for insert
  with check (bucket_id = 'knowledge-base' and public.is_admin());

create policy "kb_admin_update" on storage.objects
  for update
  using (bucket_id = 'knowledge-base' and public.is_admin());

create policy "kb_admin_delete" on storage.objects
  for delete
  using (bucket_id = 'knowledge-base' and public.is_admin());
