-- Elenco dei sub-criteri per cui il disciplinare richiede SOLO la
-- compilazione di una tabella/griglia/checklist di conformità (non una
-- descrizione libera), es. ["2.2", "2.3", "4.1", "4.2", "4.3"].
--
-- Estratto una volta, in fase di analisi documenti, e usato come dato
-- fisso della gara in ogni generazione successiva: prima veniva lasciato
-- all'AI riconoscerlo di volta in volta dal linguaggio del disciplinare,
-- ma un giudizio ricalcolato a ogni rigenerazione può cambiare da una
-- chiamata all'altra (bug osservato in pratica: un sub-criterio
-- correttamente marcato "tabellare" durante una generazione è tornato
-- discorsivo alla rigenerazione successiva della stessa sezione).
--
-- Idempotente: colonna aggiunta con IF NOT EXISTS.
alter table public.gare
  add column if not exists sub_criteri_tabellari text[];
