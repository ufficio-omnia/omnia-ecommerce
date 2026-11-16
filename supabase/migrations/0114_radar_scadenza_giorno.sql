-- 0114 — Tender Intelligence, fase B1 (16/11/2026): il GIORNO della scadenza, separato dall'istante.
--
-- Regola già in vigore per le gare (migrazione 0102, «l'ora della scadenza non si presume mai»): senza ora non esiste un istante. Qui:
--   - scadenza_giorno: il giorno della scadenza (sempre, quando la fonte o il cliente lo indicano);
--   - scadenza_offerte: l'istante esatto SOLO se l'ora è indicata, altrimenti vuoto (nessuna «fine del giorno» presunta);
--   - una gara senza ora è aperta per tutto il suo giorno e scaduta dal giorno dopo.
-- Le righe già presenti (solo sullo staging: in produzione queste tabelle non esistono ancora) ricevono il giorno dalla scadenza salvata e,
-- dove l'ora non era indicata, perdono l'istante che era stato calcolato.
--
-- ADDITIVA e idempotente: colonne facoltative e un indice. Da eseguire dopo la 0113 e prima sullo staging.

alter table public.radar_procedure add column if not exists scadenza_giorno date;
alter table public.radar_lotti add column if not exists scadenza_giorno date;
alter table public.omnia_ai_radar_gare_aggiunte add column if not exists scadenza_giorno date;

update public.radar_procedure set scadenza_giorno = (scadenza_offerte at time zone 'Europe/Rome')::date where scadenza_giorno is null and scadenza_offerte is not null;
update public.radar_procedure set scadenza_offerte = null where scadenza_ora_indicata = false and scadenza_offerte is not null;
update public.radar_lotti set scadenza_giorno = (scadenza_offerte at time zone 'Europe/Rome')::date where scadenza_giorno is null and scadenza_offerte is not null;
update public.radar_lotti set scadenza_offerte = null where scadenza_ora_indicata = false and scadenza_offerte is not null;
update public.omnia_ai_radar_gare_aggiunte set scadenza_giorno = (scadenza_offerte at time zone 'Europe/Rome')::date where scadenza_giorno is null and scadenza_offerte is not null;
update public.omnia_ai_radar_gare_aggiunte set scadenza_offerte = null where scadenza_ora_indicata = false and scadenza_offerte is not null;

create index if not exists radar_procedure_scadenza_giorno_idx on public.radar_procedure (stato, scadenza_giorno);

notify pgrst, 'reload schema';
