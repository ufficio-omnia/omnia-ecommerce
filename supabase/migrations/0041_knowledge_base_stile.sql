-- Fase 2B.6 — nota di stile per documento della knowledge base: oltre al
-- testo (anonimizzato, indicizzato per il RAG), salviamo una descrizione
-- delle convenzioni di formattazione/impaginazione osservate, da usare
-- sempre come contesto fisso in chat (non recuperabile per similarità,
-- è una proprietà dell'intero documento, non di un singolo passaggio).
--
-- Idempotente: colonna aggiunta con IF NOT EXISTS.

alter table public.knowledge_base_documenti
  add column if not exists nota_stile text;
