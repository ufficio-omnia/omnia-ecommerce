-- Token di prompt caching (scrittura e lettura cache) come colonne
-- separate, non sommati dentro input_tokens: senza questo, il costo
-- ricalcolato da calcolaCostoStimato userebbe la tariffa piena su token che
-- in realtà sono costati 1,25x (scrittura, 5 minuti) o 0,1x (lettura) —
-- vedi src/lib/ai-pricing.ts. input_tokens resta il solo traffico NON
-- cache (come già oggi), coerente con l'uso storico della colonna.
--
-- Idempotente: colonne con IF NOT EXISTS, nessun DROP. Scritta e non
-- eseguita.

alter table public.ai_operazioni
  add column if not exists cache_creation_tokens integer,
  add column if not exists cache_read_tokens integer;
