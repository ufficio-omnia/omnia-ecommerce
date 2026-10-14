-- Ora di scadenza della gara.
--
-- L'estrazione dei dati registrava della scadenza solo il giorno (gare.scadenza, date). Alcuni bandi
-- indicano anche l'ora (per esempio «entro le ore 12:00»): se c'è, ora si estrae e si conserva qui, si
-- mostra tra i dati estratti e conta nel calcolo del prezzo della revisione umana (urgenza). Se il bando non
-- indica l'ora la colonna resta vuota e si intendono le 23:59 di quel giorno.
--
-- Ora italiana, senza fuso (come la data). Idempotente: si può rieseguire. Prima di questa migrazione
-- l'estrazione funziona come sempre e l'ora non c'è.

alter table public.gare
  add column if not exists scadenza_ora time without time zone;
