-- 0113 — Tender Intelligence, fase B1 (16/11/2026): la scadenza come la scrive la fonte.
--
-- TED riporta giorno e ora con il fuso («2026-12-14+01:00», «13:00:00+01:00», a volte «Z» cioè UTC). La scadenza si conserva come istante
-- esatto (scadenza_offerte); qui si tiene ANCHE il testo originale, da mostrare quando il fuso non è quello italiano, così il cliente può
-- controllare l'orario sull'avviso ufficiale invece di fidarsi di una conversione.
--
-- ADDITIVA e idempotente: una colonna facoltativa su una tabella della 0109. Da eseguire dopo la 0112 e prima sullo staging.

alter table public.radar_procedure add column if not exists scadenza_fonte text check (scadenza_fonte is null or char_length(scadenza_fonte) <= 120);
alter table public.radar_lotti add column if not exists scadenza_fonte text check (scadenza_fonte is null or char_length(scadenza_fonte) <= 120);

notify pgrst, 'reload schema';
