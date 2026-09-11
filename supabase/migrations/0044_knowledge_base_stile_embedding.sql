-- Fase 2B.6 — stile e struttura della knowledge base recuperati per
-- pertinenza (come già avviene per il contenuto testuale), non con un
-- taglio fisso arbitrario ("i primi 8"): con decine/centinaia di
-- documenti caricati, ogni messaggio deve poter trovare gli esempi di
-- stile/impaginazione più adatti alla gara specifica, scansionando
-- TUTTI i documenti, non escludendone nessuno dalla ricerca.
--
-- Idempotente: colonna e indice con IF NOT EXISTS.

alter table public.knowledge_base_documenti
  add column if not exists stile_embedding vector(1024);

create index if not exists kb_documenti_stile_embedding_idx
  on public.knowledge_base_documenti
  using hnsw (stile_embedding vector_cosine_ops);

create or replace function public.match_knowledge_base_stile(
  query_embedding vector(1024),
  match_count int default 6
)
returns table (
  nota_stile text,
  struttura_titoli text,
  similarity float
)
language sql stable
security definer set search_path = public
as $$
  select
    knowledge_base_documenti.nota_stile,
    knowledge_base_documenti.struttura_titoli,
    1 - (knowledge_base_documenti.stile_embedding <=> query_embedding) as similarity
  from public.knowledge_base_documenti
  where knowledge_base_documenti.stato = 'pronto'
    and knowledge_base_documenti.stile_embedding is not null
  order by knowledge_base_documenti.stile_embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_knowledge_base_stile(vector, int) to authenticated;
