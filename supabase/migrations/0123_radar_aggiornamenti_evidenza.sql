-- 0123 — Tender Intelligence, fase B4: evidenza delle modifiche nel registro dei cambiamenti (radar_aggiornamenti, 0109/0112), segno
-- «notifica_email» e FOTOGRAFIA di ogni versione nella provenienza (radar_procedure_fonti). SQL proposto per Z5 (B2, documento 45): NON
-- applicata senza l'autorizzazione dell'utente. Si applica DOPO la 0128 (registro dei giri), con il semaforo delle fonti chiuso.
-- Additiva e idempotente: colonne nuove con valori predefiniti costanti (in Postgres 17 nessuna riscrittura della tabella), vincoli, un
-- indice parziale. Le righe esistenti restano com'erano e NON diventano notificabili per email (notifica_email = false): nessuna ondata
-- di email per il passato. Scrivono solo gli importatori (service_role): permessi della 0109 invariati. Nessun indice unico cambia: gli
-- importatori continuano a scrivere con onConflict (procedura_id, tipo, campo, id_fonte); il LOTTO va nel campo («scadenza_offerte@<CIG>»).
-- L'evidenza si COPIA nella riga del cambiamento (avvisi, collegamento, data, dichiarazione): la provenienza si aggiorna a ogni versione e
-- non può fare da prova di una modifica passata.

-- 1) fotografia della versione letta (per la PVL: FotoVersionePvl di modifiche-pvl.ts; poi, se servirà, TED e Sintel per i lotti).
--    Solo dati pubblici dell'avviso, nessun dato di persone. Serve a confrontare versione con versione della STESSA fonte anche nei giri
--    incrementali, in cui la versione precedente non si rilegge.
alter table public.radar_procedure_fonti add column if not exists foto jsonb;
alter table public.radar_procedure_fonti drop constraint if exists radar_procedure_fonti_foto_forma;
alter table public.radar_procedure_fonti add constraint radar_procedure_fonti_foto_forma check (
  foto is null or (jsonb_typeof(foto) = 'object' and octet_length(foto::text) <= 16000)
);

-- 2) evidenza nel registro dei cambiamenti
alter table public.radar_aggiornamenti
  add column if not exists avviso_precedente_id text,   -- l'avviso confrontato (id_fonte è l'avviso nuovo)
  add column if not exists avviso_url text,              -- collegamento all'avviso ufficiale che porta la modifica
  add column if not exists avviso_pubblicato_il date,    -- giorno di pubblicazione dell'avviso nuovo (Roma)
  add column if not exists avviso_versione integer,      -- versione dichiarata dalla fonte (TED notice-version)
  add column if not exists avviso_tipo text,             -- tipo dell'avviso nella fonte (es. TED cn-standard, PVL P1_16)
  add column if not exists avviso_ted text,              -- numero TED corrispondente (PVL: link_eform_ted; TED: il proprio)
  add column if not exists dichiarazione_fonte text,     -- che cosa DICHIARA la fonte: TED change-reason-code, PVL «rettifica», SardegnaCAT «rettificato»
  add column if not exists affidabilita text,
  add column if not exists esecuzione_id uuid,           -- giro che l'ha rilevata: radar_esecuzioni.id della 0128 (registro dei giri); audit, senza chiave esterna
  add column if not exists notifica_email boolean not null default false;

alter table public.radar_aggiornamenti drop constraint if exists radar_aggiornamenti_evidenza_forma;
alter table public.radar_aggiornamenti add constraint radar_aggiornamenti_evidenza_forma check (
  (avviso_precedente_id is null or char_length(avviso_precedente_id) between 1 and 200)
  and (avviso_url is null or (char_length(avviso_url) <= 2000 and avviso_url ~ '^https?://'))
  and (avviso_versione is null or avviso_versione between 0 and 1000)
  and (avviso_tipo is null or char_length(avviso_tipo) <= 60)
  and (avviso_ted is null or avviso_ted ~ '^[0-9]{1,8}-[0-9]{4}$')
  and (dichiarazione_fonte is null or char_length(dichiarazione_fonte) <= 60)
  -- avviso_ufficiale: la fonte dichiara la modifica; confronto_versioni: confronto affidabile tra due versioni ufficiali della stessa fonte;
  -- parziale: evidenza debole (un'ora che compare o sparisce, lotti senza CIG), si conserva e non si notifica mai;
  -- non_verificata: righe precedenti o provenienza sconosciuta
  and (affidabilita is null or affidabilita in ('avviso_ufficiale', 'confronto_versioni', 'parziale', 'non_verificata'))
);

-- un'email nasce SOLO da una modifica verificata, notificabile (giro incrementale, gara non collegata, aperta) e di un tipo ammesso.
-- Mai da: formattazione, riclassificazioni («correzione_dati»), inferenze, gare nuove, esiti.
alter table public.radar_aggiornamenti drop constraint if exists radar_aggiornamenti_notifica_email_ammessa;
-- «coalesce»: in un CHECK un risultato NULL vale come vero; senza, una riga con affidabilita NULL passerebbe (trovato dalla prova isolata)
alter table public.radar_aggiornamenti add constraint radar_aggiornamenti_notifica_email_ammessa check (
  not notifica_email
  or (notificabile
      and tipo in ('rettifica', 'proroga', 'annullamento')
      and coalesce(affidabilita, '') in ('avviso_ufficiale', 'confronto_versioni'))
);

-- il processo giornaliero legge le modifiche da notificare dopo il suo cursore
create index if not exists radar_aggiornamenti_email_idx on public.radar_aggiornamenti (rilevato_il, id) where notifica_email;

notify pgrst, 'reload schema';
