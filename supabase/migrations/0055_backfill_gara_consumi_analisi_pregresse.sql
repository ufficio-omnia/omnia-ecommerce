-- Tappa 3 — Backfill del registro di consumo gare per le gare analizzate
-- prima che gara_consumi esistesse (migrazione 0053). Senza questa riga
-- il gate le tratterebbe come mai consumate e bloccherebbe la loro
-- rianalisi gratuita, violando la regola di prodotto ("chi ha già
-- ricevuto l'analisi non la ripaga") — caso reale osservato sulla gara
-- "teatro la scala".
--
-- tipo = 'piano' per tutte: non sappiamo con quale credito/piano siano
-- state effettivamente pagate all'epoca, ma sono comunque analisi già
-- concesse in passato, mai da riaddebitare ora. subscription_id resta
-- null: attribuire ora una riga storica a una subscription_id attuale
-- sarebbe un dato inventato. created_at = gare.created_at (non now()):
-- così il consumo storico non entra nel conteggio del periodo di
-- fatturazione corrente e non erode la quota del mese in corso.
--
-- Idempotente: "where not exists" esclude le gare che hanno già una
-- riga in gara_consumi, sicura da rieseguire.

insert into public.gara_consumi (gara_id, user_id, subscription_id, tipo, created_at)
select g.id, g.user_id, null, 'piano', g.created_at
from public.gare g
where g.estrazione_stato = 'completata'
  and not exists (
    select 1 from public.gara_consumi gc where gc.gara_id = g.id
  );
