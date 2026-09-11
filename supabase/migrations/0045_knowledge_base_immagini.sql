-- Fase 2B.6bis — libreria di immagini reali estratte dalla knowledge base
-- (pagine renderizzate e immagini incorporate: tabelle, organigrammi,
-- schemi, loghi), recuperabile per pertinenza come già avviene per il
-- testo. Finora OMNIA AI riceveva solo una descrizione testuale dello
-- stile (100-150 parole): non "vedeva" mai realmente una tabella o un
-- organigramma dei progetti caricati, solo una loro parafrasi. Con questa
-- libreria le immagini vere vengono allegate come blocchi immagine reali
-- alle chiamate di generazione.
--
-- Idempotente: sicura da rieseguire se già applicata in tutto o in parte.

create table if not exists public.knowledge_base_immagini (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.knowledge_base_documenti (id) on delete cascade,
  storage_path text not null,
  descrizione text not null,
  embedding vector(1024) not null,
  created_at timestamptz not null default now()
);

alter table public.knowledge_base_immagini enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'knowledge_base_immagini' and policyname = 'kb_immagini_admin_all'
  ) then
    create policy "kb_immagini_admin_all" on public.knowledge_base_immagini
      for all using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

grant select, insert, update, delete on public.knowledge_base_immagini to authenticated;
grant select, insert, update, delete on public.knowledge_base_immagini to service_role;

create index if not exists kb_immagini_embedding_idx
  on public.knowledge_base_immagini
  using hnsw (embedding vector_cosine_ops);

create or replace function public.match_knowledge_base_immagini(
  query_embedding vector(1024),
  match_count int default 4
)
returns table (
  storage_path text,
  descrizione text,
  similarity float
)
language sql stable
security definer set search_path = public
as $$
  select
    knowledge_base_immagini.storage_path,
    knowledge_base_immagini.descrizione,
    1 - (knowledge_base_immagini.embedding <=> query_embedding) as similarity
  from public.knowledge_base_immagini
  order by knowledge_base_immagini.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_knowledge_base_immagini(vector, int) to authenticated;
