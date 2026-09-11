-- Fase 2B — la lunghezza di ogni sezione generata deve essere decisa
-- dall'AI in base al limite pagine/lunghezza del bando e al peso del
-- criterio, non una regola fissa: perché funzioni servono i limiti
-- sempre presenti nel contesto (non solo se il messaggio dell'utente li
-- tocca per caso nella ricerca per pertinenza), quindi li estraiamo come
-- campo strutturato al pari di scadenza/importo/criteri/requisiti.
--
-- Idempotente: colonna aggiunta con IF NOT EXISTS.

alter table public.gare
  add column if not exists limiti_formattazione text;
