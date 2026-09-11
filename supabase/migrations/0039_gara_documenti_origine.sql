-- Fase 2B.5 — distingue i documenti caricati dal cliente da quelli
-- generati da OMNIA AI durante la chat (es. criteri offerta tecnica,
-- piano di lavoro), che compaiono nella stessa lista documenti.
--
-- Idempotente: colonna aggiunta con IF NOT EXISTS.

alter table public.gara_documenti
  add column if not exists origine text not null default 'cliente'
    check (origine in ('cliente', 'ai'));
