-- 0117 — Tender Intelligence, fase B1-bis: collegamento REVERSIBILE delle gare doppie (17/11/2026).
--
-- Caso chiesto dal titolare: una rettifica della PVL arriva prima del bando su TED; la PVL crea la sua gara, TED poi ne crea un'altra.
-- Quando un avviso TED citato dalla PVL rivela che sono la stessa gara, le due si COLLEGANO, senza cancellare né spostare nulla:
--   - la gara «assorbita» resta intera nel database (dati, lotti, avvisi letti, cambiamenti) e indica in «unita_a» la gara che resta;
--   - sparisce da elenchi e ricerca; la sua scheda porta alla gara che resta, che mostra anche le fonti e i CIG di quella collegata;
--   - ogni collegamento e ogni annullamento si registrano (radar_aggiornamenti, tipo «correzione_dati»; per gli annullamenti anche il
--     registro della console); un collegamento annullato a mano non si rifà da solo («unita_esclusa_con»).
-- Nessuna chiave esterna sulle colonne di collegamento (regola del progetto: niente FK su colonne di collegamento o di registro, per non
-- rendere ambigui gli «embed» di PostgREST).
--
-- ADDITIVA e idempotente: solo colonne nuove (valori predefiniti costanti) e un indice parziale. Da eseguire SOLO sullo staging finché la
-- PVL non è autorizzata in produzione. Riusabile dalla fase B2a per le altre fonti.

alter table public.radar_procedure add column if not exists unita_a uuid;
alter table public.radar_procedure add column if not exists unita_il timestamptz;
alter table public.radar_procedure add column if not exists unita_motivo text check (unita_motivo is null or char_length(unita_motivo) <= 300);
alter table public.radar_procedure add column if not exists unita_esclusa_con uuid[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radar_procedure_unita_a_diversa') then
    alter table public.radar_procedure add constraint radar_procedure_unita_a_diversa check (unita_a is null or unita_a <> id);
  end if;
end $$;

create index if not exists radar_procedure_unita_a_idx on public.radar_procedure (unita_a) where unita_a is not null;

notify pgrst, 'reload schema';
