-- Nelle gare condotte tramite centrale di committenza/soggetto aggregatore,
-- la stazione appaltante che conduce la procedura (gare.stazione_appaltante,
-- introdotta in 0062) e l'amministrazione per cui si svolge effettivamente
-- il servizio sono soggetti diversi (es. "IN.VA. S.p.A." conduce la gara per
-- conto del "Comune di Aosta"). Campo separato, nullable: valorizzato
-- dall'estrazione AI solo quando i due soggetti differiscono, mai inserito a
-- mano.
--
-- Idempotente: colonna aggiunta con IF NOT EXISTS.

alter table public.gare
  add column if not exists amministrazione_committente text;
